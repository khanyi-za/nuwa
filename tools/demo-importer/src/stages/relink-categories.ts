import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { suggestCategory } from '../transform/heuristics';
import { DATA_DIR } from '../config';
import { log } from '../logger';
import type { Manifest } from '../manifest/types';

/*
 * Re-link ProductCategory rows for ALREADY-LOADED brands after a
 * CATEGORY_RULES / seed change, without a wipe-and-reload (reloads would break
 * FK'd Order rows). Reads each brand's manifest, re-derives the category from
 * tags+title with the CURRENT rules (manifest.suggestedCategorySlug is stale —
 * it was computed at transform time), matches DB products by (store, slug),
 * and replaces their category links. Finally drops the legacy 'bottoms'
 * category (taxonomy v2 split it into pants/shorts/skirts).
 *
 * NOTE: manifests on disk keep the stale suggestedCategorySlug — re-run
 * `transform` before any future `load` of these brands.
 */
export async function runRelinkCategories(slugs: string[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  const brandSlugs =
    slugs.length > 0
      ? slugs
      : readdirSync(DATA_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(join(DATA_DIR, d.name, 'manifest.json')))
          .map((d) => d.name);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
    const categoryId = new Map(categories.map((c) => [c.slug, c.id]));
    const linkCounts = new Map<string, number>();
    let relinked = 0;
    let unmatched = 0;
    let uncategorized = 0;

    for (const brand of brandSlugs) {
      const store = await prisma.store.findUnique({ where: { slug: brand }, select: { id: true } });
      if (!store) {
        log.warn(`store not in DB, skipping: ${brand}`);
        continue;
      }
      const manifest: Manifest = JSON.parse(readFileSync(join(DATA_DIR, brand, 'manifest.json'), 'utf8'));
      log.step(`Relink: ${brand}`);

      for (const p of manifest.products.filter((mp) => mp.include)) {
        const product = await prisma.product.findFirst({
          where: { storeId: store.id, slug: p.slug },
          select: { id: true },
        });
        if (!product) {
          unmatched++;
          continue;
        }
        const slug = suggestCategory({ tags: p.tags, productType: '', title: p.title });
        const catId = slug ? categoryId.get(slug) : undefined;
        await prisma.productCategory.deleteMany({ where: { productId: product.id } });
        if (catId) {
          await prisma.productCategory.create({ data: { productId: product.id, categoryId: catId } });
          linkCounts.set(slug!, (linkCounts.get(slug!) ?? 0) + 1);
          relinked++;
        } else {
          uncategorized++;
        }
      }
    }

    log.step('Relink summary');
    [...linkCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([slug, n]) => log.ok(`${slug}: ${n}`));
    log.info(`relinked ${relinked}, uncategorized ${uncategorized}, unmatched-in-db ${unmatched}`);

    const bottoms = await prisma.category.findUnique({ where: { slug: 'bottoms' }, select: { id: true } });
    if (bottoms) {
      await prisma.category.delete({ where: { id: bottoms.id } });
      log.ok("legacy 'bottoms' category removed");
    }
  } finally {
    await prisma.$disconnect();
  }
}
