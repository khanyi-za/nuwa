import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import {
  GqlCollectionNode,
  GqlLocationNode,
  GqlMediaNode,
  GqlPageInfo,
  GqlProductNode,
  GqlVariantNode,
  RawCatalogue,
  RawCollection,
  RawImage,
  RawProduct,
} from './shopify-catalogue-types';
import {
  mapCatalogue,
  productStock,
  summarizeCatalogue,
} from './mapping/catalogue-mapper';
import { ImportCatalogue } from './mapping/import-types';

/*
 * Page sizes are cost-budgeted: Shopify's GraphQL cost model charges
 * connections 2 + first×(child cost), single query capped at 1,000 points.
 * The products page (10 × [30 variants + 15 media + options]) lands ~800.
 * Products whose nested connections overflow a page are completed with
 * per-product continuation queries — rare (most catalogues fit), so the
 * common case stays at ~1 request per 10 products.
 */
const PRODUCTS_PAGE = 10;
const VARIANTS_FIRST = 30;
const MEDIA_FIRST = 15;
const VARIANTS_CONTINUE = 100;
const MEDIA_CONTINUE = 100;
const COLLECTIONS_PAGE = 15;
const COLLECTION_PRODUCTS_FIRST = 50;
const COLLECTION_PRODUCTS_CONTINUE = 250;
const MAX_PAGE_LOOPS = 500; // runaway-cursor safety valve (~5,000 products)

const PAGE_INFO = `pageInfo { hasNextPage endCursor }`;

const VARIANT_FIELDS = `
  id
  legacyResourceId
  title
  sku
  position
  price
  compareAtPrice
  inventoryQuantity
  selectedOptions { name value }
  image { url }
  inventoryItem { id tracked measurement { weight { unit value } } }
`;

const MEDIA_FIELDS = `
  mediaContentType
  ... on MediaImage { image { url altText } }
`;

const PRODUCT_NODE_FIELDS = `
  id
  legacyResourceId
  title
  handle
  descriptionHtml
  vendor
  productType
  tags
  options { name position }
  variants(first: ${VARIANTS_FIRST}) { ${PAGE_INFO} nodes { ${VARIANT_FIELDS} } }
  media(first: ${MEDIA_FIRST}) { ${PAGE_INFO} nodes { ${MEDIA_FIELDS} } }
`;

const PRODUCTS_QUERY = `
  query CataloguePage($cursor: String) {
    products(first: ${PRODUCTS_PAGE}, after: $cursor, query: "status:active") {
      ${PAGE_INFO}
      nodes { ${PRODUCT_NODE_FIELDS} }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = `
  query SingleProduct($id: ID!) {
    product(id: $id) { ${PRODUCT_NODE_FIELDS} }
  }
`;

const VARIANTS_CONTINUE_QUERY = `
  query VariantsPage($id: ID!, $cursor: String) {
    product(id: $id) {
      variants(first: ${VARIANTS_CONTINUE}, after: $cursor) { ${PAGE_INFO} nodes { ${VARIANT_FIELDS} } }
    }
  }
