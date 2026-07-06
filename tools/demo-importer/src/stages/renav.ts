import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { DATA_DIR, brandDir, rawDir } from '../config';
import { log } from '../logger';
import { fetchStorefront, type NavCollection } from '../shopify/storefront';

/*
 * Mirror each brand's OWN site navigation onto its StoreCollections, so the
 * maya brand-page tabs read like the brand's site — without a wipe-and-reload
 * (reloads would break FK'd Order rows).
 *
 * For every brand: scrape the live homepage nav for /collections/<slug> links
 * (falling back to the extract-time raw/storefront.json when the site is
 * unreachable), then update the store's collections in place:
 *   - nav-matched  → showOnProfile=true, sortOrder=nav position, name=nav label
 *   - not in nav   → showOnProfile=false (hidden tab, products stay reachable
 *                    under the All tab; nothing is deleted)
 *   - no nav found → brand left untouched (all collections stay visible in
 *                    name order — the sakanya-like "already clean" case)
 */
export async function runRenav(slugs: string[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  const brandSlugs =
    slugs.length > 0
      ? slugs
      : readdirSync(DATA_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(join(brandDir(d.name), '_meta.json')))
          .map((d) => d.name);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    for (const brand of brandSlugs) {
      const store = await prisma.store.findUnique({
        where: { slug: brand },
        select: { id: true },
      });
      if (!store) {
        log.warn(`store not in DB, skipping: ${brand}`);
        continue;
      }

      log.step(`Renav: ${brand}`);
      const nav = await navForBrand(brand);
      if (nav.length === 0) {
        log.warn('no nav collections found — leaving this brand untouched');
        continue;
      }

      const collections = await prisma.storeCollection.findMany({
        where: { storeId: store.id },
        select: { id: true, slug: true, name: true },
      });
      const bySlug = new Map(collections.map((c) => [c.slug.toLowerCase(), c]));

      const matched: { id: string; navLabel: string; slug: string }[] = [];
      for (const entry of nav) {
        const hit = bySlug.get(entry.slug);
        if (hit) {
          matched.push({ id: hit.id, navLabel: entry.label, slug: entry.slug });
        } else {
          log.info(`  nav link has no imported collection (skipped): ${entry.slug}`);
        }
      }

      if (matched.length === 0) {
        log.warn('nav found, but none of its collections are imported — leaving untouched');
        continue;
      }

      const matchedIds = new Set(matched.map((m) => m.id));
      for (let i = 0; i < matched.length; i++) {
        await prisma.storeCollection.update({
          where: { id: matched[i].id },
          data: {
            showOnProfile: true,
            sortOrder: i + 1,
            name: matched[i].navLabel,
          },
        });
      }
      const hidden = await prisma.storeCollection.updateMany({
        where: { storeId: store.id, id: { notIn: [...matchedIds] } },
        data: { showOnProfile: false },
      });

      log.ok(
        `tabs (${matched.length}): ${matched.map((m) => m.navLabel).join(' · ')}`,
      );
      log.info(`  hidden ${hidden.count} non-nav collection(s)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Live homepage nav, falling back to the extract-time storefront.json. */
async function navForBrand(brand: string): Promise<NavCollection[]> {
  const metaPath = join(brandDir(brand), '_meta.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { baseUrl?: string };

  if (meta.baseUrl) {
    try {
      const storefront = await fetchStorefront(meta.baseUrl);
      if (storefront.navCollections.length > 0) {
        log.info(`  nav (live): ${storefront.navCollections.length} collection link(s)`);
        return storefront.navCollections;
      }
      log.warn('  live homepage had no nav collection links');
    } catch (err) {
      log.warn(
        `  live homepage fetch failed (${err instanceof Error ? err.message : String(err)}) — trying cached storefront.json`,
      );
    }
  }

  const cachedPath = join(rawDir(brand), 'storefront.json');
  if (existsSync(cachedPath)) {
    const cached = JSON.parse(readFileSync(cachedPath, 'utf8')) as {
      navCollections?: NavCollection[];
    };
    if (cached.navCollections?.length) {
      log.info(`  nav (cached): ${cached.navCollections.length} collection link(s)`);
      return cached.navCollections;
    }
  }
  return [];
}
