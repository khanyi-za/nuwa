import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductStatus, ShopifyConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyProductWriterService } from './shopify-product-writer.service';
import { mapProduct } from './mapping/catalogue-mapper';
import { priceToCents, stripHtml } from './mapping/heuristics';
import { ShopifyTokenService } from './shopify-token.service';

/* REST-shaped webhook payloads (products/* topics deliver the REST resource). */
interface RestVariantPayload {
  id: number;
  price?: string;
  compare_at_price?: string | null;
  inventory_item_id?: number;
  inventory_quantity?: number | null;
}
interface RestProductPayload {
  id: number;
  title?: string;
  body_html?: string | null;
  status?: string; // active | draft | archived
  variants?: RestVariantPayload[];
}
interface InventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number | null;
}

const STATUS_MAP: Record<string, ProductStatus> = {
  active: ProductStatus.ACTIVE,
  draft: ProductStatus.DRAFT,
  archived: ProductStatus.ARCHIVED,
};

export type SyncOutcome =
  | 'APPLIED'
  | 'UNKNOWN_PRODUCT'
  | 'UNKNOWN_ITEM'
  | 'ALREADY_LINKED'
  | 'SLUG_EXISTS'
  | 'NOT_FOUND'
  | 'NO_STORE'
  | 'LOCATION_SKIPPED'
  | 'IGNORED_TOPIC'
  | 'IGNORED';

/**
 * ShopifySyncService — Phase 2 appliers: webhook payload → YIIVA state,
 * resolved through the ShopifyProductLink table. Shopify is the source of
 * truth for merchants on the app (foundation §3): price, stock, title,
 * description and status sync DOWN; images/options/collections do NOT sync
 * in v1 (re-import or Phase 3 refinement). Variant images
 * (ProductVariant.imageUrl, the colour-selector gallery jump) are captured
 * at import/create time only — a variant image changed on Shopify won't
 * refresh until a re-import.
 *
 *   products/update          → title/description/status + per-variant
 *                              price/stock (unknown new variants are logged,
 *                              not created — v1 limitation)
 *   products/create          → full single-product import via the shared
 *                              writer (same path as the bulk import)
 *   products/delete          → ARCHIVED (SA-4: mirrors the ordered-products-
 *                              archive rule; never a hard delete)
 *   inventory_levels/update  → stock SET on the linked variant/bare product
 *                              (primary location only)
 *
 * reconcileConnection() is the daily safety net for missed webhooks: full
 * pull → stock/price drift repair + archive of products deleted on Shopify.
 */
@Injectable()
export class ShopifySyncService {
  private readonly logger = new Logger(ShopifySyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
    private readonly catalogue: ShopifyCatalogueService,
    private readonly writer: ShopifyProductWriterService,
    private readonly tokens: ShopifyTokenService,
  ) {}

  async apply(
    connection: ShopifyConnection,
    topic: string,
    payload: unknown,
  ): Promise<SyncOutcome> {
    switch (topic) {
      case 'products/update':
        return this.applyProductUpdate(
          connection,
          payload as RestProductPayload,
        );
      case 'products/create':
        return this.applyProductCreate(
          connection,
          payload as RestProductPayload,
        );
      case 'products/delete':
        return this.applyProductDelete(
          connection,
          payload as RestProductPayload,
        );
      case 'inventory_levels/update':
        return this.applyInventoryLevel(
          connection,
          payload as InventoryLevelPayload,
        );
      default:
        return 'IGNORED_TOPIC'; // audited, not an error — topics we didn't subscribe to
    }
  }

  // ─── products/update ──────────────────────────────────────────────────────

  private async applyProductUpdate(
    connection: ShopifyConnection,
    payload: RestProductPayload,
  ): Promise<SyncOutcome> {
    const links = await this.prisma.shopifyProductLink.findMany({
      where: {
        connectionId: connection.id,
        shopifyProductId: String(payload.id),
      },
    });
    if (links.length === 0) return 'UNKNOWN_PRODUCT';

    const productId = links[0].productId;
    const bare = links.length === 1 && links[0].variantId === null;
    const variants = payload.variants ?? [];
    const prices = variants
      .map((v) => priceToCents(v.price))
      .filter((n): n is number => n != null);
    const priceInCents = prices.length ? Math.min(...prices) : null;
    const compare = priceToCents(variants[0]?.compare_at_price ?? null);

    const data: Prisma.ProductUpdateInput = {};
    if (payload.title !== undefined) data.title = payload.title;
    if (payload.body_html !== undefined) {
      data.description = stripHtml(payload.body_html);
    }
    if (payload.status && STATUS_MAP[payload.status]) {
      data.status = STATUS_MAP[payload.status];
    }
    if (priceInCents != null) {
      data.priceInCents = priceInCents;
      data.comparePriceInCents =
        compare && compare > priceInCents ? compare : null;
    }
    if (bare) {
      const qty = variants[0]?.inventory_quantity;
      if (typeof qty === 'number') data.totalStock = Math.max(0, qty);
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.product.update({ where: { id: productId }, data });
    }

    if (!bare) {
      const linkByShopifyVariant = new Map(
        links
          .filter((l) => l.variantId)
          .map((l) => [l.shopifyVariantId, l.variantId!]),
      );
      let unknownVariants = 0;
      for (const v of variants) {
        const variantId = linkByShopifyVariant.get(String(v.id));
        if (!variantId) {
          unknownVariants++;
          continue;
        }
        const cents = priceToCents(v.price);
        const vData: Prisma.ProductVariantUpdateInput = {};
        if (cents != null && priceInCents != null) {
          vData.priceInCents = cents !== priceInCents ? cents : null;
        }
        if (typeof v.inventory_quantity === 'number') {
          vData.stock = Math.max(0, v.inventory_quantity);
        }
        if (Object.keys(vData).length > 0) {
          await this.prisma.productVariant.update({
            where: { id: variantId },
            data: vData,
          });
        }
      }
      if (unknownVariants > 0) {
        this.logger.warn(
          `products/update for ${connection.shopDomain} product ${payload.id}: ${unknownVariants} unlinked variant(s) skipped (added on Shopify after import — re-import to pick up)`,
        );
      }
    }
    return 'APPLIED';
  }

