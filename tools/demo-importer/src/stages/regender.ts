import { PrismaClient, GenderType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { log } from '../logger';

/*
 * Demo-data gender curate pass (the backlog item from foundation §17 /
 * STATUS "genderType curate pass"). Shopify data rarely carries a gender
 * signal, so Transform's inferGender defaults most products to UNISEX and both
 * feeds end up near-identical. This command applies a PER-BRAND default to the
 * products that had no signal (current genderType = UNISEX); products the
 * inference DID gender (WOMEN/MEN) are left untouched.
 *
 * Defaults grounded in each brand's actual range (eyeballed 2026-07-02):
 *   tolthema    → WOMEN  (shawls, turbans, corsetry, sets, jewellery)
 *   embedded    → WOMEN  (womenswear range; 3/4 already inferred WOMEN)
 *   sakanya     → WOMEN  (already all WOMEN — listed for completeness)
 *   madebyfade  → MEN    (menswear-coded essentials: slim jeans, boxy tees)
 *   suhu        → UNISEX (genuinely unisex streetwear — no change)
 *   fieldsstore → UNISEX (genuinely unisex knits/totes — no change)
 *
 * Adjust the map + re-run any time; it's idempotent. New brands: add a line
 * here when their catalog is gender-silent.
 */
const BRAND_DEFAULT_GENDER: Record<string, GenderType> = {
  tolthema: GenderType.WOMEN,
  embedded: GenderType.WOMEN,
  sakanya: GenderType.WOMEN,
  madebyfade: GenderType.MEN,
  suhu: GenderType.UNISEX,
  fieldsstore: GenderType.UNISEX,
};

export async function runRegender(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    log.step('Regender: per-brand defaults for gender-silent products');
    for (const [brand, gender] of Object.entries(BRAND_DEFAULT_GENDER)) {
      if (gender === GenderType.UNISEX) {
        log.info(`${brand}: stays UNISEX (genuine)`);
        continue;
      }
      const store = await prisma.store.findUnique({ where: { slug: brand }, select: { id: true } });
      if (!store) {
        log.warn(`store not in DB, skipping: ${brand}`);
        continue;
      }
      const res = await prisma.product.updateMany({
        where: { storeId: store.id, genderType: GenderType.UNISEX },
        data: { genderType: gender },
      });
      log.ok(`${brand}: ${res.count} UNISEX → ${gender}`);
    }

    const dist = await prisma.product.groupBy({
      by: ['genderType'],
      where: { status: 'ACTIVE' },
      _count: true,
    });
    log.step('Resulting ACTIVE distribution');
    dist.forEach((d) => log.ok(`${d.genderType}: ${d._count}`));
  } finally {
    await prisma.$disconnect();
  }
}
