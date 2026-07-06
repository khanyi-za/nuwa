import { httpGet } from '../http';

/*
 * Brand logo discovery from the storefront homepage. Shopify exposes no logo in
 * products.json, so we scrape the homepage HTML. Priority (validated against the
 * 5 initial brands, foundation §16/§18):
 *   1. a header <img> whose src/class/alt contains "logo"  (the real logo mark)
 *   2. og:image meta                                       (logo on most; hero on some)
 *   3. apple-touch-icon                                    (square icon fallback)
 * The operator can override store.logoSourceUrl in curated.json.
 */

export type LogoSource = 'logo-img' | 'og-image' | 'apple-touch';

/** A collection link found in the site's navigation, in DOM order. */
export interface NavCollection {
  label: string;
  slug: string;
}

export interface StorefrontMeta {
  title: string | null;
  logoCandidates: { source: LogoSource; url: string }[];
  navCollections: NavCollection[];
}

/** Normalise a scraped URL to an absolute https URL (decode entities, fix scheme). */
function normalizeUrl(raw: string, baseUrl: string): string | null {
  let u = raw.trim().replace(/&amp;/g, '&');
  if (!u) return null;
  if (u.startsWith('//')) u = `https:${u}`;
  else if (u.startsWith('http://')) u = `https://${u.slice(7)}`;
  else if (u.startsWith('/')) u = `${baseUrl}${u}`;
  else if (!u.startsWith('http')) return null;
  return u;
}

function firstMatch(re: RegExp, html: string): string | null {
  const m = re.exec(html);
  return m ? m[1] : null;
}

/** Find a header logo image: an <img> tag mentioning "logo" in its attributes. */
function findLogoImg(html: string): string | null {
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    if (!/logo/i.test(tag)) continue;
    const src = firstMatch(/\bsrc=["']([^"']+)["']/i, tag);
    // skip data: URIs and obvious 1px spacers
    if (src && !src.startsWith('data:')) return src;
  }
  return null;
}

/** Strip tags/entities from an anchor's inner HTML → its visible label. */
function anchorLabel(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All /collections/<slug> anchors in an HTML fragment, DOM order, deduped. */
function collectionAnchors(html: string): NavCollection[] {
  const out: NavCollection[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']*\/collections\/([a-z0-9_-]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, href, slug, inner] = m;
    // /collections/<slug>/products/<handle> is a product link, not a section.
    if (/\/collections\/[a-z0-9_-]+\/products\//i.test(href)) continue;
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    const label = anchorLabel(inner);
    if (!label || label.length > 60) continue; // image-only anchors / section blobs
    seen.add(key);
    out.push({ label, slug: key });
  }
  return out;
}

/**
 * The site's nav menu as collection links. Shopify themes render the main menu
 * inside <header>/<nav> (incl. hidden mobile drawers) — scope there first so
 * body "shop the collection" cards and footer repeats don't pollute the order.
 * Fall back to the whole document when the scoped scan finds too little
 * (first-occurrence dedupe still biases toward the header).
 */
export function extractNavCollections(html: string): NavCollection[] {
  const scoped = [
    ...(html.match(/<header\b[\s\S]*?<\/header>/gi) ?? []),
    ...(html.match(/<nav\b[\s\S]*?<\/nav>/gi) ?? []),
  ].join('\n');
  const fromScope = collectionAnchors(scoped);
  if (fromScope.length >= 2) return fromScope;
  return collectionAnchors(html);
}

export async function fetchStorefront(baseUrl: string): Promise<StorefrontMeta> {
  const res = await httpGet(`${baseUrl}/`);
  const html = res.text;

  const title =
    firstMatch(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i, html) ??
    firstMatch(/<title[^>]*>([^<]+)<\/title>/i, html)?.trim() ??
    null;

  const candidates: { source: LogoSource; url: string }[] = [];
  const push = (source: LogoSource, raw: string | null) => {
    if (!raw) return;
    const url = normalizeUrl(raw, baseUrl);
    if (url && !candidates.some((c) => c.url === url)) candidates.push({ source, url });
  };

  push('logo-img', findLogoImg(html));
  push('og-image', firstMatch(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i, html));
  push('apple-touch', firstMatch(/<link[^>]+apple-touch-icon[^>]*href=["']([^"']+)["']/i, html));

  return { title, logoCandidates: candidates, navCollections: extractNavCollections(html) };
}