  // ─── products/create ──────────────────────────────────────────────────────

  private async applyProductCreate(
    connection: ShopifyConnection,
    payload: RestProductPayload,
  ): Promise<SyncOutcome> {
    const linked = await this.prisma.shopifyProductLink.findFirst({
      where: {
        connectionId: connection.id,
        shopifyProductId: String(payload.id),
      },
      select: { id: true },
    });
    if (linked) return 'ALREADY_LINKED'; // create+update pairs / redeliveries

    if (!connection.storeId) return 'NO_STORE';
    const store = await this.prisma.store.findUnique({
      where: { id: connection.storeId },
      select: { id: true, slug: true },
    });
    if (!store) return 'NO_STORE';

    // Re-fetch via GraphQL so the new product flows through the exact same
    // shapes as the bulk import (REST payload shapes stay out of the writer).
    const accessToken = await this.tokens.getTokenFor(connection);
    const raw = await this.catalogue.fetchProduct(
      connection.shopDomain,
      accessToken,
      String(payload.id),
    );
    if (!raw) return 'NOT_FOUND'; // deleted/draft before we got here

    const mapped = mapProduct(raw, []);
    const slugTaken = await this.prisma.product.findFirst({
      where: { storeId: store.id, slug: mapped.slug },
      select: { id: true },
    });
    if (slugTaken) {
      this.logger.warn(
        `products/create for ${connection.shopDomain}: slug "${mapped.slug}" already exists in store — skipped`,
      );
      return 'SLUG_EXISTS';
    }

    const categoryIdBySlug = new Map<string, string>();
    if (mapped.suggestedCategorySlug) {
      const cat = await this.prisma.category.findFirst({
        where: { slug: mapped.suggestedCategorySlug },
        select: { id: true, slug: true },
      });
      if (cat) categoryIdBySlug.set(cat.slug, cat.id);
    }

    const counters = {
      productsImported: 0,
      productsSkippedNoImage: 0,
      variantsImported: 0,
      imagesUploaded: 0,
      imagesFailed: 0,
    };
    await this.writer.writeProduct(
      connection.id,
      store,
      mapped,
      new Map(), // collection membership isn't in the webhook — import-once concern
      categoryIdBySlug,
      await this.writer.loadUsedSkus(store.id),
      counters,
    );
    this.logger.log(
      `products/create synced: "${mapped.slug}" → store ${store.id} (${counters.productsImported ? 'imported' : 'skipped — no displayable image'})`,
    );
    return 'APPLIED';
  }

  // ─── products/delete ──────────────────────────────────────────────────────

  private async applyProductDelete(
    connection: ShopifyConnection,
    payload: RestProductPayload,
  ): Promise<SyncOutcome> {
    const links = await this.prisma.shopifyProductLink.findMany({
      where: {
        connectionId: connection.id,
        shopifyProductId: String(payload.id),
      },
      select: { productId: true },
    });
    if (links.length === 0) return 'UNKNOWN_PRODUCT';

    await this.prisma.product.updateMany({
      where: { id: { in: links.map((l) => l.productId) } },
      data: { status: ProductStatus.ARCHIVED },
    });
    return 'APPLIED';
  }

  // ─── inventory_levels/update ──────────────────────────────────────────────

  private async applyInventoryLevel(
    connection: ShopifyConnection,
    payload: InventoryLevelPayload,
  ): Promise<SyncOutcome> {
    if (payload.available == null) return 'IGNORED';
    // v1 is single-location: only the primary location's level is authoritative.
    // A connection without one recorded (pre-Phase-2 import) applies anyway —
    // correct for the single-location shops that are the SA SME norm.
    if (
      connection.primaryLocationId &&
      String(payload.location_id) !== connection.primaryLocationId
    ) {
      return 'LOCATION_SKIPPED';
    }

    const link = await this.prisma.shopifyProductLink.findFirst({
      where: {
        connectionId: connection.id,
        inventoryItemId: String(payload.inventory_item_id),
      },
      select: { productId: true, variantId: true },
    });
    if (!link) return 'UNKNOWN_ITEM';

    const stock = Math.max(0, payload.available);
    if (link.variantId) {
      await this.prisma.productVariant.update({
        where: { id: link.variantId },
        data: { stock },
      });
    } else {
      await this.prisma.product.update({
        where: { id: link.productId },
        data: { totalStock: stock },
      });
    }
    return 'APPLIED';
  }

