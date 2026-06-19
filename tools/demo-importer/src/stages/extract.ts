import * as fs from 'fs';
import * as path from 'path';

import { HTTP, assertValidSlug, brandDir, rawDir } from '../config';
import { asJson, httpGet, sleep } from '../http';
import { log } from '../logger';
import { fetchStorefront } from '../shopify/storefront';
import type {
  ShopifyCollection,
  ShopifyCollectionsResponse,
  ShopifyProduct,
  ShopifyProductsResponse,
} from '../shopify/types';

interface ExtractArgs {
  slug: string;
  url: string;
  logoOnly?: boolean;
}

interface ExtractMeta {
  brandSlug: string;
  storefrontUrl: string;
  baseUrl: string;
  fetchedAt: string;
  probeOk: boolean;
  probeNote?: string;
  counts: {
    products: number;
    variants: number;
    images: number;
    collections: number;
  };
  pages: { products: number; collections: number };
}

/** Strip path/trailing slash so we can append /products.json etc. cleanly. */
function normalizeBase(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  return `${parsed.protocol}//${parsed.host}`;
}

function writeJson(dir: string, file: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
}

/** Probe whether the storefront exposes products.json at all (the go/no-go). */
async function probe(baseUrl: string): Promise<{ ok: boolean; note: string }> {
  const res = await httpGet(`${baseUrl}/products.json?limit=1`);
  if (res.status !== 200) return { ok: false, note: `products.json returned HTTP ${res.status}` };
  const json = asJson<ShopifyProductsResponse>(res);
  if (!json || !Array.isArray(json.products)) {
    return { ok: false, note: 'products.json did not return a JSON products array (endpoint likely disabled)' };
  }
  return { ok: true, note: 'products.json exposed' };
}

/** Page through a *.json endpoint that returns { [key]: T[] } until empty. */
async function fetchAllPages<T>(
  baseUrl: string,
  endpointPath: string,
  key: 'products' | 'collections',
): Promise<{ items: T[]; pages: number }> {
  const items: T[] = [];
  let page = 1;
  for (;;) {
    const url = `${baseUrl}${endpointPath}?limit=${HTTP.pageSize}&page=${page}`;
    const res = await httpGet(url);
    const json = asJson<Record<string, T[]>>(res);
    const batch = json?.[key] ?? [];
    if (batch.length === 0) break;
    items.push(...batch);
    log.info(`  ${key}: page ${page} → ${batch.length} (total ${items.length})`);
    page++;
    await sleep(HTTP.throttleMs);
    if (page > 200) break; // hard safety stop
  }
  return { items, pages: page - 1 };
}

async function captureStorefront(baseUrl: string, dir: string): Promise<void> {
  try {
    const meta = await fetchStorefront(baseUrl);
    writeJson(dir, 'storefront.json', meta);
    const logo = meta.logoCandidates[0];
    if (logo) log.ok(`logo (${logo.source}): ${logo.url.slice(0, 70)}`);
    else log.warn('no logo candidate found on the homepage');
  } catch (err) {
    log.warn(`storefront/logo fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runExtract({ slug, url, logoOnly = false }: ExtractArgs): Promise<void> {
  assertValidSlug(slug);
  const baseUrl = normalizeBase(url);
  const dir = rawDir(slug);
  fs.mkdirSync(dir, { recursive: true });

  if (logoOnly) {
    log.step(`Extract (logo only): ${slug} (${baseUrl})`);
    await captureStorefront(baseUrl, dir);
    return;
  }

  log.step(`Extract: ${slug} (${baseUrl})`);

  // 1. Feasibility probe — the whole reason this phase exists.
  const p = await probe(baseUrl);
  if (!p.ok) {
    log.error(`Probe failed: ${p.note}`);
    const meta: ExtractMeta = {
      brandSlug: slug,
      storefrontUrl: url,
      baseUrl,
      fetchedAt: new Date().toISOString(),
      probeOk: false,
      probeNote: p.note,
      counts: { products: 0, variants: 0, images: 0, collections: 0 },
      pages: { products: 0, collections: 0 },
    };
    writeJson(brandDir(slug), '_meta.json', meta);
    log.warn('Flagged for the non-Shopify fallback path (foundation doc §8). Stopping.');
    return;
  }
  log.ok(p.note);

  // 2. All products.
  log.info('Fetching products…');
  const { items: products, pages: productPages } =
    await fetchAllPages<ShopifyProduct>(baseUrl, '/products.json', 'products');
  writeJson(dir, 'products.json', products);

  // 3. All collections + their membership (products.json carries NO collection
  //    membership, so we resolve it per-collection — but persist only the id
  //    lists, not duplicate product dumps, to keep the workspace lean).
  log.info('Fetching collections…');
  const { items: collections } = await fetchAllPages<ShopifyCollection>(
    baseUrl,
    '/collections.json',
    'collections',
  );
  writeJson(dir, 'collections.json', collections);

  const membership: Record<string, { title: string; productIds: number[] }> = {};
  for (const c of collections) {
    const { items: cps } = await fetchAllPages<ShopifyProduct>(
      baseUrl,
      `/collections/${c.handle}/products.json`,
      'products',
    );
    membership[c.handle] = { title: c.title, productIds: cps.map((x) => x.id) };
    await sleep(HTTP.throttleMs);
  }
  writeJson(dir, 'collection-membership.json', membership);

  // 4. Storefront homepage → logo candidates + title.
  await captureStorefront(baseUrl, dir);

  // 5. Counts + meta.
  const variants = products.reduce((n, x) => n + (x.variants?.length ?? 0), 0);
  const images = products.reduce((n, x) => n + (x.images?.length ?? 0), 0);
  const meta: ExtractMeta = {
    brandSlug: slug,
    storefrontUrl: url,
    baseUrl,
    fetchedAt: new Date().toISOString(),
    probeOk: true,
    probeNote: p.note,
    counts: { products: products.length, variants, images, collections: collections.length },
    pages: { products: productPages, collections: 1 },
  };
  writeJson(brandDir(slug), '_meta.json', meta);

  log.step('Extract summary');
  log.ok(`products:     ${meta.counts.products}`);
  log.ok(`variants:     ${meta.counts.variants}`);
  log.ok(`images:       ${meta.counts.images}`);
  log.ok(`collections:  ${meta.counts.collections}`);
  log.info(`raw → ${dir}`);
}
