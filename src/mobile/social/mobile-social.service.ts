import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Paginated } from '../common/paginated';
import { toFeedProduct } from '../common/serializers';

/**
 * Server-backed social actions for the buyer app. Bookmark = WishlistItem,
 * follow = StoreFollower (maya vocabulary translation). Both PUT/DELETE are
 * idempotent per maya social.md §Idempotency. Likes are NOT here — they stay
 * local-only on maya for v1 (see phalo-smart-engine memory).
 */
@Injectable()
export class MobileSocialService {
  constructor(private readonly prisma: PrismaService) {}

  /** PUT/DELETE /api/products/{productId}/bookmark */
  async setBookmark(userId: string, productId: string, on: boolean) {
    if (on) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException({
          code: 'PRODUCT_NOT_FOUND',
          message: 'Product not found',
        });
      }
      await this.prisma.wishlistItem.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId },
        update: {},
      });
      return { bookmarked: true };
    }

    // DELETE is idempotent — no 404 if the bookmark (or product) is already gone.
    await this.prisma.wishlistItem.deleteMany({ where: { userId, productId } });
    return { bookmarked: false };
  }

  /**
   * GET /api/me/bookmarks — the buyer's wishlist (WishlistItem) as the maya
   * bookmark wrapper. Cursor-paginated on the WishlistItem id. Unavailable
   * (sold-out / inactive) products are kept with `available: false` (WL-11).
   * v1 sort = newest/oldest (createdAt); price/merchant sorts deferred.
   * `priceChanged` is always false — WishlistItem has no add-time price yet
   * (same v1 limitation as the cart).
   */
  async listBookmarks(
    userId: string,
    opts: { limit: number; cursor?: string; sort?: string },
  ) {
    const asc = opts.sort === 'oldest';
    const rows = await this.prisma.wishlistItem.findMany({
      where: { userId },
      orderBy: [
        { createdAt: asc ? 'asc' : 'desc' },
        { id: asc ? 'asc' : 'desc' },
      ],
      take: opts.limit + 1,
      ...(opts.cursor
        ? { cursor: { id: decodeCursor(opts.cursor) }, skip: 1 }
        : {}),
      select: {
        id: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            title: true,
            priceInCents: true,
            genderType: true,
            status: true,
            totalStock: true,
            reservedStock: true,
            images: {
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              take: 1,
              select: { url: true },
            },
            categories: {
              take: 1,
              select: { category: { select: { slug: true, name: true } } },
            },
            store: {
              select: { id: true, slug: true, displayName: true, logoUrl: true },
            },
            variants: { select: { stock: true, reservedStock: true } },
          },
        },
      },
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

    const storeIds = [...new Set(page.map((r) => r.product.store.id))];
    const follows =
      storeIds.length > 0
        ? await this.prisma.storeFollower.findMany({
            where: { userId, storeId: { in: storeIds } },
            select: { storeId: true },
          })
        : [];
    const followed = new Set(follows.map((f) => f.storeId));

    const bookmarks = page.map((r) => {
      const p = r.product;
      const available =
        p.status === ProductStatus.ACTIVE &&
        (p.variants.length > 0
          ? p.variants.some((v) => v.stock - v.reservedStock > 0)
          : p.totalStock - p.reservedStock > 0);
      return {
        bookmarkedAt: r.createdAt,
        priceChanged: false,
        priceAtBookmark: p.priceInCents,
        product: {
          ...toFeedProduct(p, {
            isLikedByMe: false,
            isBookmarkedByMe: true,
            isFollowedByMe: followed.has(p.store.id),
          }),
          available,
        },
      };
    });

    return new Paginated({ bookmarks }, { limit: opts.limit, nextCursor, hasMore });
  }

  /** PUT/DELETE /api/merchants/{merchantId}/follow — merchantId is the Store id. */
  async setFollow(userId: string, storeId: string, on: boolean) {
    if (on) {
      const store = await this.prisma.store.findFirst({
        where: { id: storeId, status: StoreStatus.ACTIVE },
        select: { id: true, ownerId: true, followerCount: true },
      });
      if (!store) {
        throw new NotFoundException({
          code: 'MERCHANT_NOT_FOUND',
          message: 'Merchant not found',
        });
      }
      if (store.ownerId === userId) {
        throw new ConflictException({
          code: 'CANNOT_FOLLOW_SELF',
          message: 'You cannot follow your own store',
        });
      }

      const existing = await this.prisma.storeFollower.findUnique({
        where: { userId_storeId: { userId, storeId } },
        select: { id: true },
      });
      if (existing) {
        return { following: true, followerCount: store.followerCount };
      }

      await this.prisma.$transaction([
        this.prisma.storeFollower.create({ data: { userId, storeId } }),
        this.prisma.store.update({
          where: { id: storeId },
          data: { followerCount: { increment: 1 } },
        }),
      ]);
      return { following: true, followerCount: store.followerCount + 1 };
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, followerCount: true },
    });
    if (!store) {
      throw new NotFoundException({
        code: 'MERCHANT_NOT_FOUND',
        message: 'Merchant not found',
      });
    }

    const existing = await this.prisma.storeFollower.findUnique({
      where: { userId_storeId: { userId, storeId } },
      select: { id: true },
    });
    if (!existing) {
      return { following: false, followerCount: store.followerCount };
    }

    await this.prisma.$transaction([
      this.prisma.storeFollower.delete({ where: { id: existing.id } }),
      this.prisma.store.update({
        where: { id: storeId },
        data: { followerCount: { decrement: 1 } },
      }),
    ]);
    return { following: false, followerCount: store.followerCount - 1 };
  }
}
