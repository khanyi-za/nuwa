import * as fs from 'fs';

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

import { assetMapPath, assertValidSlug, curatedPath, manifestPath } from '../config';
import { log } from '../logger';
import type { Manifest, ManifestProduct } from '../manifest/types';
import { slugify } from '../transform/heuristics';

const DEMO_PASSWORD = 'DemoPass1'; // shared local demo login (printed in summary)
const DEMO_EMAIL_DOMAIN = 'demo.yiiva.co.za';

// Placeholder logistics so checkout shipping quotes resolve in the demo
// (a real dispatch address is what makes ShipLogic return live rates).
const DEMO_DISPATCH = {
  contactName: 'Demo Dispatch',
  contactPhone: '+27630000000',
  addressLine1: '180 Katherine Street',
  suburb: 'Barlow Park',
  city: 'Sandton',
  province: 'Gauteng',
  postalCode: '2148',
  country: 'South Africa',
};

interface AssetRecord { secureUrl: string; kind: string; }
type AssetMap = Record<string, AssetRecord>;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function prismaClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres before running load.');
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export async function runLoad({ slug }: { slug: string }): Promise<void> {
  assertValidSlug(slug);

  // Prefer curated.json; fall back to manifest with a warning.
  const cPath = curatedPath(slug);
  const mPath = manifestPath(slug);
  const src = fs.existsSync(cPath) ? cPath : mPath;
  if (!fs.existsSync(src)) throw new Error(`No manifest/curated file for "${slug}". Run transform/curate first.`);
  if (src === mPath) log.warn('No curated.json — loading from manifest.json (run `curate` to trim first).');
  const manifest = readJson<Manifest>(src);

  if (!fs.existsSync(assetMapPath(slug))) {
    throw new Error(`No asset-map.json for "${slug}". Run: rehost ${slug} first (images must be on Cloudinary).`);
  }
  const assets = readJson<AssetMap>(assetMapPath(slug));
  const cdn = (sourceUrl: string | null | undefined): string | null =>
    sourceUrl ? assets[sourceUrl]?.secureUrl ?? null : null;

  const prisma = prismaClient();
  log.step(`Load: ${slug} → demo DB`);

  try {
    const email = `${slug}@${DEMO_EMAIL_DOMAIN}`;

    // 1. Wipe-and-reload (DI-9): deleting the owner cascades to the Store and all
    //    its products/collections/etc.
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await prisma.user.delete({ where: { id: existing.id } });
      log.info('Removed previous demo store for re-load.');
    }

    // 2. Merchant user + store.
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: manifest.store.displayName,
        lastName: '(Demo)',
        role: 'MERCHANT',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
      select: { id: true },
    });

    const store = await prisma.store.create({
      data: {
        ownerId: user.id,
        companyName: `${manifest.store.companyName} (Demo)`,
        displayName: manifest.store.displayName,
        slug: manifest.store.slug,
        description: manifest.store.description,
        websiteUrl: manifest.store.websiteUrl,
        logoUrl: cdn(manifest.store.logoSourceUrl),
        contactEmail: email,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    // 3. Public + dispatch addresses (dispatch makes shipping quotes work).
    await prisma.storeAddress.create({
      data: {
        storeId: store.id,
        streetNumber: '180',
        streetName: 'Katherine Street',
        suburb: DEMO_DISPATCH.suburb,
        city: DEMO_DISPATCH.city,
        postalCode: DEMO_DISPATCH.postalCode,
      },
    });
    await prisma.storeDispatchAddress.create({
      data: { storeId: store.id, label: 'Studio', isPrimary: true, ...DEMO_DISPATCH },
    });

    // 4. Collections → slug→id.
    const collectionId = new Map<string, string>();
    for (const c of manifest.collections.filter((x) => x.include)) {
      const created = await prisma.storeCollection.create({
        data: {
          storeId: store.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          imageUrl: cdn(c.imageSourceUrl),
          sortOrder: c.sortOrder,
        },
        select: { id: true },
      });
      collectionId.set(c.slug, created.id);
    }

    // 5. Platform category slug→id (link only when the demo DB has it).
    const wantedCats = new Set(
      manifest.products.filter((p) => p.include && p.suggestedCategorySlug).map((p) => p.suggestedCategorySlug!),
    );
    const cats = await prisma.category.findMany({
      where: { slug: { in: [...wantedCats] } },
      select: { id: true, slug: true },
    });
    const categoryId = new Map(cats.map((c) => [c.slug, c.id]));

    // 6. Products (+ variants, images, collection/category/tag links, videos).
    const productVideos = new Map<string, string[]>(); // productSlug → [video sourceUrl]
    manifest.videos
      .filter((v) => v.target === 'product' && v.productSlug)
      .forEach((v) => {
        const arr = productVideos.get(v.productSlug!) ?? [];
        arr.push(v.url);
        productVideos.set(v.productSlug!, arr);
      });

    const included = manifest.products.filter((p) => p.include);
    let productCount = 0;
    let variantCount = 0;
    let skippedNoImage = 0;

    for (const p of included) {
      const imageRows = buildImageRows(p, cdn);
      // Append paired product videos to the gallery as VIDEO media.
      (productVideos.get(p.slug) ?? []).forEach((vurl, i) => {
        const u = cdn(vurl);
        if (u) imageRows.push({ url: u, altText: p.title, mediaType: 'VIDEO', sortOrder: imageRows.length + i, isPrimary: false });
      });
      if (imageRows.length === 0) {
        skippedNoImage++;
        continue; // nothing rehosted for this product → skip (can't show it)
      }

      const created = await prisma.product.create({
        data: {
          storeId: store.id,
          title: p.title,
          slug: p.slug,
          description: p.description,
          status: 'ACTIVE',
          genderType: p.genderType,
          priceInCents: p.priceInCents,
          comparePriceInCents: p.comparePriceInCents,
          weightInGrams: p.weightInGrams,
          totalStock: p.isBare ? p.totalStock : 0,
          publishedAt: new Date(),
          images: { create: imageRows },
          variants: p.isBare
            ? undefined
            : {
                create: p.variants.map((v) => ({
                  name: v.name,
                  sku: v.sku,
                  color: v.color,
                  size: v.size,
                  material: v.material,
                  priceInCents: v.priceInCents,
                  stock: v.stock,
                  sortOrder: v.sortOrder,
                })),
              },
        },
        select: { id: true },
      });
      productCount++;
      variantCount += p.isBare ? 0 : p.variants.length;

      // Collection links.
      for (const cslug of p.collectionSlugs) {
        const cid = collectionId.get(cslug);
        if (cid) await prisma.productCollection.create({ data: { productId: created.id, collectionId: cid } });
      }
      // Category link.
      const catId = p.suggestedCategorySlug ? categoryId.get(p.suggestedCategorySlug) : undefined;
      if (catId) await prisma.productCategory.create({ data: { productId: created.id, categoryId: catId } });
      // Tags.
      for (const tagName of p.tags.slice(0, 10)) {
        const tag = await prisma.tag.upsert({
          where: { name: tagName },
          create: { name: tagName, slug: slugify(tagName) },
          update: {},
          select: { id: true },
        });
        await prisma.productTag.create({ data: { productId: created.id, tagId: tag.id } }).catch(() => undefined);
      }
    }

    // 7. Store banner media: hero videos first (cover), then a few hero images.
    const heroVideos = manifest.videos.filter((v) => v.target === 'hero').map((v) => cdn(v.url)).filter(Boolean) as string[];
    const heroImages = included
      .flatMap((p) => p.images.map((img) => cdn(img.sourceUrl)))
      .filter(Boolean)
      .slice(0, 5 - heroVideos.length) as string[];
    const banners = [
      ...heroVideos.map((url) => ({ url, mediaType: 'VIDEO' as const })),
      ...heroImages.map((url) => ({ url, mediaType: 'IMAGE' as const })),
    ].slice(0, 5);
    for (let i = 0; i < banners.length; i++) {
      await prisma.storeBannerMedia.create({
        data: { storeId: store.id, url: banners[i].url, mediaType: banners[i].mediaType, sortOrder: i, isPrimary: i === 0 },
      });
    }

    log.step('Load summary');
    log.ok(`store:        ${manifest.store.displayName} (ACTIVE, slug=${manifest.store.slug})`);
    log.ok(`login:        ${email} / ${DEMO_PASSWORD}`);
    log.ok(`products:     ${productCount}  (variants ${variantCount})`);
    log.ok(`collections:  ${collectionId.size}`);
    log.ok(`banners:      ${banners.length} (${heroVideos.length} video)`);
    if (skippedNoImage > 0) log.warn(`${skippedNoImage} products skipped (no rehosted image in asset-map)`);
    if (categoryId.size === 0 && wantedCats.size > 0)
      log.warn('No platform categories matched — seed the Category tree in the demo DB to enable category chips.');
  } finally {
    await prisma.$disconnect();
  }
}

function buildImageRows(
  p: ManifestProduct,
  cdn: (s: string | null | undefined) => string | null,
): { url: string; altText: string | null; mediaType: 'IMAGE' | 'VIDEO'; sortOrder: number; isPrimary: boolean }[] {
  const rows: { url: string; altText: string | null; mediaType: 'IMAGE' | 'VIDEO'; sortOrder: number; isPrimary: boolean }[] = [];
  p.images.forEach((img) => {
    const url = cdn(img.sourceUrl);
    if (url) rows.push({ url, altText: img.altText, mediaType: 'IMAGE', sortOrder: rows.length, isPrimary: rows.length === 0 });
  });
  return rows;
}
