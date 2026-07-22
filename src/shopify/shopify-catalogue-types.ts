/*
 * Wire-format shapes for the Admin GraphQL catalogue pull. Only the fields
 * the mapper consumes are typed. Two layers:
 *
 *   - Gql* — exact node shapes as they come off the connections (with
 *     pageInfo wrappers), private to ShopifyCatalogueService's queries
 *   - Raw* — the service's output: the same data with all pagination
 *     resolved (variants/media/membership continuations merged), which the
 *     mapper consumes without knowing pagination existed
 */

export interface GqlPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface GqlWeight {
  unit: string; // GRAMS | KILOGRAMS | OUNCES | POUNDS
  value: number;
}

export interface GqlVariantNode {
  id: string; // gid://shopify/ProductVariant/…
  title: string;
  sku: string | null;
  position: number;
  price: string; // Money decimal string, e.g. "3600.00"
  compareAtPrice: string | null;
  inventoryQuantity: number | null; // aggregate across locations; can be negative
  selectedOptions: { name: string; value: string }[];
  inventoryItem: {
    tracked: boolean;
    measurement: { weight: GqlWeight | null } | null;
  } | null;
}

/** Media node — only MediaImage carries `image`; other media types map to null. */
export interface GqlMediaNode {
  mediaContentType: string;
  image?: { url: string; altText: string | null } | null;
}

export interface GqlProductNode {
  id: string; // gid://shopify/Product/…
  legacyResourceId: string; // numeric id as string (webhooks use this form)
  title: string;
  handle: string;
  descriptionHtml: string | null;
  vendor: string;
  productType: string;
  tags: string[];
  options: { name: string; position: number }[];
  variants: { pageInfo: GqlPageInfo; nodes: GqlVariantNode[] };
  media: { pageInfo: GqlPageInfo; nodes: GqlMediaNode[] };
}

export interface GqlCollectionNode {
  id: string; // gid://shopify/Collection/…
  handle: string;
  title: string;
  descriptionHtml: string | null;
  image: { url: string } | null;
  products: { pageInfo: GqlPageInfo; nodes: { id: string }[] };
}

export interface GqlLocationNode {
  id: string;
  name: string;
  isActive: boolean;
}

// ── Resolved (pagination-free) shapes ──────────────────────────────────────

export interface RawImage {
  url: string;
  altText: string | null;
}

export interface RawProduct {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  descriptionHtml: string | null;
  vendor: string;
  productType: string;
  tags: string[];
  options: { name: string; position: number }[];
  variants: GqlVariantNode[];
  images: RawImage[];
}

export interface RawCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  imageUrl: string | null;
  productIds: string[]; // member product gids
}

export interface RawLocation {
  id: string;
  name: string;
  isActive: boolean;
}

export interface RawCatalogue {
  products: RawProduct[];
  collections: RawCollection[];
  locations: RawLocation[];
}
