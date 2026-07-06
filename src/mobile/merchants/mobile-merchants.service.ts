import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenderParam, genderFilterValues } from '../common/gender';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Paginated } from '../common/paginated';
import {
  toMerchantDirectoryCard,
  toMerchantProfile,
  toTrendingMerchant,
} from '../common/serializers';

const DIRECTORY_SORT: Record<
  string,
  Prisma.StoreOrderByWithRelationInput[]
> = {
  name_asc: [{ displayName: 'asc' }, { id: 'asc' }],
  name_desc: [{ displayName: 'desc' }, { id: 'desc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  popularity: [{ followerCount: 'desc' }, { id: 'desc' }],
};

// Stores a buyer can load by handle: live (ACTIVE) or formerly-live
// (SUSPENDED/CLOSED, shown as an "unavailable" placeholder). Never-live stores
// (DRAFT/PENDING_REVIEW/APPROVED/PENDING_GO_LIVE) 404.
const LOADABLE_STATUSES: StoreStatus[] = [
  StoreStatus.ACTIVE,
  StoreStatus.SUSPENDED,
  StoreStatus.CLOSED,
];

@Injectable()
export class MobileMerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Smart dynamic" trending merchants. Reads Phalo's ranking
   * (`phalo.trending_stores`, 7d window) when fresh (<24h); otherwise falls
   * back to the original followerCount heuristic (PH-4: Phalo down = stale
   * rankings, never an outage). API shape unchanged either way. When
   * `genderType` is set, only stores with at least one ACTIVE product in that
   * gender qualify.
   */
  async trending(opts: {
    genderType?: GenderParam;
    limit: number;
    userId?: string;
  }) {
    const where: Prisma.StoreWhereInput = { status: StoreStatus.ACTIVE };
    if (opts.genderType) {
      where.products = {
        some: {
          status: ProductStatus.ACTIVE,
          genderType: { in: genderFilterValues(opts.genderType) },
        },
      };
    }

    const storeSelect = {
      id: true,
      slug: true,
      displayName: true,
      logoUrl: true,
      followerCount: true,
    } as const;

    let stores: {
      id: string;
      slug: string;
      displayName: string;
      logoUrl: string | null;
      followerCount: number;
    }[] = [];

    const rankedIds = await this.phaloTrendingStoreIds();
    if (rankedIds.length > 0) {
      const candidates = await this.prisma.store.findMany({
        where: { ...where, id: { in: rankedIds } },
        select: storeSelect,
      });
      const byId = new Map(candidates.map((s) => [s.id, s]));
      stores = rankedIds
        .map((id) => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .slice(0, opts.limit);
    }

    // Heuristic fallback: phalo table absent/stale/empty, or the gender
    // filter eliminated every ranked store.
    if (stores.length === 0) {
      stores = await this.prisma.store.findMany({
        where,
        orderBy: [{ followerCount: 'desc' }, { id: 'desc' }],
        take: opts.limit,
        select: storeSelect,
      });
    }

    let followed = new Set<string>();
    if (opts.userId && stores.length > 0) {
      const rows = await this.prisma.storeFollower.findMany({
        where: { userId: opts.userId, storeId: { in: stores.map((s) => s.id) } },
        select: { storeId: true },
      });
      followed = new Set(rows.map((r) => r.storeId));
    }

    const authed = !!opts.userId;
    return {
      merchants: stores.map((s) =>
        toTrendingMerchant(s, authed ? followed.has(s.id) : undefined),
      ),
    };
  }

  /**
   * Phalo's trending ranking — ordered store ids, or [] when the table is
   * missing (fresh envs without the phalo service), empty, or stale (>24h).
   * Errors are swallowed deliberately: the heuristic fallback must always win
   * over a broken ranking source.
   */
  private async phaloTrendingStoreIds(): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ store_id: string }[]>`
        SELECT store_id
        FROM phalo.trending_stores
        WHERE "window" = '7d'
          AND computed_at > now() - interval '24 hours'
        ORDER BY rank ASC
      `;
      return rows.map((r) => r.store_id);
    } catch {
      return [];
    }
  }

  /**
   * GET /api/merchants — the A–Z brand directory (Shop tab). ACTIVE stores,
   * optional gender + letter filters, cursor-paginated. Returns per-brand
   * `productCount` and a `lettersWithBrands` set for the alphabet index.
   * v1 loads all matching display names to compute the letter set — fine at
   * current catalogue size; precompute if the brand count grows large.
   */
  async directory(
    opts: {
      genderType?: GenderParam;
      letter?: string;
      sort?: string;
      cursor?: string;
      limit: number;
    },
    userId?: string,
  ) {
    const genderFilter: Prisma.StoreWhereInput = opts.genderType
      ? {
          products: {
            some: {
              status: ProductStatus.ACTIVE,
              genderType: { in: genderFilterValues(opts.genderType) },
            },
          },
        }
      : {};

    const where: Prisma.StoreWhereInput = {
      status: StoreStatus.ACTIVE,
      ...genderFilter,
      ...(opts.letter
        ? { displayName: { startsWith: opts.letter, mode: 'insensitive' } }
        : {}),
    };

    const stores = await this.prisma.store.findMany({
      where,
      orderBy: DIRECTORY_SORT[opts.sort ?? 'name_asc'],
      take: opts.limit + 1,
      ...(opts.cursor
        ? { cursor: { id: decodeCursor(opts.cursor) }, skip: 1 }
        : {}),
      select: {
        id: true,
        slug: true,
        displayName: true,
        logoUrl: true,
        followerCount: true,
      },
    });

    const hasMore = stores.length > opts.limit;
    const page = hasMore ? stores.slice(0, opts.limit) : stores;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;
    const ids = page.map((s) => s.id);

    const counts = ids.length
      ? await this.prisma.product.groupBy({
          by: ['storeId'],
          where: { storeId: { in: ids }, status: ProductStatus.ACTIVE },
          _count: { _all: true },
        })
      : [];
    const countByStore = new Map(counts.map((c) => [c.storeId, c._count._all]));

    let followed = new Set<string>();
    if (userId && ids.length) {
      const rows = await this.prisma.storeFollower.findMany({
        where: { userId, storeId: { in: ids } },
        select: { storeId: true },
      });
      followed = new Set(rows.map((r) => r.storeId));
    }

    // Letters across the whole gender-filtered directory (ignores letter +
    // pagination) so the alphabet index can grey out empty letters.
    const allNames = await this.prisma.store.findMany({
      where: { status: StoreStatus.ACTIVE, ...genderFilter },
      select: { displayName: true },
    });
    const lettersWithBrands = [
      ...new Set(
        allNames
          .map((s) => s.displayName.charAt(0).toUpperCase())
          .filter((c) => /[A-Z]/.test(c)),
      ),
    ].sort();

    const authed = !!userId;
    const merchants = page.map((s) =>
      toMerchantDirectoryCard(s, {
        productCount: countByStore.get(s.id) ?? 0,
        isFollowedByMe: authed ? followed.has(s.id) : undefined,
      }),
    );

    return new Paginated(
      { merchants, lettersWithBrands },
      { limit: opts.limit, nextCursor, hasMore },
    );
  }

  /** GET /api/merchants/:username — full profile (Store by slug). */
  async getProfile(username: string, userId?: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug: username },
      select: {
        id: true,
        slug: true,
        displayName: true,
        logoUrl: true,
        description: true,
        status: true,
        followerCount: true,
        contactEmail: true,
        bannerMedia: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
        addresses: { take: 1, select: { city: true } },
      },
    });

    if (!store || !LOADABLE_STATUSES.includes(store.status)) {
      throw new NotFoundException({
        code: 'MERCHANT_NOT_FOUND',
        message: 'Merchant not found',
      });
    }

    const postCount = await this.prisma.product.count({
      where: { storeId: store.id, status: ProductStatus.ACTIVE },
    });

    // The merchant's own site sections — collections in their sortOrder,
    // hiding any with no ACTIVE products (no dead tabs on the brand page).
    const collectionRows = await this.prisma.storeCollection.findMany({
      where: {
        storeId: store.id,
        showOnProfile: true,
        products: { some: { product: { status: ProductStatus.ACTIVE } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        _count: {
          select: {
            products: { where: { product: { status: ProductStatus.ACTIVE } } },
          },
        },
      },
    });
    const collections = collectionRows.map((c) => ({
      slug: c.slug,
      name: c.name,
      image: c.imageUrl ?? null,
      productCount: c._count.products,
    }));

    let isFollowedByMe: boolean | undefined;
    if (userId) {
      const follow = await this.prisma.storeFollower.findUnique({
        where: { userId_storeId: { userId, storeId: store.id } },
        select: { id: true },
      });
      isFollowedByMe = !!follow;
    }

    return {
      merchant: toMerchantProfile(store, {
        postCount,
        isFollowedByMe,
        collections,
      }),
    };
  }

  /** POST /api/merchants/:id/view — thin merchant-view analytics (Phalo input). */
  async recordView(storeId: string, userId?: string) {
    await this.prisma.analyticsEvent.create({
      data: { eventType: 'merchant_view', storeId, userId: userId ?? null },
    });
    return { recorded: true };
  }
}
