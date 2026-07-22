/*
 * Pure mapper: resolved Admin-API catalogue (Raw*) → YIIVA-shaped
 * ImportCatalogue. Port of the demo importer's transform stage
 * (tools/demo-importer/src/stages/transform.ts) onto GraphQL shapes:
 *
 *   - option mapping reads each variant's selectedOptions directly (GraphQL
 *     gives name+value per variant — no option-position plumbing needed)
 *   - stock is real inventoryQuantity via stockFromInventory
 *   - weight comes from the variant's inventoryItem measurement
 *
 * No I/O, no DI — spec-tested with fixtures like the heuristics.
 */

import { GenderType } from '@prisma/client';
import type {
  RawCatalogue,
  RawProduct,
  GqlVariantNode,
} from '../shopify-catalogue-types';
import type {
  CatalogueSummary,
  ImportCatalogue,
  ImportCollection,
  ImportImage,
  ImportProduct,
  ImportVariant,
} from './import-types';
import {
  inferGender,
  optionField,
  priceToCents,
  slugify,
  stockFromInventory,
  stripHtml,
  suggestCategory,
  weightToGrams,
} from './heuristics';

/** A product is "bare" when it has no real options (just "Title"). */
function isBareProduct(p: RawProduct): boolean {
  return p.options.filter((o) => o.name.toLowerCase() !== 'title').length === 0;
}

/** "gid://shopify/InventoryItem/123" → "123" (webhooks use numeric ids). */
export function numericIdFromGid(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const last = gid.split('/').pop();
  return last && /^\d+$/.test(last) ? last : null;
}

function buildVariant(
  v: GqlVariantNode,
  index: number,
  productPriceCents: number,
): ImportVariant {
  let color: string | null = null;
  let size: string | null = null;
  let material: string | null = null;
  for (const opt of v.selectedOptions) {
    const field = optionField(opt.name);
    if (!field || !opt.value) continue;
    if (field === 'color') color = opt.value;
    else if (field === 'size') size = opt.value;
    else if (field === 'material') material = opt.value;
  }

  const cents = priceToCents(v.price);
  const tracked = v.inventoryItem?.tracked ?? true;
  return {
    sourceGid: v.id,
    sourceId: v.legacyResourceId,
    inventoryItemId: numericIdFromGid(v.inventoryItem?.id),
    name:
      v.title && v.title !== 'Default Title' ? v.title : `Variant ${index + 1}`,
    sku: v.sku && v.sku.trim() !== '' ? v.sku.trim() : null,
    color,
    size,
    material,
    priceInCents: cents != null && cents !== productPriceCents ? cents : null,
    stock: stockFromInventory(v.inventoryQuantity, tracked),
    stockTracked: tracked,
    sortOrder: v.position ?? index,
  };
}

function buildImages(p: RawProduct): ImportImage[] {
  return p.images.map((img, i) => ({
    sourceUrl: img.url,
    altText: img.altText ?? p.title,
    sortOrder: i,
    isPrimary: i === 0,
  }));
}

