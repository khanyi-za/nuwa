/*
 * Pure mapping helpers for Transform. No I/O. Heuristics here are deliberately
 * simple (DI-6: no LLM) and are eyeballed in the Curate pass.
 *
 * Tuned from Phase 1 findings (foundation §11): option names are messy, so map
 * by name *content*; product_type is unreliable, so genderType/category lean on
 * tags first; grams is often 0, so weight has a fallback.
 */

import type { GenderSource, GenderType } from '../manifest/types';

const DEFAULT_STOCK = 20; // public JSON exposes `available`, not quantity
const WEIGHT_FALLBACK_GRAMS = 500; // matches the shipping module's null-weight assumption

export { DEFAULT_STOCK };

/** ZAR decimal string ("799.99") → integer cents, float-safe. */
export function priceToCents(price: string | null | undefined): number | null {
  if (price == null || price === '') return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function weightWithFallback(grams: number | null | undefined): number {
  return grams && grams > 0 ? grams : WEIGHT_FALLBACK_GRAMS;
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
const WOMEN_RE = /\b(womens?|woman|ladies|lady|female|girls?)\b|\b(dress|gown|skirt|blouse|heels|bodycon)\b/i;
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
    if (w && !m) return { gender: 'WOMEN', source };
    if (m && !w) return { gender: 'MEN', source };
  }
  return { gender: 'UNISEX', source: 'default' };
}

/** Map a Shopify option name to a YIIVA variant field by its content. */
export function optionField(name: string): 'color' | 'size' | 'material' | null {
  const n = name.toLowerCase();
  if (/colou?r/.test(n)) return 'color';
  if (/size/.test(n)) return 'size';
  if (/material|fabric/.test(n)) return 'material';
  return null;
}

// Targets the dev/demo-seeded platform categories (dresses/tops/bottoms/sets).
// Load only links when the category actually exists in the demo DB.
const CATEGORY_RULES: { slug: string; re: RegExp }[] = [
  { slug: 'dresses', re: /\b(dress|gown)\b/i },
  { slug: 'sets', re: /\b(set|co-?ord|two[- ]?piece|tracksuit)\b/i },
  { slug: 'bottoms', re: /\b(pant|trouser|short|skirt|legging|jean|bottom)\b/i },
  { slug: 'tops', re: /\b(top|tee|t-?shirt|shirt|blouse|crop|hoodie|sweater|jersey|jacket|coat)\b/i },
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

export function stockFor(available: boolean): number {
  return available ? DEFAULT_STOCK : 0;
}

/** Namespace a Shopify SKU per brand to avoid the global @unique collision. */
export function namespaceSku(brandSlug: string, sku: string | null): string | null {
  if (!sku || sku.trim() === '') return null;
  return `${brandSlug}-${sku.trim()}`;
}
