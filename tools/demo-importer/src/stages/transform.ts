import * as fs from 'fs';
import * as path from 'path';

import { assertValidSlug, brandDir, rawDir } from '../config';
import { log } from '../logger';
import type {
  Manifest,
  ManifestCollection,
  ManifestImage,
  ManifestProduct,
  ManifestVariant,
} from '../manifest/types';
import type { ShopifyCollection, ShopifyProduct } from '../shopify/types';
import {
  inferGender,
  namespaceSku,
  optionField,
  priceToCents,
  slugify,
  stockFor,
  stripHtml,
  suggestCategory,
  weightWithFallback,
} from '../transform/heuristics';

interface Membership {
  [handle: string]: { title: string; productIds: number[] };
}
interface ExtractMeta {
  baseUrl: string;
  probeOk: boolean;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

/** A Shopify product is "bare" when it has no real options (just Default Title). */
function isBareProduct(p: ShopifyProduct): boolean {
  const real = (p.options ?? []).filter((o) => o.name.toLowerCase() !== 'title');
  return real.length === 0;
}

function buildVariants(p: ShopifyProduct, brandSlug: string, productPriceCents: number): ManifestVariant[] {
  // Map each option slot (1/2/3) to a YIIVA field by the option NAME's content.
  const slotField: (ReturnType<typeof optionField>)[] = [null, null, null];
  (p.options ?? []).forEach((o) => {
    if (o.position >= 1 && o.position <= 3) slotField[o.position - 1] = optionField(o.name);
  });

  return p.variants.map((v, i) => {
    const opts = [v.option1, v.option2, v.option3];
    let color: string | null = null;
    let size: string | null = null;
    let material: string | null = null;
    slotField.forEach((field, idx) => {
      const val = opts[idx];
      if (!val) return;
      if (field === 'color') color = val;
      else if (field === 'size') size = val;
      else if (field === 'material') material = val;
    });
    const cents = priceToCents(v.price);
    return {
      name: v.title && v.title !== 'Default Title' ? v.title : `Variant ${i + 1}`,
      sku: namespaceSku(brandSlug, v.sku),
      color,
      size,
      material,
      priceInCents: cents != null && cents !== productPriceCents ? cents : null,
      stock: stockFor(v.available),
      sortOrder: v.position ?? i,
    };
  });
}

function buildImages(p: ShopifyProduct): ManifestImage[] {
  const sorted = [...(p.images ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return sorted.map((img, i) => ({
    sourceUrl: img.src,
    altText: p.title,
    sortOrder: i,
    isPrimary: i === 0,
  }));
}

function buildProduct(p: ShopifyProduct, brandSlug: string, collectionSlugs: string[]): ManifestProduct {
  const bare = isBareProduct(p);
  const prices = p.variants.map((v) => priceToCents(v.price)).filter((n): n is number => n != null);
  const priceInCents = prices.length ? Math.min(...prices) : 0;
  const compare = priceToCents(p.variants[0]?.compare_at_price ?? null);
  const { gender, source } = inferGender({ tags: p.tags, productType: p.product_type, title: p.title });
  const images = buildImages(p);
  const variants = bare ? [] : buildVariants(p, brandSlug, priceInCents);
  const totalStock = bare ? stockFor(p.variants[0]?.available ?? false) : 0;
  const hasStock = bare ? totalStock > 0 : variants.some((v) => v.stock > 0);

  return {
    include: images.length > 0 && hasStock, // pre-filled curate flag
    sourceId: p.id,
    title: p.title,
    slug: p.handle || slugify(p.title),
    description: stripHtml(p.body_html),
    genderType: gender,
    genderSource: source,
    priceInCents,
    comparePriceInCents: compare && compare > priceInCents ? compare : null,
    weightInGrams: weightWithFallback(p.variants[0]?.grams),
    isBare: bare,
    totalStock,
    variants,
    images,
    suggestedCategorySlug: suggestCategory({ tags: p.tags, productType: p.product_type, title: p.title }),
    tags: p.tags ?? [],
    collectionSlugs,
  };
}

export async function runTransform({ slug }: { slug: string }): Promise<void> {
  assertValidSlug(slug);
  const raw = rawDir(slug);
  if (!fs.existsSync(path.join(raw, 'products.json'))) {
    throw new Error(`No raw data for "${slug}". Run: extract ${slug} --url <storefront> first.`);
  }

  log.step(`Transform: ${slug}`);
  const meta = readJson<ExtractMeta>(path.join(brandDir(slug), '_meta.json'));
  const products = readJson<ShopifyProduct[]>(path.join(raw, 'products.json'));
  const collections = readJson<ShopifyCollection[]>(path.join(raw, 'collections.json'));
  const membership = readJson<Membership>(path.join(raw, 'collection-membership.json'));

  // Shopify product id → YIIVA slug (handle), to translate membership id-lists.
  const idToSlug = new Map<number, string>();
  products.forEach((p) => idToSlug.set(p.id, p.handle || slugify(p.title)));

  // product slug → collection slugs it belongs to.
  const productCollections = new Map<string, string[]>();
  for (const c of collections) {
    const member = membership[c.handle];
    if (!member) continue;
    for (const pid of member.productIds) {
      const pslug = idToSlug.get(pid);
      if (!pslug) continue;
      const list = productCollections.get(pslug) ?? [];
      list.push(c.handle);
      productCollections.set(pslug, list);
    }
  }

  const manifestProducts = products.map((p) => {
    const pslug = p.handle || slugify(p.title);
    return buildProduct(p, slug, productCollections.get(pslug) ?? []);
  });

  const manifestCollections: ManifestCollection[] = collections.map((c, i) => ({
    include: true,
    name: c.title,
    slug: c.handle,
    description: stripHtml(c.description),
    imageSourceUrl: c.image?.src ?? null,
    productSlugs: (membership[c.handle]?.productIds ?? [])
      .map((id) => idToSlug.get(id))
      .filter((s): s is string => Boolean(s)),
    sortOrder: i,
  }));

  // Brand display name from the modal vendor; fall back to a titlecased slug.
  // Guard against Shopify's default placeholder vendors (e.g. "My Store"), which
  // would otherwise show as the brand name everywhere in the demo.
  const isPlaceholderVendor = (v: string): boolean =>
    /^(my store|store|home page|frontpage)$/i.test(v.trim()) || /\.myshopify\.com$/i.test(v.trim());
  const titlecasedSlug = slug.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  const vendorCounts = new Map<string, number>();
  products.forEach((p) => {
    if (p.vendor && !isPlaceholderVendor(p.vendor)) {
      vendorCounts.set(p.vendor, (vendorCounts.get(p.vendor) ?? 0) + 1);
    }
  });
  const topVendor = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const displayName = topVendor ?? titlecasedSlug;

  const manifest: Manifest = {
    brandSlug: slug,
    generatedAt: new Date().toISOString(),
    store: {
      displayName,
      companyName: displayName,
      slug,
      description: null, // operator may add in curate
      websiteUrl: meta.baseUrl,
      logoSourceUrl: null, // added in curate / later homepage scrape
    },
    collections: manifestCollections,
    products: manifestProducts,
    videos: [], // operator fills in during Curate (Phase 3)
  };

  fs.writeFileSync(path.join(brandDir(slug), 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Summary.
  const included = manifestProducts.filter((p) => p.include).length;
  const gender = { WOMEN: 0, MEN: 0, UNISEX: 0 };
  manifestProducts.forEach((p) => (gender[p.genderType] += 1));
  const bareCount = manifestProducts.filter((p) => p.isBare).length;
  const noCat = manifestProducts.filter((p) => !p.suggestedCategorySlug).length;

  log.step('Transform summary');
  log.ok(`store displayName:  ${displayName}`);
  log.ok(`products:           ${manifestProducts.length} (${included} pre-included)`);
  log.ok(`gender:             W ${gender.WOMEN} / M ${gender.MEN} / U ${gender.UNISEX}`);
  log.ok(`bare vs variant:    ${bareCount} bare / ${manifestProducts.length - bareCount} with variants`);
  log.ok(`collections:        ${manifestCollections.length}`);
  if (noCat > 0) log.warn(`${noCat} products got no category suggestion (review in curate)`);
  log.info(`manifest → ${path.join(brandDir(slug), 'manifest.json')}`);
}
