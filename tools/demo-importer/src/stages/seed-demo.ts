import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { log } from '../logger';

/*
 * One-time demo-DB seed: the platform Category tree the Transform heuristic
 * targets (foundation §15). nuwa's repo seed.ts seeds admins only, so the demo
 * DB needs these for category chips to populate. Idempotent (upsert by slug).
 * Run with DATABASE_URL pointed at the demo DB.
 *
 * Taxonomy v2 (2026-07-02): derived from a 50-brand / 5,386-product sweep of
 * the brand_listing.xlsx targets. Categories stay ungendered — the mobile API
 * shows a category under a gender tab iff it has ACTIVE products of that
 * gender (UNISEX counts for both), so unstocked slugs (e.g. eyewear before an
 * eyewear brand loads) stay hidden. Card images = real brand product shots
 * rehosted to Cloudinary (demo/categories/<slug>). The legacy 'bottoms'
 * category was replaced by pants/shorts/skirts — `relink` removes it.
 */
const CATEGORIES: { name: string; slug: string; sortOrder: number; imageUrl: string }[] = [
  { name: 'T-Shirts', slug: 'tees', sortOrder: 1, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999058/demo/categories/tees.jpg' },
  { name: 'Shirts & Tops', slug: 'tops', sortOrder: 2, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999056/demo/categories/tops.png' },
  { name: 'Dresses', slug: 'dresses', sortOrder: 3, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999054/demo/categories/dresses.jpg' },
  { name: 'Knitwear', slug: 'knitwear', sortOrder: 4, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999055/demo/categories/knitwear.jpg' },
  { name: 'Hoodies & Sweats', slug: 'hoodies', sortOrder: 5, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999063/demo/categories/hoodies.jpg' },
  { name: 'Jackets & Coats', slug: 'jackets', sortOrder: 6, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999052/demo/categories/jackets.jpg' },
  { name: 'Pants', slug: 'pants', sortOrder: 7, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999053/demo/categories/pants.jpg' },
  { name: 'Shorts', slug: 'shorts', sortOrder: 8, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999059/demo/categories/shorts.png' },
  { name: 'Skirts', slug: 'skirts', sortOrder: 9, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999057/demo/categories/skirts.jpg' },
  { name: 'Matching Sets', slug: 'sets', sortOrder: 10, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999062/demo/categories/sets.jpg' },
  { name: 'Activewear', slug: 'activewear', sortOrder: 11, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999064/demo/categories/activewear.jpg' },
  { name: 'Swimwear', slug: 'swimwear', sortOrder: 12, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999060/demo/categories/swimwear.jpg' },
  // "Lingerie" in the display name is deliberate: universal search matches
  // category names, so searching "lingerie" surfaces the whole category.
  { name: 'Lingerie & Underwear', slug: 'underwear', sortOrder: 13, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1784120318/demo/categories/underwear.jpg' },
  { name: 'Headwear', slug: 'headwear', sortOrder: 14, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999051/demo/categories/headwear.jpg' },
  { name: 'Jewellery', slug: 'jewellery', sortOrder: 14, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999061/demo/categories/jewellery.jpg' },
  { name: 'Bags', slug: 'bags', sortOrder: 15, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999047/demo/categories/bags.png' },
  { name: 'Eyewear', slug: 'eyewear', sortOrder: 16, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999065/demo/categories/eyewear.jpg' },
  { name: 'Footwear', slug: 'footwear', sortOrder: 17, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999048/demo/categories/footwear.jpg' },
  { name: 'Accessories', slug: 'accessories', sortOrder: 18, imageUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/v1782999050/demo/categories/accessories.jpg' },
];

export async function runSeedDemo(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres before seeding.');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  log.step('Seed demo: platform categories');
  try {
    for (const c of CATEGORIES) {
      await prisma.category.upsert({
        where: { slug: c.slug },
        create: { name: c.name, slug: c.slug, sortOrder: c.sortOrder, imageUrl: c.imageUrl },
        update: { name: c.name, sortOrder: c.sortOrder, imageUrl: c.imageUrl },
      });
      log.ok(`category: ${c.slug}`);
    }
    log.info('Done. Re-runnable (idempotent).');
  } finally {
    await prisma.$disconnect();
  }
}
