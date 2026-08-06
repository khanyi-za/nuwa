import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyRehostService } from './shopify-rehost.service';
import { namespaceSku, slugify, stripQuery } from './mapping/heuristics';
import { ImportProduct } from './mapping/import-types';

const TAGS_PER_PRODUCT = 10;

export interface ProductWriteCounters {
  productsImported: number;
  productsSkippedNoImage: number;
  variantsImported: number;
  imagesUploaded: number;
  imagesFailed: number;
}

/**
 * ShopifyProductWriterService — writes ONE mapped product into a store:
 * rehost images (HTTP) → Product/Variants/Images rows → collection/category/
 * tag links → ShopifyProductLink rows (the sync lookup table).
 *
 * Shared by the Phase 1c bulk import executor and the Phase 2 sync applier
 * (products/create), so a webhook-created product is written by the exact
 * same code path as an imported one. No DB transaction spans the rehost
 * calls (house rule).
 */
@Injectable()
export class ShopifyProductWriterService {
  private readonly logger = new Logger(ShopifyProductWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rehost: ShopifyRehostService,
  ) {}

  /** Existing namespaced variant SKUs of a store — seed for dedupe. */
  async loadUsedSkus(storeId: string): Promise<Set<string>> {
    const rows = await this.prisma.productVariant.findMany({
      where: { product: { storeId } },
      select: { sku: true },
    });
    return new Set(rows.map((r) => r.sku).filter((s): s is string => !!s));
  }

  /**
   * Returns the created product id, or null when the product was skipped
   * (no displayable image). Throws on write failure — the caller decides
   * whether that is fatal (sync) or a counted skip (bulk import).
   */
  async writeProduct(
    connectionId: string,
    store: { id: string; slug: string },
    p: ImportProduct,
    collectionIdBySlug: Map<string, string>,
    categoryIdBySlug: Map<string, string>,
    usedSkus: Set<string>,
    counters: ProductWriteCounters,
  ): Promise<string | null> {
    if (p.images.length === 0) {
      counters.productsSkippedNoImage++;
      return null;
    }

    const imageRows: {
      url: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }[] = [];
    // Query-stripped source URL → hosted URL, so variants can snapshot the
    // SAME hosted string as their matching ProductImage row (the gallery-jump
    // contract on ProductVariant.imageUrl).
    const hostedBySource = new Map<string, string>();
    for (const img of p.images) {
      const hosted = await this.rehost.rehostImage(store.id, img.sourceUrl);
      if (!hosted) {
        counters.imagesFailed++;
        continue;
      }
      counters.imagesUploaded++;
      hostedBySource.set(stripQuery(img.sourceUrl), hosted);
      imageRows.push({
        url: hosted,
        altText: img.altText,
        sortOrder: imageRows.length,
        isPrimary: imageRows.length === 0,
      });
    }
    if (imageRows.length === 0) {
      // Every upload failed — an ACTIVE product must be displayable.
      counters.productsSkippedNoImage++;
      return null;
    }

    // ProductVariant.sku is globally @unique: namespace per store, then null
    // any within-store repeats (some brands reuse SKUs across their range).
    const dedupeSku = (raw: string | null): string | null => {
      const sku = namespaceSku(store.slug, raw);
      if (!sku || usedSkus.has(sku)) return null;
      usedSkus.add(sku);
      return sku;
    };

    const created = await this.prisma.product.create({
      data: {
        storeId: store.id,
        title: p.title,
        slug: p.slug,
        sku: p.sku,
        description: p.description,
        status: 'ACTIVE',
        genderType: p.genderType,
        priceInCents: p.priceInCents,
        comparePriceInCents: p.comparePriceInCents,
        weightInGrams: p.weightInGrams,
        totalStock: p.isBare ? p.totalStock : 0,
        publishedAt: new Date(),
        images: { create: imageRows },
        variants: p.isBare
          ? undefined
          : {
              create: p.variants.map((v) => ({
                name: v.name,
                sku: dedupeSku(v.sku),
                color: v.color,
                size: v.size,
                material: v.material,
                imageUrl: v.imageSourceUrl
                  ? (hostedBySource.get(stripQuery(v.imageSourceUrl)) ?? null)
                  : null,
                priceInCents: v.priceInCents,
                stock: v.stock,
                sortOrder: v.sortOrder,
              })),
            },
      },
      select: {
        id: true,
        variants: { select: { id: true, sortOrder: true } },
      },
    });
    counters.productsImported++;
    counters.variantsImported += p.isBare ? 0 : p.variants.length;

    await this.writeLinks(connectionId, created, p);

    for (const cslug of p.collectionSlugs) {
      const cid = collectionIdBySlug.get(cslug);
      if (cid) {
        await this.prisma.productCollection.create({
          data: { productId: created.id, collectionId: cid },
        });
      }
    }

    const catId = p.suggestedCategorySlug
      ? categoryIdBySlug.get(p.suggestedCategorySlug)
      : undefined;
    if (catId) {
      await this.prisma.productCategory.create({
        data: { productId: created.id, categoryId: catId },
      });
    }

    // Tags are global and shared — key on slug (names can collide after
    // slugging, and slug is @unique). A bad tag is skipped, never fatal.
    for (const tagName of p.tags.slice(0, TAGS_PER_PRODUCT)) {
      const tagSlug = slugify(tagName);
      if (!tagSlug) continue;
      try {
        const tag = await this.prisma.tag.upsert({
          where: { slug: tagSlug },
          create: { name: tagName, slug: tagSlug },
          update: {},
          select: { id: true },
        });
        await this.prisma.productTag
          .create({ data: { productId: created.id, tagId: tag.id } })
          .catch(() => undefined);
      } catch {
        /* skip a problematic tag */
      }
    }

    return created.id;
  }

  /**
   * ShopifyProductLink rows — one per variant (variantId null for bare).
   * Created variants are matched to mapped variants by sortOrder. Best-effort:
   * a link failure costs future sync for this product, not the import.
   */
  private async writeLinks(
    connectionId: string,
    created: { id: string; variants: { id: string; sortOrder: number }[] },
    p: ImportProduct,
  ): Promise<void> {
    try {
      const rows: {
        connectionId: string;
        productId: string;
        variantId: string | null;
        shopifyProductId: string;
        shopifyVariantId: string;
        inventoryItemId: string | null;
      }[] = [];

      if (p.isBare) {
        if (p.bareVariant) {
          rows.push({
            connectionId,
            productId: created.id,
            variantId: null,
            shopifyProductId: p.sourceId,
            shopifyVariantId: p.bareVariant.sourceId,
            inventoryItemId: p.bareVariant.inventoryItemId,
          });
        }
      } else {
        const bySort = [...created.variants].sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        const mapped = [...p.variants].sort((a, b) => a.sortOrder - b.sortOrder);
        for (let i = 0; i < Math.min(bySort.length, mapped.length); i++) {
          rows.push({
            connectionId,
            productId: created.id,
            variantId: bySort[i].id,
            shopifyProductId: p.sourceId,
            shopifyVariantId: mapped[i].sourceId,
            inventoryItemId: mapped[i].inventoryItemId,
          });
        }
      }

      if (rows.length > 0) {
        await this.prisma.shopifyProductLink.createMany({ data: rows });
      }
    } catch (err) {
      this.logger.warn(
        `Sync links not written for product "${p.slug}": ${(err as Error).message} — webhooks will not reach it until re-imported`,
      );
    }
  }
}
