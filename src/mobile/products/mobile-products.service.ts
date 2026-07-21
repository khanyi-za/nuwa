import { createHash, randomBytes } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { genderFilterValues } from '../common/gender';
import type { GenderParam } from '../common/gender';
import {
  decodeCursor,
  decodeDiscoveryCursor,
  encodeCursor,
  encodeDiscoveryCursor,
} from '../common/cursor';
import { Paginated } from '../common/paginated';
import {
  PersonalFlags,
  toCarouselProduct,
  toFeedProduct,
  toProductDetail,
} from '../common/serializers';
import { FeedQueryDto } from './dto/feed-query.dto';
import { NewArrivalsQueryDto } from './dto/new-arrivals-query.dto';

// Primary-image-first, single-image select reused by the feed card shape.
const PRIMARY_IMAGE = {
  orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  take: 1,
  select: { url: true },
} satisfies Prisma.Product$imagesArgs;

// Select shared by the feed grid + all four search endpoints (same card shape).
const FEED_SELECT = {
  id: true,
  title: true,
  priceInCents: true,
  genderType: true,
  images: PRIMARY_IMAGE,
  categories: {
    take: 1,
    select: { category: { select: { slug: true, name: true } } },
  },
  store: { select: { id: true, slug: true, displayName: true, logoUrl: true } },
} satisfies Prisma.ProductSelect;

/**
 * Compact a search query for matching against store slugs: lowercase,
 * alphanumerics only ("Tol thema" → "tolthema", "so broke" → "sobroke").
 * Returns '' (skip the match) below 3 chars — too noisy for substrings.
 */
function compactForSlugMatch(q: string): string {
  const compact = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact.length >= 3 ? compact : '';
}

/** ACTIVE-product + ACTIVE-store base filter, with optional gender narrowing. */
function baseProductWhere(genderType?: GenderParam): Prisma.ProductWhereInput {
  return {
    status: ProductStatus.ACTIVE,
    store: { status: StoreStatus.ACTIVE },
    ...(genderType ? { genderType: { in: genderFilterValues(genderType) } } : {}),
  };
}

