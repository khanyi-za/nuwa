import * as fs from 'fs';
import * as path from 'path';

import { assertValidSlug, curatedPath, manifestPath, rawDir } from '../config';
import { log } from '../logger';
import type { Manifest } from '../manifest/types';

/*
 * Curate is a human step (DI-7): the operator hand-edits curated.json — toggling
 * `include`, fixing genderType, and pasting Instagram reel URLs into `videos[]`.
 *
 * Bootstrap applies the DI-3 "highlight set" caps so a brand starts as a tight,
 * demo-sized catalogue (not the full archive — tolthema raw is 162 products /
 * 1,178 images). Operator can still hand-tune. Subsequent runs validate.
 *
 * 2026-07-06 upgrades (for the 3-brand demo reseed):
 * - `--cap N` overrides the product cap (default 50).
 * - Selection is NAV-COVERAGE-AWARE: products are picked round-robin across the
 *   brand's site-nav collections (raw/storefront.json navCollections) before
 *   filling from catalogue order — so every brand-page tab the buyer sees has
 *   products behind it, instead of the first-N products starving late tabs.
 * - Collections are trimmed: nav-matched collections always survive; non-nav
 *   collections survive only if they hold an included product, capped so
 *   250-collection catalogues (Freedom of Movement) don't dump junk
 *   ("sibling"/Black-Friday collections) into the demo DB.
 * - `--force` re-bootstraps an EXISTING curated.json from the fresh manifest
 *   while carrying over the operator's `videos[]` and store description
 *   (fieldsstore keeps its hero video through a reseed).
 */
const DEFAULT_MAX_PRODUCTS = 50; // per brand (DI-3 highlight set)
const MAX_IMAGES_PER_PRODUCT = 5; // foundation §13 finding
const MAX_NON_NAV_COLLECTIONS = 15; // junk guard for mega-catalogues

interface NavCollection {
  label: string;
  slug: string;
}

export async function runCurate({
  slug,
  cap,
  force,
}: {
  slug: string;
  cap?: number;
  force?: boolean;
}): Promise<void> {
  assertValidSlug(slug);
  const mPath = manifestPath(slug);
  const cPath = curatedPath(slug);
  const maxProducts = cap && cap > 0 ? cap : DEFAULT_MAX_PRODUCTS;

  if (!fs.existsSync(mPath)) {
    throw new Error(`No manifest for "${slug}". Run: transform ${slug} first.`);
  }

  if (!fs.existsSync(cPath) || force) {
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8')) as Manifest;

    // --force: preserve the operator's manual work from the previous curated
    // file (videos + store description) while everything else re-bootstraps.
    let carriedVideos = 0;
    if (force && fs.existsSync(cPath)) {
      const prev = JSON.parse(fs.readFileSync(cPath, 'utf8')) as Manifest;
      manifest.videos = prev.videos ?? [];
      if (prev.store.description && !manifest.store.description) {
        manifest.store.description = prev.store.description;
      }
      carriedVideos = manifest.videos.length;
    }

    const nav = readNavCollections(slug);
    const caps = applyHighlightCaps(manifest, maxProducts, nav);
    fs.writeFileSync(cPath, JSON.stringify(manifest, null, 2));

    log.step(`Curate: ${slug}${force ? ' (re-bootstrap)' : ''}`);
    log.ok(`Created ${cPath} (highlight-capped: ${caps.included} products, ≤${MAX_IMAGES_PER_PRODUCT} imgs each).`);
    log.ok(`nav coverage: ${caps.navCovered}/${nav.length} nav collections have included products`);
    log.ok(`collections: ${caps.collectionsKept} kept / ${manifest.collections.length} total (nav ${caps.navCollections})`);
    if (carriedVideos > 0) log.ok(`carried over ${carriedVideos} video(s) from previous curated.json`);
    if (caps.droppedProducts > 0) log.info(`  ${caps.droppedProducts} products dropped past the ${maxProducts} cap`);
    if (caps.trimmedImages > 0) log.info(`  trimmed ${caps.trimmedImages} excess images`);
    log.info('Now optionally edit curated.json:');
    log.info('  • set product/collection "include": false to drop items');
    log.info('  • fix any wrong "genderType" (WOMEN | MEN | UNISEX)');
    log.info('  • add Instagram reels to "videos": '
      + '[{ "url": "...", "target": "hero" }, { "url": "...", "target": "product", "productSlug": "..." }]');
    log.info(`Then re-run: curate ${slug}  (to validate) → rehost ${slug}`);
    return;
  }

  // Validate existing curated.json.
  const curated = JSON.parse(fs.readFileSync(cPath, 'utf8')) as Manifest;
  const includedProducts = curated.products.filter((p) => p.include);
  const includedSlugs = new Set(includedProducts.map((p) => p.slug));
  const includedCollections = curated.collections.filter((c) => c.include);

  const problems: string[] = [];
  curated.products.forEach((p) => {
    if (p.include && p.images.length === 0) problems.push(`product "${p.slug}" is included but has no images`);
    if (!['WOMEN', 'MEN', 'UNISEX'].includes(p.genderType)) problems.push(`product "${p.slug}" has invalid genderType "${p.genderType}"`);
  });
  curated.videos.forEach((v, i) => {
    if (v.target === 'product') {
      if (!v.productSlug) problems.push(`video[${i}] target=product but has no productSlug`);
      else if (!includedSlugs.has(v.productSlug)) problems.push(`video[${i}] productSlug "${v.productSlug}" is not an included product`);
    } else if (v.target !== 'hero') {
      problems.push(`video[${i}] has invalid target "${v.target}" (expected hero | product)`);
    }
  });

  const heroVideos = curated.videos.filter((v) => v.target === 'hero').length;
  const productVideos = curated.videos.filter((v) => v.target === 'product').length;

  log.step(`Curate validation: ${slug}`);
  log.ok(`store:            ${curated.store.displayName}`);
  log.ok(`products:         ${includedProducts.length} included / ${curated.products.length} total`);
  log.ok(`collections:      ${includedCollections.length} included / ${curated.collections.length} total`);
  log.ok(`videos:           ${heroVideos} hero / ${productVideos} product`);

  if (problems.length > 0) {
    log.step('Issues to fix before rehost/load');
    problems.forEach((p) => log.error(p));
    process.exitCode = 1;
  } else {
    log.ok('No issues. Ready for: rehost ' + slug);
  }
}

