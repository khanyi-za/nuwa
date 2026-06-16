import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { log } from '../logger';

/*
 * One-time demo-DB seed: the platform Category tree the Transform heuristic
 * targets (foundation §15). nuwa's repo seed.ts seeds admins only, so the demo
 * DB needs these for category chips to populate. Idempotent (upsert by slug).
 * Run with DATABASE_URL pointed at the demo DB.
 */
const CATEGORIES: { name: string; slug: string; sortOrder: number }[] = [
  { name: 'Dresses', slug: 'dresses', sortOrder: 1 },
  { name: 'Tops', slug: 'tops', sortOrder: 2 },
  { name: 'Bottoms', slug: 'bottoms', sortOrder: 3 },
  { name: 'Sets', slug: 'sets', sortOrder: 4 },
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
        create: { name: c.name, slug: c.slug, sortOrder: c.sortOrder },
        update: { name: c.name, sortOrder: c.sortOrder },
      });
      log.ok(`category: ${c.slug}`);
    }
    log.info('Done. Re-runnable (idempotent).');
  } finally {
    await prisma.$disconnect();
  }
}
