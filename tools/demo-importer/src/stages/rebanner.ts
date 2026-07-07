import * as fs from 'fs';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { assetMapPath, assertValidSlug, curatedPath } from '../config';
import { log } from '../logger';
import type { Manifest } from '../manifest/types';

/*
 * Rebanner (2026-07-07) — mirror a brand's StoreBannerMedia from curated.json
 * + asset-map onto an ALREADY-LOADED store, in place. Same composition rule
 * as load step 7 (hero videos first = cover, then hero images, capped 5) —
 * but WITHOUT the wipe-and-reload, because loaded stores now carry FK'd
 * order history that a reload would destroy.
 *
 * This is the post-load hero workflow: load a brand (image-fallback banner),
 * the operator later supplies reel URLs into curated.json videos[], then
 * `rehost <slug>` (downloads + uploads) → `rebanner <slug>` (applies).
 */

const MAX_BANNERS = 5;

interface AssetRecord { secureUrl: string; kind: string; }
type AssetMap = Record<string, AssetRecord>;

function prismaClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

export async function runRebanner(slugs: string[]): Promise<void> {
  if (slugs.length === 0) {
    throw new Error('Usage: rebanner <brandSlug…>');
  }
  slugs.forEach(assertValidSlug);

  const prisma = prismaClient();
  try {
    for (const slug of slugs) {
      log.step(`Rebanner: ${slug}`);

      const cPath = curatedPath(slug);
      if (!fs.existsSync(cPath)) {
        log.warn(`no curated.json for ${slug}, skipping`);
        continue;
      }
      if (!fs.existsSync(assetMapPath(slug))) {
        log.warn(`no asset-map.json for ${slug} — run rehost first, skipping`);
        continue;
      }
      const manifest = JSON.parse(fs.readFileSync(cPath, 'utf8')) as Manifest;
      const assets = JSON.parse(fs.readFileSync(assetMapPath(slug), 'utf8')) as AssetMap;
      const cdn = (sourceUrl: string | null | undefined): string | null =>
        sourceUrl ? assets[sourceUrl]?.secureUrl ?? null : null;

      const store = await prisma.store.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!store) {
        log.warn(`store not in DB, skipping: ${slug}`);
        continue;
      }

      const heroVideos = manifest.videos
        .filter((v) => v.target === 'hero')
        .map((v) => cdn(v.url))
        .filter(Boolean) as string[];
      const missingVideos = manifest.videos.filter(
        (v) => v.target === 'hero' && !cdn(v.url),
      ).length;
      const heroImages = manifest.products
        .filter((p) => p.include)
        .flatMap((p) => p.images.map((img) => cdn(img.sourceUrl)))
        .filter(Boolean)
        .slice(0, Math.max(0, MAX_BANNERS - heroVideos.length)) as string[];

      const banners = [
        ...heroVideos.map((url) => ({ url, mediaType: 'VIDEO' as const })),
        ...heroImages.map((url) => ({ url, mediaType: 'IMAGE' as const })),
      ].slice(0, MAX_BANNERS);

      if (banners.length === 0) {
        log.warn(`nothing to apply for ${slug} (no rehosted hero assets), skipping`);
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.storeBannerMedia.deleteMany({ where: { storeId: store.id } });
        for (let i = 0; i < banners.length; i++) {
          await tx.storeBannerMedia.create({
            data: {
              storeId: store.id,
              url: banners[i].url,
              mediaType: banners[i].mediaType,
              sortOrder: i,
              isPrimary: i === 0,
            },
          });
        }
      });

      log.ok(`${slug}: banner set → ${heroVideos.length} video + ${banners.length - heroVideos.length} image`);
      if (missingVideos > 0) {
        log.warn(`  ${missingVideos} hero video(s) not in asset-map yet — run rehost ${slug} and re-run rebanner`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
