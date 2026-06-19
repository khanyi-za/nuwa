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

export interface StorefrontMeta {
  title: string | null;
  logoCandidates: { source: LogoSource; url: string }[];
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

  return { title, logoCandidates: candidates };
}
