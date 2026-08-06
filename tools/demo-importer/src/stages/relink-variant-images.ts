import { createHash } from 'node:crypto';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { v2 as cloudinary } from 'cloudinary';

import { DATA_DIR, assetMapPath, getCloudinaryConfig } from '../config';
import { log } from '../logger';
import type { ShopifyProduct } from '../shopify/types';

/*
 * Backfill ProductVariant.imageUrl for ALREADY-LOADED brands, without a
 * wipe-and-reload. The raw scrape (`data/<slug>/raw/products.json`) carries
 * the variant↔image association the pipeline used to discard:
 *   - variant.featured_image.src (preferred), else
 *   - images[].variant_ids containing the variant's id.
 *
 * Mirrors the PRODUCTION import's union rule: a colour image missing from the
 * product's gallery is uploaded to Cloudinary (same deterministic public-id
 * scheme as the rehost stage, resumable via asset-map.json) and appended as a
 * non-primary ProductImage row — so every linked colour is actually visible
 * and the variant's imageUrl always equals a sibling ProductImage.url (the
 * gallery-jump contract, see prisma/schema.prisma).
 *
 * DB matching mirrors load.ts: product by (store, slug=handle), variant by
 * sortOrder (= raw `position ?? index`). Idempotent — re-runs only touch
 * rows whose imageUrl would change.
 */

type AssetRecord = {
  secureUrl: string;
  publicId: string;
  kind: 'image' | 'video';
  source: string;
  uploadedAt: string;
};
type AssetMap = Record<string, AssetRecord>;

function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

function publicIdFor(brandSlug: string, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `demo/${brandSlug}/${hash}`;
}

/** Shopify-CDN downscale fallback for >10MB originals (rehost.ts idiom). */
function downscaledUrl(source: string): string | null {
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(source)) return null;
  if (/[?&]width=/.test(source)) return null;
  return source + (source.includes('?') ? '&' : '?') + 'width=2048';
}

export async function runRelinkVariantImages(slugs: string[]): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  const cfg = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: cfg.cloudName,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
  });

  const brandSlugs =
    slugs.length > 0
      ? slugs
      : readdirSync(DATA_DIR, { withFileTypes: true })
          .filter(
            (d) =>
              d.isDirectory() &&
              existsSync(join(DATA_DIR, d.name, 'raw', 'products.json')) &&
              existsSync(assetMapPath(d.name)),
          )
          .map((d) => d.name);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let totalLinked = 0;
  let totalUploaded = 0;
  let totalUnmatched = 0;
  try {
    for (const slug of brandSlugs) {
      const store = await prisma.store.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!store) {
        log.warn(`${slug}: no store in DB — skipped.`);
        continue;
      }

      const raw = JSON.parse(
        readFileSync(join(DATA_DIR, slug, 'raw', 'products.json'), 'utf8'),
      ) as ShopifyProduct[];
      const assets = JSON.parse(
        readFileSync(assetMapPath(slug), 'utf8'),
      ) as AssetMap;
      const hostedBySource = new Map<string, string>();
      for (const [src, rec] of Object.entries(assets)) {
        if (rec?.secureUrl && rec.kind === 'image') {
          hostedBySource.set(stripQuery(src), rec.secureUrl);
        }
      }
      let assetMapDirty = false;

      const dbProducts = await prisma.product.findMany({
        where: { storeId: store.id },
        select: {
          id: true,
          slug: true,
          title: true,
          images: { select: { url: true, sortOrder: true } },
          variants: { select: { id: true, sortOrder: true, imageUrl: true } },
        },
      });
      const bySlug = new Map(dbProducts.map((p) => [p.slug, p]));

      let linked = 0;
      let uploaded = 0;
      let unmatched = 0;
      for (const p of raw) {
        const dbP = bySlug.get(p.handle);
        if (!dbP || dbP.variants.length === 0) continue;
        const galleryUrls = new Set(dbP.images.map((img) => img.url));
        let nextSortOrder =
          dbP.images.reduce((max, img) => Math.max(max, img.sortOrder), -1) + 1;

        for (let i = 0; i < (p.variants ?? []).length; i++) {
          const v = p.variants[i];
          const src =
            v.featured_image?.src ??
            (p.images ?? []).find((img) => img.variant_ids?.includes(v.id))
              ?.src ??
            null;
          if (!src) continue;

          // Resolve (or create) the hosted asset for this colour image.
          let hosted = hostedBySource.get(stripQuery(src)) ?? null;
          if (!hosted) {
            const publicId = publicIdFor(slug, src);
            try {
              let res;
              try {
                res = await cloudinary.uploader.upload(src, {
                  public_id: publicId,
                  overwrite: false,
                  unique_filename: false,
                  use_filename: false,
                });
              } catch (imgErr) {
                const smaller = downscaledUrl(src);
                if (!smaller) throw imgErr;
                res = await cloudinary.uploader.upload(smaller, {
                  public_id: publicId,
                  overwrite: false,
                  unique_filename: false,
                  use_filename: false,
                });
              }
              hosted = res.secure_url;
              uploaded++;
              assets[src] = {
                secureUrl: hosted,
                publicId,
                kind: 'image',
                source: src,
                uploadedAt: new Date().toISOString(),
              };
              hostedBySource.set(stripQuery(src), hosted);
              assetMapDirty = true;
            } catch (err) {
              unmatched++;
              continue; // dead source URL etc. — variant stays null
            }
          }

          // Union rule: the colour image must exist in the gallery.
          if (!galleryUrls.has(hosted)) {
            await prisma.productImage.create({
              data: {
                productId: dbP.id,
                url: hosted,
                altText: dbP.title,
                sortOrder: nextSortOrder++,
                isPrimary: false,
              },
            });
            galleryUrls.add(hosted);
          }

          const sortOrder = v.position ?? i;
          const dbV = dbP.variants.find((x) => x.sortOrder === sortOrder);
          if (!dbV) {
            unmatched++;
            continue;
          }
          if (dbV.imageUrl === hosted) continue; // idempotent re-run

          await prisma.productVariant.update({
            where: { id: dbV.id },
            data: { imageUrl: hosted },
          });
          linked++;
        }
      }

      if (assetMapDirty) {
        writeFileSync(assetMapPath(slug), JSON.stringify(assets, null, 2));
      }
      totalLinked += linked;
      totalUploaded += uploaded;
      totalUnmatched += unmatched;
      log.info(
        `${slug}: ${linked} variant images linked, ${uploaded} uploaded (${unmatched} unmatched).`,
      );
    }
    log.step(
      `relink-variant-images done: ${totalLinked} linked, ${totalUploaded} uploaded, ${totalUnmatched} unmatched across ${brandSlugs.length} brands.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