/** Map one resolved product. Exported for single-product sync (Phase 2). */
export function mapProduct(
  p: RawProduct,
  collectionSlugs: string[],
): ImportProduct {
  const bare = isBareProduct(p);
  const prices = p.variants
    .map((v) => priceToCents(v.price))
    .filter((n): n is number => n != null);
  const priceInCents = prices.length ? Math.min(...prices) : 0;
  const compare = priceToCents(p.variants[0]?.compareAtPrice ?? null);
  const { gender, source } = inferGender({
    tags: p.tags,
    productType: p.productType,
    title: p.title,
  });

  const variants = bare
    ? []
    : p.variants.map((v, i) => buildVariant(v, i, priceInCents));

  const defaultVariant = p.variants[0];
  const bareTracked = defaultVariant?.inventoryItem?.tracked ?? true;

  return {
    sourceGid: p.id,
    sourceId: p.legacyResourceId,
    title: p.title,
    slug: p.handle || slugify(p.title),
    sku:
      bare && defaultVariant?.sku && defaultVariant.sku.trim() !== ''
        ? defaultVariant.sku.trim()
        : null,
    description: stripHtml(p.descriptionHtml),
    genderType: gender,
    genderSource: source,
    priceInCents,
    comparePriceInCents: compare && compare > priceInCents ? compare : null,
    weightInGrams: weightToGrams(
      defaultVariant?.inventoryItem?.measurement?.weight,
    ),
    isBare: bare,
    totalStock: bare
      ? stockFromInventory(defaultVariant?.inventoryQuantity, bareTracked)
      : 0,
    stockTracked: bare
      ? bareTracked
      : p.variants.every((v) => v.inventoryItem?.tracked ?? true),
    bareVariant:
      bare && defaultVariant
        ? {
            sourceGid: defaultVariant.id,
            sourceId: defaultVariant.legacyResourceId,
            inventoryItemId: numericIdFromGid(defaultVariant.inventoryItem?.id),
          }
        : null,
    variants,
    images: buildImages(p),
    suggestedCategorySlug: suggestCategory({
      tags: p.tags,
      productType: p.productType,
      title: p.title,
    }),
    tags: p.tags,
    collectionSlugs,
  };
}

export function mapCatalogue(raw: RawCatalogue): ImportCatalogue {
  // Product gid → slug, to translate collection membership gid-lists.
  const gidToSlug = new Map<string, string>();
  raw.products.forEach((p) =>
    gidToSlug.set(p.id, p.handle || slugify(p.title)),
  );

  // Product slug → collection handles it belongs to (membership inverted).
  const productCollections = new Map<string, string[]>();
  for (const c of raw.collections) {
    for (const pid of c.productIds) {
      const pslug = gidToSlug.get(pid);
      if (!pslug) continue; // member outside the pulled (ACTIVE) set
      const list = productCollections.get(pslug) ?? [];
      list.push(c.handle);
      productCollections.set(pslug, list);
    }
  }

  const products = raw.products.map((p) => {
    const pslug = p.handle || slugify(p.title);
    return mapProduct(p, productCollections.get(pslug) ?? []);
  });

  const collections: ImportCollection[] = raw.collections.map((c, i) => ({
    sourceGid: c.id,
    name: c.title,
    slug: c.handle,
    description: stripHtml(c.descriptionHtml),
    imageSourceUrl: c.imageUrl,
    productSlugs: c.productIds
      .map((id) => gidToSlug.get(id))
      .filter((s): s is string => Boolean(s)),
    sortOrder: i,
  }));

  return {
    products,
    collections,
    locations: raw.locations.map((l) => ({
      sourceGid: l.id,
      name: l.name,
      isActive: l.isActive,
    })),
  };
}

/** Effective sellable stock of a mapped product (bare or variant-summed). */
export function productStock(p: ImportProduct): number {
  return p.isBare
    ? p.totalStock
    : p.variants.reduce((sum, v) => sum + v.stock, 0);
}

export function summarizeCatalogue(cat: ImportCatalogue): CatalogueSummary {
  const genders: Record<GenderType, number> = {
    [GenderType.WOMEN]: 0,
    [GenderType.MEN]: 0,
    [GenderType.UNISEX]: 0,
  };
  let variants = 0;
  let images = 0;
  let withoutImages = 0;
  let withoutCategory = 0;
  let untracked = 0;
  let outOfStock = 0;

  for (const p of cat.products) {
    genders[p.genderType] += 1;
    variants += p.variants.length;
    images += p.images.length;
    if (p.images.length === 0) withoutImages += 1;
    if (!p.suggestedCategorySlug) withoutCategory += 1;
    if (!p.stockTracked) untracked += 1;
    if (productStock(p) === 0) outOfStock += 1;
  }

  return {
    counts: {
      products: cat.products.length,
      variants,
      images,
      collections: cat.collections.length,
      locations: cat.locations.length,
    },
    genders,
    warnings: {
      productsWithoutImages: withoutImages,
      productsWithoutCategory: withoutCategory,
      productsWithUntrackedStock: untracked,
      productsOutOfStock: outOfStock,
    },
  };
}
