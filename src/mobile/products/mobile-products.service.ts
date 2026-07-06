import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { genderFilterValues } from '../common/gender';
import type { GenderParam } from '../common/gender';
import { decodeCursor, encodeCursor } from '../common/cursor';
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
   */
  async feed(dto: FeedQueryDto, userId?: string) {
    const where = baseProductWhere(dto.genderType);
    if (dto.category) {
      where.categories = {
        some: { categoryId: { in: await this.resolveCategoryIds(dto.category) } },
      };
    }
    return this.queryFeedPage(
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
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { store: { displayName: { contains: q, mode: 'insensitive' } } },
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

  /** GET /api/search/category — products whose category name/slug matches. */
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
    return this.queryFeedPage(where, opts, userId);
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
    const categories = await this.distinctStoreCategories(store.id);
    return new Paginated(
      { products: page.data.products, categories },
      page.pagination,
    );
  }

  private async distinctStoreCategories(storeId: string): Promise<string[]> {
    const cats = await this.prisma.category.findMany({
      where: {
        products: { some: { product: { storeId, status: ProductStatus.ACTIVE } } },
      },
      select: { slug: true },
      orderBy: { name: 'asc' },
    });
    return cats.map((c) => c.slug);
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
    const where: Prisma.ProductWhereInput = {
      ...baseProductWhere(opts.genderType),
      store: {
        status: StoreStatus.ACTIVE,
        OR: [
          { displayName: { contains: opts.merchantName, mode: 'insensitive' } },
          { slug: { contains: opts.merchantName, mode: 'insensitive' } },
        ],
      },
    };
    return this.queryFeedPage(where, opts, userId);
  }

  /**
   * "Smart dynamic" new-arrivals carousel. v1 heuristic = most recent ACTIVE
   * products in the requested gender; the future Phalo engine replaces the
   * ranking without changing this shape (see phalo-smart-engine memory).
   */
  async newArrivals(dto: NewArrivalsQueryDto) {
    const limit = dto.limit ?? 6;

    const rows = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.ACTIVE,
        store: { status: StoreStatus.ACTIVE },
        genderType: { in: genderFilterValues(dto.genderType) },
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
   * "Smart dynamic" similar-items carousel. v1 heuristic = recent ACTIVE
   * products in the same gender, excluding the source (Phalo replaces later).
   */
  async similar(productId: string, limit: number) {
    const base = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, genderType: true, status: true },
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
        ...(base.genderType ? { genderType: base.genderType } : {}),
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