/** Site-nav collection slugs from the extract-phase homepage scrape (may be empty). */
function readNavCollections(slug: string): NavCollection[] {
  const file = path.join(rawDir(slug), 'storefront.json');
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      navCollections?: NavCollection[];
    };
    return data.navCollections ?? [];
  } catch {
    return [];
  }
}

/**
 * Mutate the manifest to a DI-3 highlight set: cap images/product, pick up to
 * `maxProducts` with nav-tab coverage, then trim collections to the survivors.
 */
function applyHighlightCaps(
  m: Manifest,
  maxProducts: number,
  nav: NavCollection[],
): {
  included: number;
  droppedProducts: number;
  trimmedImages: number;
  navCovered: number;
  collectionsKept: number;
  navCollections: number;
} {
  let trimmedImages = 0;
  m.products.forEach((p) => {
    if (p.images.length > MAX_IMAGES_PER_PRODUCT) {
      trimmedImages += p.images.length - MAX_IMAGES_PER_PRODUCT;
      p.images = p.images.slice(0, MAX_IMAGES_PER_PRODUCT);
      p.images.forEach((img, i) => (img.isPrimary = i === 0));
    }
  });

  // Eligible = transform's pre-include (has images + stock), in catalogue order.
  const eligible = m.products.filter((p) => p.include);
  const eligibleCount = eligible.length;
  const chosen = new Set<string>();

  // Round 1 — round-robin across nav collections so every tab gets products.
  const navSlugs = nav.map((n) => n.slug);
  if (navSlugs.length > 0) {
    const queues = navSlugs.map((cslug) =>
      eligible.filter((p) => p.collectionSlugs.includes(cslug)),
    );
    let progressed = true;
    while (chosen.size < maxProducts && progressed) {
      progressed = false;
      for (const queue of queues) {
        if (chosen.size >= maxProducts) break;
        const next = queue.find((p) => !chosen.has(p.slug));
        if (next) {
          chosen.add(next.slug);
          progressed = true;
        }
      }
    }
  }

  // Round 2 — fill the remainder in catalogue order.
  for (const p of eligible) {
    if (chosen.size >= maxProducts) break;
    chosen.add(p.slug);
  }

  m.products.forEach((p) => {
    p.include = chosen.has(p.slug);
  });

  // Collections: nav-matched always kept; non-nav kept only while they hold an
  // included product, biggest-first, capped (junk guard for 250-collection
  // catalogues — renav hides non-nav tabs anyway, this keeps the DB clean).
  const navSet = new Set(navSlugs);
  let nonNavKept = 0;
  const withIncludedCount = (c: (typeof m.collections)[number]) =>
    c.productSlugs.filter((s) => chosen.has(s)).length;
  const nonNavRanked = new Set(
    m.collections
      .filter((c) => !navSet.has(c.slug) && withIncludedCount(c) > 0)
      .sort((a, b) => withIncludedCount(b) - withIncludedCount(a))
      .slice(0, MAX_NON_NAV_COLLECTIONS)
      .map((c) => c.slug),
  );
  m.collections.forEach((c) => {
    if (navSet.has(c.slug)) {
      c.include = true;
    } else if (nonNavRanked.has(c.slug)) {
      c.include = true;
      nonNavKept++;
    } else {
      c.include = false;
    }
  });

  const navCovered = navSlugs.filter((cslug) =>
    eligible.some((p) => chosen.has(p.slug) && p.collectionSlugs.includes(cslug)),
  ).length;

  return {
    included: chosen.size,
    droppedProducts: Math.max(0, eligibleCount - chosen.size),
    trimmedImages,
    navCovered,
    collectionsKept: m.collections.filter((c) => c.include).length,
    navCollections: navSlugs.length,
  };
}
