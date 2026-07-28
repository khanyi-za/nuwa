import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GenderType,
  Prisma,
  ShopifyImportStatus,
  StoreStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyRehostService } from './shopify-rehost.service';
import { ShopifyProductWriterService } from './shopify-product-writer.service';
import { ShopifyWebhookRegistrationService } from './shopify-webhook-registration.service';
import { numericIdFromGid } from './mapping/catalogue-mapper';
import { slugify } from './mapping/heuristics';
import { ImportCatalogue } from './mapping/import-types';
import { StartImportDto } from './dto/start-import.dto';

const BANNER_MAX = 5;
const PROGRESS_EVERY = 10; // products between summary writes while importing

interface ImportSummary {
  phase: 'PULLING' | 'IMPORTING' | 'DONE';
  totalProducts: number;
  productsImported: number;
  productsSkippedExisting: number;
  productsSkippedNoImage: number;
  productsFailed: number;
  variantsImported: number;
  imagesUploaded: number;
  imagesFailed: number;
  collectionsCreated: number;
  storeCreated: boolean;
  [key: string]: unknown; // keep assignable to Prisma.JsonObject
}

/**
 * ShopifyImportService — Phase 1c: the async import executor.
 *
 * POST /shopify/import creates a ShopifyImportJob (PENDING) and kicks the
 * executor off in-process (fire-and-forget; the wizard polls GET
 * /shopify/import/latest). Flow per run:
 *
 *   pull+map (1b) → resolve/create Store → per product: rehost images to
 *   Cloudinary (HTTP) then write rows → collections/categories/tags links →
 *   link connection.storeId → COMPLETED with summary counts.
 *
 * Import rules:
 *   - Non-ZAR shops are REFUSED (checked live at start — prices can't be
 *     converted honestly).
 *   - One store per user: an existing store is imported INTO; otherwise a
 *     DRAFT store is created from the shop identity (→ normal admin review).
 *   - Products land ACTIVE with real stock — invisible until the store goes
 *     live, sellable the moment it does.
 *   - Products already in the store (by slug) are skipped, so a re-run is an
 *     additive refresh and a failed run can be safely retried. Deletions
 *     don't propagate until Phase 2 sync.
 *   - Per-product failures are counted, not fatal. No DB transaction spans
 *     any HTTP call (house rule): rehost happens before each product's
 *     writes, never inside them.
 *
 * v1 limitation (accepted): the executor runs in-process — a process restart
 * abandons a RUNNING job (visible as such in the wizard; re-running is safe).
 */
@Injectable()
export class ShopifyImportService {
  private readonly logger = new Logger(ShopifyImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShopifyClient,
    private readonly connections: ShopifyConnectionService,
    private readonly catalogue: ShopifyCatalogueService,
    private readonly rehost: ShopifyRehostService,
    private readonly writer: ShopifyProductWriterService,
    private readonly registration: ShopifyWebhookRegistrationService,
  ) {}

  async startImport(userId: string, dto: StartImportDto) {
    const connection = await this.connections.getActiveWithToken(userId);

    // Live currency gate — same rule as the preview, checked fresh.
    const info = await this.client.fetchShopInfo(
      connection.shopDomain,
      connection.accessToken,
    );
    if (info.currencyCode !== 'ZAR') {
      throw new BadRequestException({
        code: 'SHOP_CURRENCY_UNSUPPORTED',
        message: `This shop trades in ${info.currencyCode}. YIIVA is ZAR-only — prices cannot be converted honestly, so this catalogue cannot be imported.`,
      });
    }

    const running = await this.prisma.shopifyImportJob.findFirst({
      where: {
        connectionId: connection.id,
        status: {
          in: [ShopifyImportStatus.PENDING, ShopifyImportStatus.RUNNING],
        },
      },
      select: { id: true },
    });
    if (running) {
      throw new ConflictException({
        code: 'IMPORT_ALREADY_RUNNING',
        message: 'An import is already in progress for this shop.',
      });
    }

    // If the import will need to CREATE a store, fail fast on name collisions
    // now (409 in the wizard) instead of minutes later as a FAILED job.
    const ownStore = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!ownStore) {
      const nameTaken = await this.prisma.store.findFirst({
        where: {
          OR: [{ displayName: info.name }, { companyName: info.name }],
        },
        select: { id: true },
      });
      if (nameTaken) {
        throw new ConflictException({
          code: 'STORE_NAME_TAKEN',
          message: `A YIIVA store named "${info.name}" already exists. Contact support to resolve the name clash.`,
        });
      }
    }

    const job = await this.prisma.shopifyImportJob.create({
      data: { connectionId: connection.id },
    });

    // Fire-and-forget — the executor owns all failure handling from here.
    void this.runImport(job.id, userId, dto.defaultGenderType);

