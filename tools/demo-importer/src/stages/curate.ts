import * as fs from 'fs';

import { assertValidSlug, curatedPath, manifestPath } from '../config';
import { log } from '../logger';
import type { Manifest } from '../manifest/types';

/*
 * Curate is a human step (DI-7): the operator hand-edits curated.json — toggling
 * `include`, fixing genderType, and pasting Instagram reel URLs into `videos[]`.
 *
 * This command bootstraps that file (copy of the manifest) on first run, and on
 * subsequent runs validates the edits and prints what will ship.
 */
export async function runCurate({ slug }: { slug: string }): Promise<void> {
  assertValidSlug(slug);
  const mPath = manifestPath(slug);
  const cPath = curatedPath(slug);

  if (!fs.existsSync(mPath)) {
    throw new Error(`No manifest for "${slug}". Run: transform ${slug} first.`);
  }

  if (!fs.existsSync(cPath)) {
    fs.copyFileSync(mPath, cPath);
    log.step(`Curate: ${slug}`);
    log.ok(`Created ${cPath} from the manifest.`);
    log.info('Now edit curated.json:');
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
