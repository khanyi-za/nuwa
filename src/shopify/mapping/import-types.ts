/*
 * The YIIVA-shaped intermediate the mapper produces from a raw Admin-API
 * catalogue pull — Phase 1b's output and Phase 1c's (import executor) input.
 * Image URLs still point at the Shopify CDN here; rehosting to Cloudinary is
 * the executor's job. Nothing here touches the DB.
 *
 * Analogue of the demo importer's Manifest* shapes, minus the operator-curate
 * flags (no curate pass in the self-serve wizard) and plus real stock +
 * provenance the wizard can surface.
 */

import { GenderType } from '@prisma/client';
import type { GenderSource } from './heuristics';

export interface ImportImage {
  sourceUrl: string; // Shopify CDN — rehosted by the import executor
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ImportVariant {
  sourceGid: string; // gid://shopify/ProductVariant/…
  sourceId: string; // numeric variant id (webhook payloads use this form)
  inventoryItemId: string | null; // numeric — inventory webhooks/mutations key on it
  name: string; // e.g. "Black / Medium"
  sku: string | null; // RAW — the executor namespaces per store (global @unique)
  color: string | null;
  size: string | null;
  material: string | null;
  /** Shopify CDN URL of the variant's assigned image (pre-rehost). */
  imageSourceUrl: string | null;
  priceInCents: number | null; // set only when it overrides the product price
  stock: number; // REAL inventoryQuantity (clamped ≥ 0), or the untracked stand-in
  stockTracked: boolean; // false → stock is the UNTRACKED_STOCK stand-in
  sortOrder: number;
}

export interface ImportProduct {
  sourceGid: string; // gid://shopify/Product/…
  sourceId: string; // numeric legacyResourceId, as a string
  title: string;
  slug: string;
  sku: string | null; // bare products only: the default variant's raw SKU
  description: string | null;
  genderType: GenderType;
  genderSource: GenderSource;
  priceInCents: number;
  comparePriceInCents: number | null;
  weightInGrams: number;
  isBare: boolean; // no real options (just "Title") vs has variants
  totalStock: number; // bare products only (0 when isBare === false)
  stockTracked: boolean; // bare: the single default variant's tracked flag
  // Bare products only: the Shopify default variant's identities, so the
  // sync link table can map inventory webhooks onto Product.totalStock.
  bareVariant: {
    sourceGid: string;
    sourceId: string;
    inventoryItemId: string | null;
  } | null;
  variants: ImportVariant[]; // empty when isBare
  images: ImportImage[];
  suggestedCategorySlug: string | null;
  tags: string[];
  collectionSlugs: string[];
}

export interface ImportCollection {
  sourceGid: string;
  name: string;
  slug: string;
  description: string | null;
  imageSourceUrl: string | null;
  productSlugs: string[];
  sortOrder: number;
}

export interface ImportLocation {
  sourceGid: string;
  name: string;
  isActive: boolean;
}

export interface ImportCatalogue {
  products: ImportProduct[];
  collections: ImportCollection[];
  locations: ImportLocation[];
}

/** Aggregate counts + red flags for the wizard's pre-import preview. */
export interface CatalogueSummary {
  counts: {
    products: number;
    variants: number;
    images: number;
    collections: number;
    locations: number;
  };
  genders: Record<GenderType, number>;
  warnings: {
    productsWithoutImages: number;
    productsWithoutCategory: number;
    productsWithUntrackedStock: number;
    productsOutOfStock: number;
  };
}