  // ─── Daily reconcile (missed-webhook safety net) ──────────────────────────

  /**
   * Full pull → repair stock/price drift on linked products/variants and
   * archive linked products that no longer exist on Shopify. Title/desc/
   * images are NOT reconciled (webhooks cover them; drift there is cosmetic).
   */
  async reconcileConnection(connectionId: string): Promise<{
    productsChecked: number;
    stockFixed: number;
    priceFixed: number;
    archived: number;
    unlinked: number;
  } | null> {
    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection || connection.status !== 'ACTIVE' || !connection.storeId) {
      return null;
    }
    const accessToken = await this.tokens.getTokenFor(connection);
    const raw = await this.catalogue.pull(connection.shopDomain, accessToken);

    const links = await this.prisma.shopifyProductLink.findMany({
      where: { connectionId },
    });
    const linksByProduct = new Map<string, typeof links>();
    for (const l of links) {
      const list = linksByProduct.get(l.shopifyProductId) ?? [];
      list.push(l);
      linksByProduct.set(l.shopifyProductId, list);
    }
    const linkByShopifyVariant = new Map(
      links.map((l) => [l.shopifyVariantId, l]),
    );

    const dbProducts = new Map(
      (
        await this.prisma.product.findMany({
          where: { id: { in: links.map((l) => l.productId) } },
          select: {
            id: true,
            priceInCents: true,
            comparePriceInCents: true,
            totalStock: true,
          },
        })
      ).map((p) => [p.id, p]),
    );
    const dbVariants = new Map(
      (
        await this.prisma.productVariant.findMany({
          where: {
            id: {
              in: links
                .map((l) => l.variantId)
                .filter((v): v is string => !!v),
            },
          },
          select: { id: true, priceInCents: true, stock: true },
        })
      ).map((v) => [v.id, v]),
    );

    let stockFixed = 0;
    let priceFixed = 0;
    let unlinked = 0;
    const seenShopifyProducts = new Set<string>();

    for (const rawProduct of raw.products) {
      const mapped = mapProduct(rawProduct, []);
      const productLinks = linksByProduct.get(mapped.sourceId);
      if (!productLinks?.length) {
        unlinked++; // created on Shopify, never imported — products/create's job
        continue;
      }
      seenShopifyProducts.add(mapped.sourceId);
      const dbProduct = dbProducts.get(productLinks[0].productId);
      if (!dbProduct) continue;

      const data: Prisma.ProductUpdateInput = {};
      if (dbProduct.priceInCents !== mapped.priceInCents) {
        data.priceInCents = mapped.priceInCents;
        priceFixed++;
      }
      if (dbProduct.comparePriceInCents !== mapped.comparePriceInCents) {
        data.comparePriceInCents = mapped.comparePriceInCents;
      }
      if (mapped.isBare && dbProduct.totalStock !== mapped.totalStock) {
        data.totalStock = mapped.totalStock;
        stockFixed++;
      }
      if (Object.keys(data).length > 0) {
        await this.prisma.product.update({
          where: { id: dbProduct.id },
          data,
        });
      }

      for (const mv of mapped.variants) {
        const link = linkByShopifyVariant.get(mv.sourceId);
        if (!link?.variantId) continue;
        const dbVariant = dbVariants.get(link.variantId);
        if (!dbVariant) continue;
        const vData: Prisma.ProductVariantUpdateInput = {};
        if (dbVariant.stock !== mv.stock) {
          vData.stock = mv.stock;
          stockFixed++;
        }
        if (dbVariant.priceInCents !== mv.priceInCents) {
          vData.priceInCents = mv.priceInCents;
          priceFixed++;
        }
        if (Object.keys(vData).length > 0) {
          await this.prisma.productVariant.update({
            where: { id: link.variantId },
            data: vData,
          });
        }
      }
    }

    // Linked products absent from the pull were deleted (or deactivated) on
    // Shopify — archive them, mirroring products/delete.
    const goneProductIds = [
      ...new Set(
        links
          .filter((l) => !seenShopifyProducts.has(l.shopifyProductId))
          .map((l) => l.productId),
      ),
    ];
    let archived = 0;
    if (goneProductIds.length > 0) {
      const res = await this.prisma.product.updateMany({
        where: {
          id: { in: goneProductIds },
          status: { not: ProductStatus.ARCHIVED },
        },
        data: { status: ProductStatus.ARCHIVED },
      });
      archived = res.count;
    }

    const result = {
      productsChecked: raw.products.length,
      stockFixed,
      priceFixed,
      archived,
      unlinked,
    };
    this.logger.log(
      `Reconcile ${connection.shopDomain}: ${JSON.stringify(result)}`,
    );
    return result;
  }
}
