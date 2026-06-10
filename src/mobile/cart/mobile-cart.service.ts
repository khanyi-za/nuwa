import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { releaseStock, reserveStock } from '../../order/cart/stock';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

export interface CartSummary {
  itemCount: number;
  subtotal: number;
  currency: 'ZAR';
}

const EMPTY_SUMMARY: CartSummary = { itemCount: 0, subtotal: 0, currency: 'ZAR' };

// Full-cart query shape (maya cart.md §2 item fields).
const CART_SELECT = {
  id: true,
  items: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      productId: true,
      variantId: true,
      quantity: true,
      product: {
        select: {
          title: true,
          priceInCents: true,
          status: true,
          totalStock: true,
          reservedStock: true,
          images: {
            orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
            take: 1,
            select: { url: true },
          },
          store: { select: { id: true, slug: true, displayName: true } },
        },
      },
      variant: {
        select: {
          size: true,
          name: true,
          priceInCents: true,
          stock: true,
          reservedStock: true,
        },
      },
    },
  },
} satisfies Prisma.CartSelect;

type CartRow = Prisma.CartGetPayload<{ select: typeof CART_SELECT }>;
type CartItemRow = CartRow['items'][number];

@Injectable()
export class MobileCartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lightweight cart-badge summary. v1 supports the authenticated buyer's
   * server cart only. Guests have no server cart yet (X-Cart-Session deferred
   * to a later iteration) → empty summary. `itemCount` is total units.
   */
  async summary(userId?: string): Promise<CartSummary> {
    if (!userId) return EMPTY_SUMMARY;

    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: {
        items: {
          select: {
            quantity: true,
            product: { select: { priceInCents: true } },
            variant: { select: { priceInCents: true } },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) return EMPTY_SUMMARY;

    let itemCount = 0;
    let subtotal = 0;
    for (const item of cart.items) {
      const unit = item.variant?.priceInCents ?? item.product.priceInCents;
      itemCount += item.quantity;
      subtotal += unit * item.quantity;
    }
    return { itemCount, subtotal, currency: 'ZAR' };
  }

  /** GET /api/cart — full cart. Guests get the empty shape (no server cart). */
  async getCart(userId?: string) {
    if (!userId) return this.emptyCart();
    return this.fullCart(userId);
  }

  /**
   * Add an item to the authenticated buyer's cart and return the full cart.
   * Reuses the shared `reserveStock` primitive so stock semantics match the web
   * cart. Guest carts are deferred — guests get 401 → maya opens a login modal.
   */
  async addItem(userId: string, dto: AddCartItemDto) {
    const quantity = dto.quantity ?? 1;
    const { productId, variantId } = dto;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true, _count: { select: { variants: true } } },
    });
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'This product is no longer available',
      });
    }

    if (product._count.variants > 0 && !variantId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Please select a size',
      });
    }

    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { productId: true },
      });
      if (!variant || variant.productId !== productId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Variant does not belong to the given product',
        });
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const cart = await tx.cart.upsert({
          where: { userId },
          create: { userId },
          update: {},
          select: { id: true },
        });

        await reserveStock(tx, productId, variantId ?? null, quantity);

        const existing = await tx.cartItem.findFirst({
          where: { cartId: cart.id, productId, variantId: variantId ?? null },
          select: { id: true },
        });
        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: { increment: quantity } },
          });
        } else {
          await tx.cartItem.create({
            data: { cartId: cart.id, productId, variantId: variantId ?? null, quantity },
          });
        }
      });
    } catch (err) {
      throw this.mapStockConflict(err);
    }

    return this.fullCart(userId);
  }

  /** PATCH /api/cart/items/:itemId — change quantity (reserve/release delta). */
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const item = await this.assertOwned(tx, userId, itemId);
        const delta = dto.quantity - item.quantity;
        if (delta > 0) {
          await reserveStock(tx, item.productId, item.variantId, delta);
        } else if (delta < 0) {
          await releaseStock(tx, item.productId, item.variantId, -delta);
        }
        await tx.cartItem.update({
          where: { id: itemId },
          data: { quantity: dto.quantity },
        });
      });
    } catch (err) {
      throw this.mapStockConflict(err);
    }

    return this.fullCart(userId);
  }

  /** DELETE /api/cart/items/:itemId — remove a line, release its stock. */
  async removeItem(userId: string, itemId: string) {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.assertOwned(tx, userId, itemId);
      await releaseStock(tx, item.productId, item.variantId, item.quantity);
      await tx.cartItem.delete({ where: { id: itemId } });
    });

    return this.fullCart(userId);
  }

  /** DELETE /api/cart — clear all items, release their stock. */
  async clear(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: { items: true },
      });
      if (!cart || cart.items.length === 0) return;
      for (const item of cart.items) {
        await releaseStock(tx, item.productId, item.variantId, item.quantity);
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

    return this.fullCart(userId);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Full cart in maya's flat shape (cart.md §2). */
  async fullCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      select: CART_SELECT,
    });
    if (!cart || cart.items.length === 0) {
      return this.emptyCart(cart?.id ?? null);
    }

    let itemCount = 0;
    let subtotal = 0;
    const items = cart.items.map((it) => {
      const view = this.mapItem(it);
      itemCount += view.quantity;
      subtotal += view.lineTotal;
      return view;
    });

    return {
      cart: { id: cart.id, itemCount, subtotal, currency: 'ZAR', items },
    };
  }

  private mapItem(it: CartItemRow) {
    const unitPrice = it.variant?.priceInCents ?? it.product.priceInCents;
    const capacity = it.variant ? it.variant.stock : it.product.totalStock;
    const reserved = it.variant
      ? it.variant.reservedStock
      : it.product.reservedStock;
    // Stock other buyers hold; this line's own reservation is excluded so we can
    // tell whether the line can still be fulfilled at its current quantity.
    const otherReservations = Math.max(0, reserved - it.quantity);
    const lineAvailable = Math.max(
      0,
      Math.min(it.quantity, capacity - otherReservations),
    );

    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId,
      name: it.product.title,
      image: it.product.images[0]?.url ?? null,
      size: it.variant?.size ?? it.variant?.name ?? null,
      quantity: it.quantity,
      unitPrice,
      lineTotal: unitPrice * it.quantity,
      available:
        it.product.status === ProductStatus.ACTIVE &&
        lineAvailable >= it.quantity,
      stockCount: Math.max(0, capacity - reserved),
      // Add-time price isn't tracked on CartItem in v1, so drift can't be
      // detected — always false. Revisit with a CartItem.priceAtAddInCents field.
      priceChanged: false,
      merchant: {
        id: it.product.store.id,
        username: it.product.store.slug,
        displayName: it.product.store.displayName,
      },
    };
  }

  private emptyCart(id: string | null = null) {
    return {
      cart: { id, itemCount: 0, subtotal: 0, currency: 'ZAR', items: [] },
    };
  }

  /** Ownership guard — 404 on every miss (not-found or wrong owner). */
  private async assertOwned(
    tx: Prisma.TransactionClient,
    userId: string,
    itemId: string,
  ) {
    const item = await tx.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: { select: { userId: true } } },
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException({
        code: 'CART_ITEM_NOT_FOUND',
        message: 'Cart item not found',
      });
    }
    return item;
  }

  /** reserveStock throws ConflictException on a stock race → maya OUT_OF_STOCK. */
  private mapStockConflict(err: unknown): unknown {
    if (err instanceof ConflictException) {
      return new ConflictException({
        code: 'OUT_OF_STOCK',
        message: 'Sold out — please choose another size',
      });
    }
    return err;
  }
}