`;

const MEDIA_CONTINUE_QUERY = `
  query MediaPage($id: ID!, $cursor: String) {
    product(id: $id) {
      media(first: ${MEDIA_CONTINUE}, after: $cursor) { ${PAGE_INFO} nodes { ${MEDIA_FIELDS} } }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query CollectionsPage($cursor: String) {
    collections(first: ${COLLECTIONS_PAGE}, after: $cursor) {
      ${PAGE_INFO}
      nodes {
        id
        handle
        title
        descriptionHtml
        image { url }
        products(first: ${COLLECTION_PRODUCTS_FIRST}) { ${PAGE_INFO} nodes { id } }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_CONTINUE_QUERY = `
  query CollectionProductsPage($id: ID!, $cursor: String) {
    collection(id: $id) {
      products(first: ${COLLECTION_PRODUCTS_CONTINUE}, after: $cursor) { ${PAGE_INFO} nodes { id } }
    }
  }
`;

const LOCATIONS_QUERY = `
  query Locations {
    locations(first: 50) { nodes { id name isActive } }
  }
`;

/**
 * ShopifyCatalogueService — Phase 1b: the full paginated catalogue pull
 * (ACTIVE products with variants/images, collections with membership,
 * locations) plus the wizard's pre-import preview.
 *
 * pull() is read-only orchestration over ShopifyClient (which owns throttle
 * retries) and returns pagination-resolved Raw* shapes; mapping to YIIVA
 * shapes is the pure catalogue-mapper. The Phase 1c import executor composes
 * the same pull + map and then writes.
 */
@Injectable()
export class ShopifyCatalogueService {
  private readonly logger = new Logger(ShopifyCatalogueService.name);

  constructor(
    private readonly client: ShopifyClient,
    private readonly connections: ShopifyConnectionService,
  ) {}

  /**
   * Pre-import preview for the onboarding wizard: validates the token +
   * currency live, pulls + maps the whole catalogue, returns summary counts,
   * warnings, and a sample — nothing is written anywhere.
   */
  async previewForUser(userId: string) {
    const { shopDomain, accessToken } =
      await this.connections.getActiveWithToken(userId);

    // Fresh shop call: validates the token now (not at connect time) and
    // re-checks currency — the ZAR gate guards import honesty, so it uses
    // live data, not the stored snapshot.
    const info = await this.client.fetchShopInfo(shopDomain, accessToken);
    if (info.currencyCode !== 'ZAR') {
      throw new BadRequestException({
        code: 'SHOP_CURRENCY_UNSUPPORTED',
        message: `This shop trades in ${info.currencyCode}. YIIVA is ZAR-only — prices cannot be converted honestly, so this catalogue cannot be imported.`,
      });
    }

    const catalogue = await this.getImportCatalogue(shopDomain, accessToken);

    return {
      shop: {
        name: info.name,
        domain: shopDomain,
        currencyCode: info.currencyCode,
      },
      ...summarizeCatalogue(catalogue),
      sample: catalogue.products.slice(0, 10).map((p) => ({
        title: p.title,
        priceInCents: p.priceInCents,
        genderType: p.genderType,
        suggestedCategorySlug: p.suggestedCategorySlug,
        imageCount: p.images.length,
        variantCount: p.variants.length,
        stock: productStock(p),
      })),
    };
  }

  /** Pull + map in one step — the shape the import executor consumes. */
  async getImportCatalogue(
    shopDomain: string,
    accessToken: string,
  ): Promise<ImportCatalogue> {
    return mapCatalogue(await this.pull(shopDomain, accessToken));
  }

  /** Full catalogue pull with all nested pagination resolved. */
  async pull(shopDomain: string, accessToken: string): Promise<RawCatalogue> {
    // Sequential on purpose — all three share one shop cost bucket, so
    // parallel pulls would just throttle each other.
    const products = await this.pullProducts(shopDomain, accessToken);
    const collections = await this.pullCollections(shopDomain, accessToken);
    const locations = await this.pullLocations(shopDomain, accessToken);
    this.logger.log(
      `Catalogue pulled: ${shopDomain} — ${products.length} products, ${collections.length} collections, ${locations.length} locations`,
    );
    return { products, collections, locations };
  }

  /**
   * One product by its numeric id (webhook payload form), with nested
   * pagination resolved. Null when it doesn't exist / isn't accessible.
   * Phase 2 sync uses this for products/create so the written product goes
   * through the exact same shapes as the bulk import.
   */
  async fetchProduct(
    shopDomain: string,
    accessToken: string,
    numericProductId: string,
  ): Promise<RawProduct | null> {
    const data = await this.client.graphql<{
      product: GqlProductNode | null;
    }>(shopDomain, accessToken, SINGLE_PRODUCT_QUERY, {
      id: `gid://shopify/Product/${numericProductId}`,
    });
    if (!data.product) return null;
    return this.resolveProduct(shopDomain, accessToken, data.product);
  }

  private async pullProducts(
    shopDomain: string,
    accessToken: string,
  ): Promise<RawProduct[]> {
    const products: RawProduct[] = [];
    let cursor: string | null = null;

    for (let loop = 0; ; loop++) {
      this.assertLoopBudget(loop, 'products');
      const data = await this.client.graphql<{
        products: { pageInfo: GqlPageInfo; nodes: GqlProductNode[] };
      }>(shopDomain, accessToken, PRODUCTS_QUERY, { cursor });

      for (const node of data.products.nodes) {
        products.push(await this.resolveProduct(shopDomain, accessToken, node));
      }

      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.pageInfo.endCursor;
    }
    return products;
  }

  /** Merge a product node's variant/media continuations (rarely needed). */
  private async resolveProduct(
    shopDomain: string,
    accessToken: string,
    node: GqlProductNode,
  ): Promise<RawProduct> {
    const variants = [...node.variants.nodes];
    let vPage = node.variants.pageInfo;
    for (let loop = 0; vPage.hasNextPage; loop++) {
      this.assertLoopBudget(loop, `variants of ${node.handle}`);
      const data = await this.client.graphql<{
        product: {
          variants: { pageInfo: GqlPageInfo; nodes: GqlVariantNode[] };
        } | null;
      }>(shopDomain, accessToken, VARIANTS_CONTINUE_QUERY, {
        id: node.id,
        cursor: vPage.endCursor,
      });
      if (!data.product) break; // product vanished mid-pull — keep what we have
      variants.push(...data.product.variants.nodes);
      vPage = data.product.variants.pageInfo;
    }

    const media = [...node.media.nodes];
    let mPage = node.media.pageInfo;
    for (let loop = 0; mPage.hasNextPage; loop++) {
      this.assertLoopBudget(loop, `media of ${node.handle}`);
      const data = await this.client.graphql<{
        product: {
          media: { pageInfo: GqlPageInfo; nodes: GqlMediaNode[] };
        } | null;
      }>(shopDomain, accessToken, MEDIA_CONTINUE_QUERY, {
        id: node.id,
        cursor: mPage.endCursor,
      });
      if (!data.product) break;
      media.push(...data.product.media.nodes);
      mPage = data.product.media.pageInfo;
    }

    return {
      id: node.id,
      legacyResourceId: node.legacyResourceId,
      title: node.title,
      handle: node.handle,
      descriptionHtml: node.descriptionHtml,
      vendor: node.vendor,
      productType: node.productType,
      tags: node.tags,
      options: node.options,
      variants,
      // Only images become YIIVA product media in v1; videos/3D are skipped.
      images: media
        .filter((m): m is GqlMediaNode & { image: RawImage } =>
          Boolean(m.image?.url),
        )
        .map((m) => ({ url: m.image.url, altText: m.image.altText ?? null })),
    };
  }

  private async pullCollections(
    shopDomain: string,
    accessToken: string,
  ): Promise<RawCollection[]> {
    const collections: RawCollection[] = [];
    let cursor: string | null = null;

    for (let loop = 0; ; loop++) {
      this.assertLoopBudget(loop, 'collections');
      const data = await this.client.graphql<{
        collections: { pageInfo: GqlPageInfo; nodes: GqlCollectionNode[] };
      }>(shopDomain, accessToken, COLLECTIONS_QUERY, { cursor });

      for (const node of data.collections.nodes) {
        const productIds = [...node.products.nodes.map((p) => p.id)];
        let pPage = node.products.pageInfo;
        for (let mLoop = 0; pPage.hasNextPage; mLoop++) {
          this.assertLoopBudget(mLoop, `members of ${node.handle}`);
          const page = await this.client.graphql<{
            collection: {
              products: { pageInfo: GqlPageInfo; nodes: { id: string }[] };
            } | null;
          }>(shopDomain, accessToken, COLLECTION_PRODUCTS_CONTINUE_QUERY, {
            id: node.id,
            cursor: pPage.endCursor,
          });
          if (!page.collection) break;
          productIds.push(...page.collection.products.nodes.map((p) => p.id));
          pPage = page.collection.products.pageInfo;
        }
        collections.push({
          id: node.id,
          handle: node.handle,
          title: node.title,
          descriptionHtml: node.descriptionHtml,
          imageUrl: node.image?.url ?? null,
          productIds,
        });
      }

      if (!data.collections.pageInfo.hasNextPage) break;
      cursor = data.collections.pageInfo.endCursor;
    }
    return collections;
  }

  /**
   * Locations need the read_locations scope, which a merchant's custom app
   * may not have granted. They only matter for Phase 2 (stock decrement), so
   * a denied/failed locations read degrades to [] instead of failing the pull.
   */
  private async pullLocations(
    shopDomain: string,
    accessToken: string,
  ): Promise<GqlLocationNode[]> {
    try {
      const data = await this.client.graphql<{
        locations: { nodes: GqlLocationNode[] };
      }>(shopDomain, accessToken, LOCATIONS_QUERY);
      return data.locations.nodes;
    } catch (err) {
      this.logger.warn(
        `Locations unavailable for ${shopDomain} (likely missing read_locations scope): ${(err as Error).message}`,
      );
      return [];
    }
  }

  private assertLoopBudget(loop: number, what: string) {
    if (loop >= MAX_PAGE_LOOPS) {
      throw new Error(
        `Shopify pagination exceeded ${MAX_PAGE_LOOPS} pages while pulling ${what} — aborting as a runaway-cursor guard`,
      );
    }
  }
}
