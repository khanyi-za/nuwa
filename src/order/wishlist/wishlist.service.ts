import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// ─── Response shapes ───────────────────────────────────────────────────────

export interface WishlistItemView {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  productImageUrl: string | null;
  priceInCents: number;
  storeName: string;
  storeSlug: string;
  isAvailable: boolean;
  addedAt: Date;
}

export interface PaginatedWishlist {
  items: WishlistItemView[];
  nextCursor: string | null;
  totalCount: number;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the buyer's wishlist with product details, cursor pagination.
   */
  async list(
    userId: string,
    cursor?: string,
    take?: string,
  ): Promise<PaginatedWishlist> {
    const pageSize = Math.min(
      parseInt(take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const [items, totalCount] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: pageSize + 1,
        ...(cursor && {
          cursor: { id: cursor },
          skip: 1,
        }),
        include: {
          product: {
            select: {
              id: true,
              title: true,
              slug: true,
              priceInCents: true,
              status: true,
              store: {
                select: { displayName: true, slug: true },
              },
              images: {
                orderBy: { sortOrder: 'asc' as const },
                take: 1,
                select: { url: true },
              },
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where: { userId } }),
    ]);

    const hasMore = items.length > pageSize;
    const page = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      items: page.map((item) => ({
        id: item.id,
        productId: item.product.id,
        productTitle: item.product.title,
        productSlug: item.product.slug,
        productImageUrl: item.product.images[0]?.url ?? null,
        priceInCents: item.product.priceInCents,
        storeName: item.product.store.displayName,
        storeSlug: item.product.store.slug,
        isAvailable: item.product.status === ProductStatus.ACTIVE,
        addedAt: item.createdAt,
      })),
      nextCursor,
      totalCount,
    };
  }

  /**
   * Add a product to the buyer's wishlist. Idempotent — adding an
   * already-wishlisted product returns 409.
   */
  async add(
    userId: string,
    productId: string,
  ): Promise<{ id: string }> {
    // Validate product exists and is active.
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });

    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found');
    }

    try {
      const item = await this.prisma.wishlistItem.create({
        data: { userId, productId },
        select: { id: true },
      });
      return item;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Product is already in your wishlist');
      }
      throw err;
    }
  }

  /**
   * Remove a product from the buyer's wishlist.
   */
  async remove(userId: string, itemId: string): Promise<void> {
    const item = await this.prisma.wishlistItem.findUnique({
      where: { id: itemId },
      select: { id: true, userId: true },
    });

    if (!item || item.userId !== userId) {
      throw new NotFoundException('Wishlist item not found');
    }

    await this.prisma.wishlistItem.delete({
      where: { id: itemId },
    });
  }
}
