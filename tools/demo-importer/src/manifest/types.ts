/*
 * The YIIVA-shaped intermediate produced by Transform (Phase 2) and consumed by
 * Curate → Rehost → Load. Image/logo URLs still point at the Shopify CDN here;
 * rehosting to Cloudinary happens in a later stage. Nothing here touches the DB.
 */

export type GenderType = 'WOMEN' | 'MEN' | 'UNISEX';

/** Which signal produced the genderType — so the curate pass knows what to trust. */
export type GenderSource = 'tag' | 'type' | 'title' | 'default';

export interface ManifestImage {
  sourceUrl: string; // Shopify CDN src (rehosted in a later stage)
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ManifestVariant {
  name: string; // e.g. "Black / Medium"
  sku: string | null; // namespaced per brand to dodge the global @unique constraint
  color: string | null;
  size: string | null;
  material: string | null;
  priceInCents: number | null; // set only when it overrides the product price
  stock: number;
  sortOrder: number;
}

export interface ManifestProduct {
  include: boolean; // curate flag — pre-filled, operator trims
  sourceId: number; // Shopify product id (for traceability)
  title: string;
  slug: string;
  description: string | null;
  genderType: GenderType;
  genderSource: GenderSource;
  priceInCents: number;
  comparePriceInCents: number | null;
  weightInGrams: number;
  isBare: boolean; // bare product (no real options) vs has variants
  totalStock: number; // bare products only (0 when isBare === false)
  variants: ManifestVariant[]; // empty when isBare
  images: ManifestImage[];
  suggestedCategorySlug: string | null;
  tags: string[];
  collectionSlugs: string[];
}

export interface ManifestCollection {
  include: boolean;
  name: string;
  slug: string;
  description: string | null;
  imageSourceUrl: string | null;
  productSlugs: string[];
  sortOrder: number;
}

/** Filled in by the operator during Curate (Phase 3). Empty after Transform. */
export interface ManifestVideo {
  url: string;
  target: 'hero' | 'product';
  productSlug?: string;
}

export interface ManifestStore {
  displayName: string;
  companyName: string;
  slug: string;
  description: string | null;
  websiteUrl: string;
  logoSourceUrl: string | null;
}

export interface Manifest {
  brandSlug: string;
  generatedAt: string;
  store: ManifestStore;
  collections: ManifestCollection[];
  products: ManifestProduct[];
  videos: ManifestVideo[];
}