@Injectable()
export class MobileProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gender-filtered main grid, cursor-paginated. Personalised bookmark/follow
   * flags are included only for authenticated buyers; likes are local-only in
   * v1 so `isLikedByMe` is always false (see phalo-smart-engine memory).
   *
   * Ordering is the brand-diverse discovery shuffle (queryDiscoveryPage), not
   * plain recency — batch-imported catalogues made recency order read as one
   * brand's entire drop at a time.
   */
  async feed(dto: FeedQueryDto, userId?: string) {
    const where = baseProductWhere(dto.genderType);
    if (dto.category) {
      where.categories = {
        some: { categoryId: { in: await this.resolveCategoryIds(dto.category) } },
      };
    }
    return this.discoveryPage(
      where,
      { cursor: dto.cursor, limit: dto.limit ?? 20 },
      userId,
    );
  }

  // ─── Search (Screen 07) ─────────────────────────────────────────────────────
  // v1 = SQL ILIKE `contains` + recency ordering (queryFeedPage). Real relevance
  // / ranking is a Phalo concern (see phalo-smart-engine memory) — these methods
  // are the seam where Phalo plugs in later without changing the response shape.

  /** GET /api/search — q across product title / merchant / category / tag. */
  async searchUniversal(
    opts: {
      q: string;
      genderType?: GenderParam;
      category?: string;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const q = opts.q;
    // Brand names get stylized ("F I E L D S", "Tol'thema", "KOIKOI") so a
    // displayName substring match alone misses reasonable queries like
    // "fields" or "koi koi". Store slugs ARE the compact form of the brand
    // name — match the compacted query against them too.
    const compactQ = compactForSlugMatch(q);
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { store: { displayName: { contains: q, mode: 'insensitive' } } },
        ...(compactQ
          ? [{ store: { slug: { contains: compactQ, mode: 'insensitive' as const } } }]
          : []),
        {
          categories: {
            some: { category: { name: { contains: q, mode: 'insensitive' } } },
          },
        },
        { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
      ],
    };
    if (opts.category) {
      where.categories = {
        some: { categoryId: { in: await this.resolveCategoryIds(opts.category) } },
      };
    }
    return this.queryFeedPage(where, opts, userId);
  }

  /**
   * GET /api/search/category — products whose category name/slug matches.
   * This is a browse surface (Shop category cards, maya's category screen),
   * not a text search, so it gets the same brand-diverse discovery ordering
   * as the feed.
   */
  async searchByCategory(
    opts: {
      category: string;
      genderType?: GenderParam;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      categories: {
        some: {
          category: {
            OR: [
              { name: { contains: opts.category, mode: 'insensitive' } },
              { slug: { contains: opts.category, mode: 'insensitive' } },
            ],
          },
        },
      },
    };
    return this.discoveryPage(where, opts, userId);
  }

  /** GET /api/search/smart-category — products tagged matching (Tag = smartCategory). */
  async searchBySmartCategory(
    opts: {
      smartCategory: string;
      genderType?: GenderParam;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      tags: {
        some: {
          tag: { name: { contains: opts.smartCategory, mode: 'insensitive' } },
        },
      },
    };
    return this.queryFeedPage(where, opts, userId);
  }

  /**
   * GET /api/merchants/:username/products — a merchant's catalogue + the
   * distinct category slugs driving the category tabs. Reuses queryFeedPage.
   * v1 sort is newest only (price sorts deferred — MP-7). 404 if the store
   * isn't an ACTIVE, loadable catalogue.
   */
  async merchantProducts(
    slug: string,
    opts: {
      clothingType?: string;
      collection?: string;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== StoreStatus.ACTIVE) {
      throw new NotFoundException({
        code: 'MERCHANT_NOT_FOUND',
        message: 'Merchant not found',
      });
    }

    const where: Prisma.ProductWhereInput = {
      storeId: store.id,
      status: ProductStatus.ACTIVE,
    };
    if (opts.clothingType) {
      where.categories = {
        some: {
          category: {
            OR: [
              { slug: { equals: opts.clothingType, mode: 'insensitive' } },
              { name: { equals: opts.clothingType, mode: 'insensitive' } },
            ],
          },
        },
      };
    }
    // Brand-page collection tab (the merchant's own site section). Scoped to
    // this store — collection slugs are only unique per store.
    if (opts.collection) {
      where.collections = {
        some: {
          collection: {
            storeId: store.id,
            slug: { equals: opts.collection, mode: 'insensitive' },
          },
        },
      };
    }

    const page = await this.queryFeedPage(where, opts, userId);
    const storeCategories = await this.distinctStoreCategories(store.id);
    return new Paginated(
      {
        products: page.data.products,
        categories: storeCategories.map((c) => c.slug),
        // Brand-own imagery for the profile's category cards (one ACTIVE
        // product's primary image per category) — same idea as the
        // collection-cover fallback. Additive; `categories` stays the plain
        // slug list existing clients consume.
        categoryCovers: storeCategories,
      },
      page.pagination,
    );
  }

  private async distinctStoreCategories(
    storeId: string,
  ): Promise<{ slug: string; image: string | null }[]> {
    const cats = await this.prisma.category.findMany({
      where: {
        products: { some: { product: { storeId, status: ProductStatus.ACTIVE } } },
      },
      select: {
        slug: true,
        products: {
          where: { product: { storeId, status: ProductStatus.ACTIVE } },
          take: 1,
          select: {
            product: {
              select: {
                images: {
                  orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return cats.map((c) => ({
      slug: c.slug,
      image: c.products[0]?.product.images[0]?.url ?? null,
    }));
  }

  /** GET /api/search/merchant — products from stores whose name/slug matches. */
  async searchByMerchant(
    opts: {
      merchantName: string;
      genderType?: GenderParam;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const compactQ = compactForSlugMatch(opts.merchantName);
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      store: {
        status: StoreStatus.ACTIVE,
        OR: [
          { displayName: { contains: opts.merchantName, mode: 'insensitive' } },
          { slug: { contains: opts.merchantName, mode: 'insensitive' } },
          ...(compactQ
            ? [{ slug: { contains: compactQ, mode: 'insensitive' as const } }]
            : []),
        ],
      },
    };
    return this.queryFeedPage(where, opts, userId);
  }

  /**
   * "Smart dynamic" new-arrivals carousel. v1 heuristic = brand-diverse
   * recency: each store's newest ACTIVE product first (round-robin by store,
   * recency order within rounds, no shuffle) — plain newest-N read as one
   * batch-loaded brand's entire drop. The future Phalo engine replaces the
   * ranking without changing this shape (see phalo-smart-engine memory).
   */
  async newArrivals(dto: NewArrivalsQueryDto) {
    const limit = dto.limit ?? 6;

    const candidates = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        store: { status: StoreStatus.ACTIVE },
        genderType: { in: genderFilterValues(dto.genderType) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, storeId: true },
    });

    // Stable sort: rounds ascend, recency order preserved within a round.
    const seqByStore = new Map<string, number>();
    const pageIds = candidates
      .map((p) => {
        const round = seqByStore.get(p.storeId) ?? 0;
        seqByStore.set(p.storeId, round + 1);
        return { id: p.id, round };
      })
      .sort((a, b) => a.round - b.round)
      .slice(0, limit)
      .map((p) => p.id);

    const rows = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        title: true,
        priceInCents: true,
        images: PRIMARY_IMAGE,
        store: { select: { displayName: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const page = pageIds.flatMap((id) => byId.get(id) ?? []);

    return { products: page.map(toCarouselProduct) };
  }

  /**
   * Full product detail (Product Detail screen). 404 when the product or its
   * store isn't ACTIVE. Personalised bookmark/follow flags when authed.
   */
  async detail(productId: string, userId?: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        description: true,
        priceInCents: true,
        genderType: true,
        status: true,
        totalStock: true,
        reservedStock: true,
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          select: { url: true, mediaType: true },
        },
        variants: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            sku: true,
            size: true,
            stock: true,
            reservedStock: true,
          },
        },
        categories: {
          take: 1,
          select: { category: { select: { slug: true, name: true } } },
        },
        tags: { select: { tag: { select: { name: true } } } },
        store: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            logoUrl: true,
            description: true,
            status: true,
          },
        },
      },
    });

    if (
      !p ||
      p.status !== ProductStatus.ACTIVE ||
      p.store.status !== StoreStatus.ACTIVE
    ) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'This product is no longer available',
      });
    }

    let flags: PersonalFlags | undefined;
    if (userId) {
      const [bookmark, follow] = await Promise.all([
        this.prisma.wishlistItem.findUnique({
          where: { userId_productId: { userId, productId } },
          select: { id: true },
        }),
        this.prisma.storeFollower.findUnique({
          where: { userId_storeId: { userId, storeId: p.store.id } },
          select: { id: true },
        }),
      ]);
      flags = {
        isLikedByMe: false,
        isBookmarkedByMe: !!bookmark,
        isFollowedByMe: !!follow,
      };
    }

    return { product: toProductDetail(p, flags) };
  }

  /**
   * "Smart dynamic" similar-items carousel. v1 heuristic = the SAME BRAND's
   * other recent ACTIVE products, excluding the source (owner call 2026-07-09:
   * the rail is brand-scoped on every product page). Phalo replaces the
   * ranking later without changing this shape.
   */
  async similar(productId: string, limit: number) {
    const base = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, status: true },
    });
    if (!base || base.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      });
    }

    const rows = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        store: { status: StoreStatus.ACTIVE },
        id: { not: productId },
        storeId: base.storeId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        priceInCents: true,
        images: PRIMARY_IMAGE,
        store: { select: { displayName: true } },
      },
    });

    return { products: rows.map(toCarouselProduct) };
  }

  /**
   * Fire-and-forget product-view analytics signal. Writes a raw AnalyticsEvent
   * row; the future Phalo engine consumes these for recommendations + merchant
   * analytics (see phalo-smart-engine memory). No FK on productId — safe even
   * if the product later disappears.
   */
  async recordView(productId: string, userId?: string) {
    await this.prisma.analyticsEvent.create({
      data: { eventType: 'product_view', productId, userId: userId ?? null },
    });
    return { recorded: true };
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /**
   * Shared feed-grid query: cursor pagination over FEED_SELECT rows, with
   * personalised flags + card serialization. Used by feed() and all search
   * endpoints — one source of truth for the grid shape + pagination.
   */
  private async queryFeedPage(
    where: Prisma.ProductWhereInput,
    opts: { cursor?: string; limit: number },
    userId?: string,
  ): Promise<Paginated<{ products: ReturnType<typeof toFeedProduct>[] }>> {
    const rows = await this.prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor
        ? { cursor: { id: decodeCursor(opts.cursor) }, skip: 1 }
        : {}),
      select: FEED_SELECT,
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const flags = await this.personalFlags(page, userId);

    const products = page.map((p) => toFeedProduct(p, flags.get(p.id)));
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

    return new Paginated({ products }, { limit: opts.limit, nextCursor, hasMore });
  }

  /**
   * Routes discovery surfaces (feed + category browse) to the active ordering:
   * the plain brand round-robin, or — when FEED_SPOTLIGHT_STORE is set — the
   * demo-day spotlight variant that quietly over-represents one brand. Env-only
   * switch so dev/prod behavior is untouched unless deliberately enabled.
   */
  private async discoveryPage(
    where: Prisma.ProductWhereInput,
    opts: { cursor?: string; limit: number },
    userId?: string,
  ) {
    const slug = process.env.FEED_SPOTLIGHT_STORE?.trim();
    if (!slug) return this.queryDiscoveryPage(where, opts, userId);

    const weight = Math.max(2, Number(process.env.FEED_SPOTLIGHT_WEIGHT) || 3);
    const store = await this.prisma.store.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!store) return this.queryDiscoveryPage(where, opts, userId);

    return this.querySpotlightDiscoveryPage(where, opts, userId, {
      storeId: store.id,
      weight,
    });
  }

  /**
   * DEMO-DAY variant of queryDiscoveryPage — same brand round-robin + seeded
   * shuffle, except the spotlight store fills `weight` slots per round instead
   * of one (its n-th product joins round floor(n / weight)). The within-round
   * shuffle scatters those slots, so the brand simply shows up ~weight× as
   * often as anyone else — frequent but with no visible pattern. Enabled via
   * FEED_SPOTLIGHT_STORE=<store slug> (+ optional FEED_SPOTLIGHT_WEIGHT,
   * default 3) on the server process; unset it to fall back to the standard
   * algorithm. Deliberately kept separate from queryDiscoveryPage.
   */
  private async querySpotlightDiscoveryPage(
    where: Prisma.ProductWhereInput,
    opts: { cursor?: string; limit: number },
    userId: string | undefined,
    spotlight: { storeId: string; weight: number },
  ): Promise<Paginated<{ products: ReturnType<typeof toFeedProduct>[] }>> {
    const { seed, offset } = opts.cursor
      ? decodeDiscoveryCursor(opts.cursor)
      : { seed: randomBytes(4).toString('hex'), offset: 0 };

    const candidates = await this.prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, storeId: true },
    });

    const seqByStore = new Map<string, number>();
    const ordered = candidates
      .map((p) => {
        const seq = seqByStore.get(p.storeId) ?? 0;
        seqByStore.set(p.storeId, seq + 1);
        const round =
          p.storeId === spotlight.storeId
            ? Math.floor(seq / spotlight.weight)
            : seq;
        return {
          id: p.id,
          round,
          shuffleKey: createHash('sha1').update(`${seed}:${p.id}`).digest('hex'),
        };
      })
      .sort(
        (a, b) => a.round - b.round || a.shuffleKey.localeCompare(b.shuffleKey),
      );

    const hasMore = ordered.length > offset + opts.limit;
    const pageIds = ordered.slice(offset, offset + opts.limit).map((p) => p.id);

    const rows = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      select: FEED_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const page = pageIds.flatMap((id) => byId.get(id) ?? []);

    const flags = await this.personalFlags(page, userId);
    const products = page.map((p) => toFeedProduct(p, flags.get(p.id)));
    const nextCursor = hasMore
      ? encodeDiscoveryCursor(seed, offset + opts.limit)
      : null;

    return new Paginated({ products }, { limit: opts.limit, nextCursor, hasMore });
  }

  /**
   * Discovery-grid query: brand round-robin with a seeded shuffle. Products are
   * ranked within their store by recency (round 0 = each store's newest), then
   * ordered by (round, sha1(seed:productId)) — so every store appears once per
   * round before any store repeats, and the order within a round is a stable
   * pseudo-random arrangement per seed. A fresh load (no cursor) draws a new
   * seed → new arrangement; the cursor carries {seed, offset} so infinite
   * scroll stays consistent within one session.
   *
   * v1 heuristic — the ordering is Phalo's seam (product scores later replace
   * the round key without changing the response shape). The id-scan per page is
   * fine at current catalogue scale; move to precomputed ordering when it grows.
   */
  private async queryDiscoveryPage(
    where: Prisma.ProductWhereInput,
    opts: { cursor?: string; limit: number },
    userId?: string,
  ): Promise<Paginated<{ products: ReturnType<typeof toFeedProduct>[] }>> {
    const { seed, offset } = opts.cursor
      ? decodeDiscoveryCursor(opts.cursor)
      : { seed: randomBytes(4).toString('hex'), offset: 0 };

    // Recency order doubles as the within-store ranking: the n-th time a store
    // appears is that product's round n.
    const candidates = await this.prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, storeId: true },
    });

    const roundByStore = new Map<string, number>();
    const ordered = candidates
      .map((p) => {
        const round = roundByStore.get(p.storeId) ?? 0;
        roundByStore.set(p.storeId, round + 1);
        return {
          id: p.id,
          round,
          shuffleKey: createHash('sha1').update(`${seed}:${p.id}`).digest('hex'),
        };
      })
      .sort(
        (a, b) => a.round - b.round || a.shuffleKey.localeCompare(b.shuffleKey),
      );

    const hasMore = ordered.length > offset + opts.limit;
    const pageIds = ordered.slice(offset, offset + opts.limit).map((p) => p.id);

    const rows = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      select: FEED_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const page = pageIds.flatMap((id) => byId.get(id) ?? []);

    const flags = await this.personalFlags(page, userId);
    const products = page.map((p) => toFeedProduct(p, flags.get(p.id)));
    const nextCursor = hasMore
      ? encodeDiscoveryCursor(seed, offset + opts.limit)
      : null;

    return new Paginated({ products }, { limit: opts.limit, nextCursor, hasMore });
  }

  private async personalFlags(
    rows: { id: string; store: { id: string } }[],
    userId?: string,
  ): Promise<Map<string, PersonalFlags | undefined>> {
    const map = new Map<string, PersonalFlags | undefined>();
    if (!userId) {
      for (const r of rows) map.set(r.id, undefined);
      return map;
    }

    const productIds = rows.map((r) => r.id);
    const storeIds = [...new Set(rows.map((r) => r.store.id))];

    const [bookmarks, follows] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId, productId: { in: productIds } },
        select: { productId: true },
      }),
      this.prisma.storeFollower.findMany({
        where: { userId, storeId: { in: storeIds } },
        select: { storeId: true },
      }),
    ]);

    const bookmarked = new Set(bookmarks.map((b) => b.productId));
    const followed = new Set(follows.map((f) => f.storeId));

    for (const r of rows) {
      map.set(r.id, {
        isLikedByMe: false,
        isBookmarkedByMe: bookmarked.has(r.id),
        isFollowedByMe: followed.has(r.store.id),
      });
    }
    return map;
  }

  /** Resolve a category slug to its id + all descendant ids (BFS). */
  private async resolveCategoryIds(slug: string): Promise<string[]> {
    const root = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!root) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenMap = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId) {
        const siblings = childrenMap.get(c.parentId) ?? [];
        siblings.push(c.id);
        childrenMap.set(c.parentId, siblings);
      }
    }

    const result = [root.id];
    const queue = [root.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childrenMap.get(current) ?? []) {
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }
}