    return this.toView(job);
  }

  async getLatest(userId: string) {
    const job = await this.prisma.shopifyImportJob.findFirst({
      where: { connection: { userId } },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) {
      throw new NotFoundException({
        code: 'NO_IMPORT_JOB',
        message: 'No import has been started',
      });
    }
    return this.toView(job);
  }

  async getById(userId: string, jobId: string) {
    const job = await this.prisma.shopifyImportJob.findUnique({
      where: { id: jobId },
      include: { connection: { select: { userId: true } } },
    });
    // 404-not-403: someone else's job is indistinguishable from no job.
    if (!job || job.connection.userId !== userId) {
      throw new NotFoundException({
        code: 'NO_IMPORT_JOB',
        message: 'Import job not found',
      });
    }
    return this.toView(job);
  }

  /**
   * The executor. Public for tests; production entry is the fire-and-forget
   * in startImport. CAS on PENDING→RUNNING makes double-execution a no-op.
   */
  async runImport(
    jobId: string,
    userId: string,
    defaultGenderType?: GenderType,
  ): Promise<void> {
    const claimed = await this.prisma.shopifyImportJob.updateMany({
      where: { id: jobId, status: ShopifyImportStatus.PENDING },
      data: { status: ShopifyImportStatus.RUNNING, startedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const summary: ImportSummary = {
      phase: 'PULLING',
      totalProducts: 0,
      productsImported: 0,
      productsSkippedExisting: 0,
      productsSkippedNoImage: 0,
      productsFailed: 0,
      variantsImported: 0,
      imagesUploaded: 0,
      imagesFailed: 0,
      collectionsCreated: 0,
      storeCreated: false,
    };

    try {
      const connection = await this.connections.getActiveWithToken(userId);
      await this.writeSummary(jobId, summary);

      const cat = await this.catalogue.getImportCatalogue(
        connection.shopDomain,
        connection.accessToken,
      );
      this.applyDefaultGender(cat, defaultGenderType);
      summary.totalProducts = cat.products.length;
      summary.phase = 'IMPORTING';
      await this.writeSummary(jobId, summary);

      const store = await this.resolveStore(
        userId,
        connection.shopDomain,
        connection.accessToken,
        summary,
      );

      // Best-effort per-store returns policy from the shop's Shopify refund
      // policy (optional read_legal_policies scope). Refreshed on every
      // import run; null keeps whatever the store already has, so a missing
      // scope never wipes a previously-captured policy.
      const returnPolicyText = await this.client.fetchRefundPolicyText(
        connection.shopDomain,
        connection.accessToken,
      );
      if (returnPolicyText) {
        await this.prisma.store.update({
          where: { id: store.id },
          data: { returnPolicyText },
        });
      }

      // Link the connection to the store immediately — even a partial import
      // should leave the wizard knowing which store it fed. The primary
      // location (first active) is what Phase 2 inventory mutations target.
      const primaryLocation =
        cat.locations.find((l) => l.isActive) ?? cat.locations[0];
      await this.prisma.shopifyConnection.update({
        where: { id: connection.id },
        data: {
          storeId: store.id,
          primaryLocationId: numericIdFromGid(primaryLocation?.sourceGid),
        },
      });

      const collectionIdBySlug = await this.importCollections(
        store.id,
        cat,
        summary,
      );
      const categoryIdBySlug = await this.loadCategoryMap(cat);

      const existingSlugs = new Set(
        (
          await this.prisma.product.findMany({
            where: { storeId: store.id },
            select: { slug: true },
          })
        ).map((p) => p.slug),
      );
      const usedSkus = await this.writer.loadUsedSkus(store.id);

      let sinceProgress = 0;
      for (const p of cat.products) {
        if (existingSlugs.has(p.slug)) {
          summary.productsSkippedExisting++;
          continue;
        }
        try {
          await this.writer.writeProduct(
            connection.id,
            store,
            p,
            collectionIdBySlug,
            categoryIdBySlug,
            usedSkus,
            summary,
          );
        } catch (err) {
          summary.productsFailed++;
          this.logger.warn(
            `Import of product "${p.slug}" failed: ${(err as Error).message}`,
          );
        }
        if (++sinceProgress >= PROGRESS_EVERY) {
          sinceProgress = 0;
          await this.writeSummary(jobId, summary);
        }
      }

      await this.seedBannerIfNew(store.id, summary);

      summary.phase = 'DONE';
      await this.prisma.shopifyImportJob.update({
        where: { id: jobId },
        data: {
          status: ShopifyImportStatus.COMPLETED,
          finishedAt: new Date(),
          summary: summary as unknown as Prisma.JsonObject,
        },
      });
      this.logger.log(
        `Shopify import ${jobId} completed: ${summary.productsImported}/${summary.totalProducts} products into store ${store.id}`,
      );

      // Phase 2: subscribe the shop to sync webhooks — best-effort, after
      // the job is already COMPLETED (registration failure ≠ import failure).
      void this.registration
        .registerForConnection(connection.id)
        .catch((err: Error) =>
          this.logger.warn(
            `Webhook registration failed for ${connection.shopDomain}: ${err.message}`,
          ),
        );
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown import error';
      this.logger.error(`Shopify import ${jobId} FAILED: ${message}`);
      await this.prisma.shopifyImportJob
        .update({
          where: { id: jobId },
          data: {
            status: ShopifyImportStatus.FAILED,
            finishedAt: new Date(),
            error: message,
            summary: summary as unknown as Prisma.JsonObject,
          },
        })
        .catch(() => undefined); // job row gone/unreachable — nothing left to record
    }
  }

  /**
   * Silent-gender products (source === 'default') take the merchant's chosen
   * store default; inferred genders always win.
   */
  private applyDefaultGender(
    cat: ImportCatalogue,
    defaultGenderType?: GenderType,
  ) {
    if (!defaultGenderType) return;
    for (const p of cat.products) {
      if (p.genderSource === 'default') p.genderType = defaultGenderType;
    }
  }

  /** The user's store, or a new DRAFT one built from the shop identity. */
  private async resolveStore(
    userId: string,
    shopDomain: string,
    accessToken: string,
    summary: ImportSummary,
  ): Promise<{ id: string; slug: string }> {
    const existing = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: { id: true, slug: true },
    });
    if (existing) return existing;

    const info = await this.client.fetchShopInfo(shopDomain, accessToken);
    const slug = slugify(info.name);

    const store = await this.prisma.store.create({
      data: {
        ownerId: userId,
        companyName: info.name,
        displayName: info.name,
        slug,
        contactEmail: info.email,
        websiteUrl: info.primaryDomain ? `https://${info.primaryDomain}` : null,
        status: StoreStatus.DRAFT,
      },
      select: { id: true, slug: true },
    });
    summary.storeCreated = true;

    // Best-effort logo: brand asset may be unset or unreadable.
    const logoUrl = await this.client.fetchShopLogoUrl(shopDomain, accessToken);
    if (logoUrl) {
      const hosted = await this.rehost.rehostImage(store.id, logoUrl);
      if (hosted) {
        await this.prisma.store.update({
          where: { id: store.id },
          data: { logoUrl: hosted },
        });
      }
    }
    return store;
  }

  /** Create missing StoreCollections (slug-scoped per store); map slug → id. */
  private async importCollections(
    storeId: string,
    cat: ImportCatalogue,
    summary: ImportSummary,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const existing = await this.prisma.storeCollection.findMany({
      where: { storeId },
      select: { id: true, slug: true },
    });
    existing.forEach((c) => map.set(c.slug, c.id));

    for (const c of cat.collections) {
      if (map.has(c.slug)) continue;
      const imageUrl = c.imageSourceUrl
        ? await this.rehost.rehostImage(storeId, c.imageSourceUrl)
        : null;
      const created = await this.prisma.storeCollection.create({
        data: {
          storeId,
          name: c.name,
          slug: c.slug,
          description: c.description,
          imageUrl,
          sortOrder: c.sortOrder,
        },
        select: { id: true },
      });
      map.set(c.slug, created.id);
      summary.collectionsCreated++;
    }
    return map;
  }

  /** Platform categories that actually exist for the suggested slugs. */
  private async loadCategoryMap(
    cat: ImportCatalogue,
  ): Promise<Map<string, string>> {
    const wanted = new Set(
      cat.products
        .map((p) => p.suggestedCategorySlug)
        .filter((s): s is string => Boolean(s)),
    );
    if (wanted.size === 0) return new Map();
    const rows = await this.prisma.category.findMany({
      where: { slug: { in: [...wanted] } },
      select: { id: true, slug: true },
    });
    return new Map(rows.map((c) => [c.slug, c.id]));
  }

  /**
   * A store the import just created gets a starter banner from its first
   * product images (already on Cloudinary) so the profile isn't bare in
   * review — the merchant replaces it in athena. Stores that already had
   * banner media (or existed before the import) are left alone.
   */
  private async seedBannerIfNew(storeId: string, summary: ImportSummary) {
    if (!summary.storeCreated) return;
    const existing = await this.prisma.storeBannerMedia.count({
      where: { storeId },
    });
    if (existing > 0) return;

    const images = await this.prisma.productImage.findMany({
      where: { product: { storeId }, isPrimary: true },
      orderBy: { createdAt: 'asc' },
      take: BANNER_MAX,
      select: { url: true },
    });
    for (let i = 0; i < images.length; i++) {
      await this.prisma.storeBannerMedia.create({
        data: {
          storeId,
          url: images[i].url,
          mediaType: 'IMAGE',
          sortOrder: i,
          isPrimary: i === 0,
        },
      });
    }
  }

  private async writeSummary(jobId: string, summary: ImportSummary) {
    await this.prisma.shopifyImportJob
      .update({
        where: { id: jobId },
        data: { summary: summary as unknown as Prisma.JsonObject },
      })
      .catch(() => undefined); // progress write must never kill the run
  }

  private toView(job: {
    id: string;
    status: ShopifyImportStatus;
    summary: Prisma.JsonValue;
    error: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      summary: job.summary,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
    };
  }
}
