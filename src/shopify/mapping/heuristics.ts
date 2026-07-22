/*
 * Pure Shopify→YIIVA mapping helpers. No I/O, no DI. Ported from the demo
 * importer (tools/demo-importer/src/transform/heuristics.ts) — the mapping the
 * importer de-risked across 28 real SA storefronts — with two deltas for the
 * consented Admin-API world:
 *
 *   - weight arrives as a unit+value measurement (GraphQL), not raw grams
 *   - stock is REAL (inventoryQuantity), not fabricated; the only fabrication
 *     left is the untracked-inventory fallback (Shopify sells untracked items
 *     regardless of quantity, so "20" stands in for "always available")
 *
 * Heuristics are deliberately simple (no LLM). Tuned findings: option names
 * are messy, so map by name *content*; product_type is unreliable, so
 * gender/category lean on tags first; weight is often missing → fallback.
 */

import { GenderType } from '@prisma/client';

export const WEIGHT_FALLBACK_GRAMS = 500; // matches the shipping module's null-weight assumption
export const UNTRACKED_STOCK = 20; // untracked inventory = "always available" stand-in

/** Which signal produced the genderType — provenance for the wizard/review UI. */
export type GenderSource = 'tag' | 'type' | 'title' | 'default';

/** Money decimal string ("799.99") → integer cents, float-safe. */
export function priceToCents(price: string | null | undefined): number | null {
  if (price == null || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const GRAMS_PER: Record<string, number> = {
  GRAMS: 1,
  KILOGRAMS: 1000,
  OUNCES: 28.3495,
  POUNDS: 453.592,
};

/** GraphQL weight measurement → integer grams, with the shipping fallback. */
export function weightToGrams(
  weight: { unit: string; value: number } | null | undefined,
): number {
  if (!weight || !weight.value || weight.value <= 0) {
    return WEIGHT_FALLBACK_GRAMS;
  }
  const factor = GRAMS_PER[weight.unit];
  if (!factor) return WEIGHT_FALLBACK_GRAMS;
  return Math.round(weight.value * factor);
}

/**
 * Real stock from the Admin API. Tracked → clamp at 0 (Shopify allows
 * negative/oversold quantities YIIVA's reserve model can't represent);
 * untracked → the always-available stand-in.
 */
export function stockFromInventory(
  quantity: number | null | undefined,
  tracked: boolean,
): number {
  if (!tracked) return UNTRACKED_STOCK;
  return Math.max(0, quantity ?? 0);
}

export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// "women" contains "men" but \bmen\b won't match it (the 'm' isn't on a word
// boundary), so these two patterns stay disjoint.
const WOMEN_RE =
  /\b(womens?|woman|ladies|lady|female|girls?)\b|\b(dress|gown|skirt|blouse|heels|bodycon)\b/i;
const MEN_RE = /\b(mens?|man|male|boys?|menswear)\b/i;

/**
 * Infer gender from the richest signal available, in priority order.
 * Returns UNISEX when a source is ambiguous (matches both) or silent.
 */
export function inferGender(opts: {
  tags: string[];
  productType: string;
  title: string;
}): { gender: GenderType; source: GenderSource } {
  const sources: { text: string; source: GenderSource }[] = [
    { text: opts.tags.join(' '), source: 'tag' },
    { text: opts.productType, source: 'type' },
    { text: opts.title, source: 'title' },
  ];
  for (const { text, source } of sources) {
    const w = WOMEN_RE.test(text);
    const m = MEN_RE.test(text);
    if (w && !m) return { gender: GenderType.WOMEN, source };
    if (m && !w) return { gender: GenderType.MEN, source };
  }
  return { gender: GenderType.UNISEX, source: 'default' };
}

/** Map a Shopify option name to a YIIVA variant field by its content. */
export function optionField(
  name: string,
): 'color' | 'size' | 'material' | null {
  const n = name.toLowerCase();
  if (/colou?r/.test(n)) return 'color';
  if (/size/.test(n)) return 'size';
  if (/material|fabric/.test(n)) return 'material';
  return null;
}

// Targets the seeded platform category tree. Derived from a 50-brand /
// 5,386-product corpus sweep of the target-brand listing (2026-07-02).
// ORDER MATTERS — first match wins, so specific rules run before generic ones
// (e.g. tees before tops: \bshirt\b also matches "t-shirt"; leggings hit
// activewear before pants; lingerie vocabulary before swimwear/tops so
// bodysuits/garters don't leak). The import executor links only categories
// that exist in the DB, so unstocked slugs are harmless.
const CATEGORY_RULES: { slug: string; re: RegExp }[] = [
  { slug: 'dresses', re: /\b(dress|gown)\b/i },
  { slug: 'skirts', re: /\bskirts?\b/i },
  { slug: 'sets', re: /\b(sets?|co-?ords?|two[- ]?piece|tracksuits?)\b/i },
  {
    slug: 'underwear',
    re: /\b(lingerie|underwear|intimates?|bralettes?|bras?|knickers?|panties|panty|briefs?|thongs?|g-?strings?|bodysuits?|garters?|garter ?belts?|suspenders?|harness(es)?|corsets?|teddy|teddies|babydolls?|chemises?|negligees?|crotchless|boxers?)\b/i,
  },
  { slug: 'swimwear', re: /\b(swim|bikinis?|boardshorts?)\b/i },
  {
    slug: 'activewear',
    re: /\b(active|gym|sports?|leggings?|tights?|training|yoga|workout|performance)\b/i,
  },
  { slug: 'eyewear', re: /\b(eyewear|sunglasses|shades|optical)\b/i },
  { slug: 'headwear', re: /\b(caps?|hats?|beanies?|bucket hat|headwear|visors?)\b/i },
  {
    slug: 'jewellery',
    re: /\b(jewell?ery|earrings?|necklaces?|bracelets?|rings?|pendants?|chains?)\b/i,
  },
  {
    slug: 'bags',
    re: /\b(bags?|totes?|backpacks?|slings?|pouch|clutch|purses?|wallets?)\b/i,
  },
  {
    slug: 'footwear',
    re: /\b(shoes?|sneakers?|footwear|sandals?|slides?|boots?|slippers?|vell?ies?)\b/i,
  },
  { slug: 'hoodies', re: /\b(hoodies?|sweatshirts?|sweats|fleece)\b/i },
  {
    slug: 'knitwear',
    re: /\b(knits?|knitted|golfers?|jerseys?|sweaters?|cardigans?|pullovers?|crew ?necks?|jumpers?)\b/i,
  },
  {
    slug: 'jackets',
    re: /\b(jackets?|coats?|puffers?|bombers?|blazers?|outerwear|windbreakers?|parkas?)\b/i,
  },
  { slug: 'tees', re: /\b(t-?shirts?|tees?)\b/i },
  { slug: 'shorts', re: /\bshorts?\b/i },
  {
    slug: 'pants',
    re: /\b(pants?|trousers?|chinos?|joggers?|sweatpants?|cargos?|jeans?|denim)\b/i,
  },
  {
    slug: 'accessories',
    re: /\b(accessor|belts?|socks?|scarf|scarves|gloves?|keyrings?|lanyards?)\b/i,
  },
  {
    slug: 'tops',
    re: /\b(tops?|shirts?|blouses?|crop|bodysuits?|camisoles?|vests?|polos?)\b/i,
  },
];

export function suggestCategory(opts: {
  tags: string[];
  productType: string;
  title: string;
}): string | null {
  const hay = `${opts.tags.join(' ')} ${opts.productType} ${opts.title}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(hay)) return rule.slug;
  }
  return null;
}

/**
 * Namespace a Shopify SKU per store to dodge ProductVariant.sku's global
 * @unique constraint (different merchants legitimately reuse SKU schemes).
 * The import executor calls this with the YIIVA store slug.
 */
export function namespaceSku(
  storeSlug: string,
  sku: string | null,
): string | null {
  if (!sku || sku.trim() === '') return null;
  return `${storeSlug}-${sku.trim()}`;
}
