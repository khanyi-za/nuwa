import { createHash, randomBytes } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { genderFilterValues } from '../common/gender';
import type { GenderParam } from '../common/gender';
import {
  decodeCursor,
  decodeDiscoveryCursor,
  decodeOffsetCursor,
  encodeCursor,
  encodeDiscoveryCursor,
  encodeOffsetCursor,
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

// ─── Feed scoring (phalo product_scores consumption) ─────────────────────────
// "Fair rounds, smart slots": the brand round-robin stays (the exposure
// guarantee — every ACTIVE brand appears once per round), but WITHIN the
// structure phalo's engagement scores decide (a) which product represents a
// brand each round (best-performing first) and (b) the order inside a round.
//
// effectiveScore = (score + SCORE_PRIOR) * jitter(seed, productId)
//
// The prior lifts zero-data products off the floor so the seeded jitter gives
// them real exploration — a brand-new product can outrank a mid-scorer on some
// visits (the new-merchant cold-start guarantee) but can never displace a
// dominant one (score 100 can't lose to score 0 at jitter 0.5–1.5×). With no
// scores at all the key degrades to prior×jitter — a pure seeded shuffle,
// today's exact semantics.
const SCORE_PRIOR = 1.0;
const JITTER_MIN = 0.5;
const JITTER_MAX = 1.5;

// ─── Personalization boosts (step 2 — request-time, nuwa-native) ─────────────
// Multipliers on effectiveScore for authenticated buyers. They compose with
// (and work without) phalo scores; guests get no boosts and the round-robin
// fairness cap is untouched either way — boosts only reorder WITHIN rounds.
//
// FOLLOWED_STORE_BOOST > JITTER_MAX/JITTER_MIN (3×) on purpose: among
// equal-score products, a subscribed brand's product deterministically leads
// its round — jitter can never bury a subscription. Engagement still
// dominates the boost (a high phalo score outranks a followed zero-score).
// AFFINITY_CATEGORY_BOOST is a soft nudge inside the jitter band: categories
// the buyer has been browsing tend to surface earlier, without locking the
// feed into a filter bubble. Affinity also breaks within-store ties, so the
// product representing a brand in round 0 leans toward the buyer's browsed
// categories.
const FOLLOWED_STORE_BOOST = 3.5;
const AFFINITY_CATEGORY_BOOST = 1.25;
const AFFINITY_VIEW_WINDOW_DAYS = 30;
const AFFINITY_RECENT_VIEWS = 200;
const AFFINITY_TOP_CATEGORIES = 3;

interface PersonalAffinity {
  followedStoreIds: Set<string>;
  affinityCategoryIds: Set<string>;
}

const EMPTY_AFFINITY: PersonalAffinity = {
  followedStoreIds: new Set(),
  affinityCategoryIds: new Set(),
};

/** Deterministic per-(seed, product) jitter in [JITTER_MIN, JITTER_MAX]. */
function scoreJitter(seed: string, productId: string): number {
  const hex = createHash('sha1')
    .update(`${seed}:${productId}`)
    .digest('hex')
    .slice(0, 8);
  const unit = parseInt(hex, 16) / 0xffffffff;
  return JITTER_MIN + unit * (JITTER_MAX - JITTER_MIN);
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
   * "Smart dynamic" new arrivals: brand-diverse recency — each store's newest
   * ACTIVE product first (round-robin by store, recency order within rounds,
   * NO shuffle) — plain newest-N read as one batch-loaded brand's entire
   * drop. Serves BOTH the Home rail (default limit 6, no cursor) and the
   * "See All" browse screen (cursor-paginated). The ordering is fully
   * deterministic, so a plain offset cursor pages it stably. Products are
   * feed-card-shaped (incl. merchant.username for brand links + personalised
   * flags when authed). The future Phalo `new_arrival` score replaces the
   * ranking without changing this shape (see phalo-smart-engine memory).
   */
  async newArrivals(dto: NewArrivalsQueryDto, userId?: string) {
    const limit = dto.limit ?? 6;
    const offset = dto.cursor ? decodeOffsetCursor(dto.cursor) : 0;

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
    const orderedIds = candidates
      .map((p) => {
        const round = seqByStore.get(p.storeId) ?? 0;
        seqByStore.set(p.storeId, round + 1);
        return { id: p.id, round };
      })
      .sort((a, b) => a.round - b.round)
      .map((p) => p.id);

    const hasMore = orderedIds.length > offset + limit;
    const pageIds = orderedIds.slice(offset, offset + limit);

    const rows = await this.prisma.product.findMany({
      where: { id: { in: pageIds } },
      select: FEED_SELECT,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const page = pageIds.flatMap((id) => byId.get(id) ?? []);

    const flags = await this.personalFlags(page, userId);
    const products = page.map((p) => toFeedProduct(p, flags.get(p.id)));

    return new Paginated(
      { products },
      {
        limit,
        nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
        hasMore,
      },
    );
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
            color: true,
            imageUrl: true,
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
            returnPolicyText: true,
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
   * Discovery-grid query: brand round-robin ("fair rounds") with phalo
   * engagement scores deciding the order inside the structure ("smart slots").
   *
   * Round assignment: within each store, products rank by phalo popularity
   * score (best first; recency breaks ties and orders unscored products), and
   * a store's n-th ranked product joins round n — so every store appears once
   * per round before any store repeats (the merchant-exposure guarantee).
   * Within a round, order is effectiveScore = (score + prior) × seeded jitter,
   * descending — see the scoring constants above for the exploration rationale.
   *
   * Phalo absent/stale/down → empty score map → recency round assignment +
   * prior×jitter ordering = the original pure seeded shuffle (PH-4: a broken
   * ranking source must never break the feed). A fresh load (no cursor) draws
   * a new seed → new arrangement; the cursor carries {seed, offset} so
   * infinite scroll stays consistent within one session. The id-scan per page
   * is fine at current catalogue scale; precompute when it grows.
   */
  private async queryDiscoveryPage(
    where: Prisma.ProductWhereInput,
    opts: { cursor?: string; limit: number },
    userId?: string,
  ): Promise<Paginated<{ products: ReturnType<typeof toFeedProduct>[] }>> {
    const { seed, offset } = opts.cursor
      ? decodeDiscoveryCursor(opts.cursor)
      : { seed: randomBytes(4).toString('hex'), offset: 0 };

    // Recency order is the baseline within-store ranking (and the tie-break
    // when scores exist): the n-th product of a store is that store's round n.
    // Candidates, phalo scores, and the buyer's affinity are independent reads.
    const [candidates, scores, affinity] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          storeId: true,
          categories: { take: 1, select: { categoryId: true } },
        },
      }),
      this.phaloProductScores(),
      this.personalAffinity(userId),
    ]);

    const inAffinityCategory = (p: {
      categories?: { categoryId: string }[];
    }): boolean => {
      const categoryId = p.categories?.[0]?.categoryId;
      return !!categoryId && affinity.affinityCategoryIds.has(categoryId);
    };

    // Group per store (recency order preserved), then — when scores or
    // affinity exist — stable-sort each store's list so the store's best
    // product (score first, buyer's browsed category as tie-break) represents
    // it in the earliest round.
    const byStore = new Map<string, (typeof candidates)[number][]>();
    for (const p of candidates) {
      const list = byStore.get(p.storeId);
      if (list) list.push(p);
      else byStore.set(p.storeId, [p]);
    }
    if (scores.size > 0 || affinity.affinityCategoryIds.size > 0) {
      for (const list of byStore.values()) {
        const recencyRank = new Map(list.map((p, i) => [p.id, i]));
        list.sort(
          (a, b) =>
            (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
            Number(inAffinityCategory(b)) - Number(inAffinityCategory(a)) ||
            recencyRank.get(a.id)! - recencyRank.get(b.id)!,
        );
      }
    }

    const ordered = [...byStore.values()]
      .flatMap((list) =>
        list.map((p, round) => {
          const boost =
            (affinity.followedStoreIds.has(p.storeId)
              ? FOLLOWED_STORE_BOOST
              : 1) * (inAffinityCategory(p) ? AFFINITY_CATEGORY_BOOST : 1);
          return {
            id: p.id,
            round,
            effectiveScore:
              ((scores.get(p.id) ?? 0) + SCORE_PRIOR) *
              scoreJitter(seed, p.id) *
              boost,
          };
        }),
      )
      .sort(
        (a, b) =>
          a.round - b.round ||
          b.effectiveScore - a.effectiveScore ||
          a.id.localeCompare(b.id),
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
   * The buyer's personalization context: stores they subscribe to + the
   * categories they've been browsing (recent product views → primary
   * categories → top N by view count). Guests get the empty affinity —
   * zero extra queries, ordering identical to today.
   */
  private async personalAffinity(userId?: string): Promise<PersonalAffinity> {
    if (!userId) return EMPTY_AFFINITY;

    const windowStart = new Date(
      Date.now() - AFFINITY_VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [follows, recentViews] = await Promise.all([
      this.prisma.storeFollower.findMany({
        where: { userId },
        select: { storeId: true },
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          userId,
          eventType: 'product_view',
          productId: { not: null },
          createdAt: { gt: windowStart },
        },
        orderBy: { createdAt: 'desc' },
        take: AFFINITY_RECENT_VIEWS,
        select: { productId: true },
      }),
    ]);

    const viewsPerProduct = new Map<string, number>();
    for (const v of recentViews) {
      viewsPerProduct.set(
        v.productId!,
        (viewsPerProduct.get(v.productId!) ?? 0) + 1,
      );
    }

    const affinityCategoryIds = new Set<string>();
    if (viewsPerProduct.size > 0) {
      const links = await this.prisma.productCategory.findMany({
        where: { productId: { in: [...viewsPerProduct.keys()] } },
        select: { productId: true, categoryId: true },
      });
      const weightPerCategory = new Map<string, number>();
      for (const link of links) {
        weightPerCategory.set(
          link.categoryId,
          (weightPerCategory.get(link.categoryId) ?? 0) +
            (viewsPerProduct.get(link.productId) ?? 0),
        );
      }
      [...weightPerCategory.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, AFFINITY_TOP_CATEGORIES)
        .forEach(([categoryId]) => affinityCategoryIds.add(categoryId));
    }

    return {
      followedStoreIds: new Set(follows.map((f) => f.storeId)),
      affinityCategoryIds,
    };
  }

  /**
   * Phalo popularity scores, product_id → score. Same contract as the
   * trending_stores reader in MobileMerchantsService: rows must be fresher
   * than 24h, and ANY error (schema missing, phalo down, stale) returns an
   * empty map so the seeded-shuffle fallback always wins over a broken
   * ranking source (PH-4).
   */
  private async phaloProductScores(): Promise<Map<string, number>> {
    try {
      const rows = await this.prisma.$queryRaw<
        { product_id: string; score: number }[]
      >`
        SELECT product_id, score
        FROM phalo.product_scores
        WHERE score_type = 'popularity'
          AND score > 0
          AND computed_at > now() - interval '24 hours'
      `;
      return new Map(rows.map((r) => [r.product_id, Number(r.score)]));
    } catch {
      return new Map();
    }
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
