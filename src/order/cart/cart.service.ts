import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from '../dto/add-cart-item.dto';
import { UpdateCartItemDto } from '../dto/update-cart-item.dto';
import { releaseStock, reserveStock } from './stock';

/**
 * Cart CRUD with soft stock reservation.
 *
 * Invariants (locked in Phase 3 decisions):
 *   - Server-side, one `Cart` per `userId`. Anonymous browsing uses a
 *     frontend `localStorage` stash; nothing hits this service until login.
 *   - Independent SKU model. Bare product (`variantId: null`) and each
 *     variant carry their own stock. `reserveStock` routes accordingly.
 *   - Duplicate add of the same (productId, variantId) pair increments
 *     quantity, backed by the `@@unique([cartId, productId, variantId])`
 *     constraint.
 *   - Stock races resolve via a single optimistic conditional UPDATE. If
 *     rows-affected is 0 → 409 "Out of stock"; no retry loop.
 *   - Reads never mutate. A product whose status flips to non-ACTIVE stays
 *     in the cart as an `"unavailable"` line; checkout enforces correctness.
 *   - `Cart` row is created lazily on first `POST /cart/items`. `GET /cart`
 *     on a cartless user returns an empty grouped shape, 200.
 *   - Ownership checks return 404-not-403 on cross-user access, matching
 *     Phase 2 address semantics.
 */

type CartItemView = {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  productSlug: string;
  variantName: string | null;
  thumbnailUrl: string | null;
  unitPriceInCents: number;
  quantity: number;
  lineTotalInCents: number;
  status: 'available' | 'unavailable' | 'partial_stock';
  availableQuantity: number;
};

type CartStoreView = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  items: CartItemView[];
  subtotalInCents: number;
};

export type CartView = {
  stores: CartStoreView[];
  grandSubtotalInCents: number;
  itemCount: number;
};

// Prisma query shape used by every cart-returning endpoint. Exported so the
// service and its tests share one source of truth.
const CART_INCLUDE = {
  items: {
    include: {
      product: {
        include: {
          store: true,
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        },
      },
      variant: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.CartInclude;

type CartWithItems = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;
type CartItemWithRelations = CartWithItems['items'][number];

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    return this.buildCartView(cart);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartView> {
    const { productId, variantId, quantity } = dto;

    // Resolve and validate product + variant *outside* the transaction so
    // malformed inputs 404/400 before we open one.
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not available');
    }

    if (variantId) {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { id: true, productId: true },
      });
      if (!variant || variant.productId !== productId) {
        throw new BadRequestException(
          'Variant does not belong to the given product',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });

      // Reserve first — if it fails, the create/update below is skipped
      // because the $executeRaw 0-rows result bubbles a 409 out of the tx.
      await reserveStock(tx, productId, variantId ?? null, quantity);

      // findFirst + create/update rather than upsert, because Prisma's
      // compound-unique input rejects `variantId: null` at the type level
      // (the `@@unique([cartId, productId, variantId])` treats variantId as
      // non-null in generated types). The bare-product uniqueness invariant
      // is enforced at the DB layer via a partial unique index — see
      // migration 20260416120000_cart_item_bare_product_unique.
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
          data: {
            cartId: cart.id,
            productId,
            variantId: variantId ?? null,
            quantity,
          },
        });
      }
    });

    return this.get(userId);
  }

  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartView> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.assertCartItemOwned(tx, userId, itemId);

      const delta = dto.quantity - item.quantity;
      if (delta > 0) {
        await reserveStock(tx, item.productId, item.variantId, delta);
      } else if (delta < 0) {
        await releaseStock(tx, item.productId, item.variantId, -delta);
      }
      // delta === 0 → no stock movement; still issue the update for idempotency.

      await tx.cartItem.update({
        where: { id: itemId },
        data: { quantity: dto.quantity },
      });
    });

    return this.get(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.assertCartItemOwned(tx, userId, itemId);
      await releaseStock(tx, item.productId, item.variantId, item.quantity);
      await tx.cartItem.delete({ where: { id: itemId } });
    });

    return this.get(userId);
  }

  async clear(userId: string): Promise<CartView> {
    await this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: { items: true },
      });

      if (!cart || cart.items.length === 0) {
        return;
      }

      for (const item of cart.items) {
        await releaseStock(tx, item.productId, item.variantId, item.quantity);
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

    return this.get(userId);
  }

  // ─── helpers ───────────────────────────────────────────────────────────

  /**
   * Ownership guard for item-level mutations. Returns 404 on every miss path
   * (not-found, wrong owner) to prevent enumeration. Called *inside* the
   * transaction so a concurrent delete can't be resurrected by a raced patch.
   */
  private async assertCartItemOwned(
    tx: Prisma.TransactionClient,
    userId: string,
    itemId: string,
  ) {
    const item = await tx.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: { select: { userId: true } } },
    });

    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }

    return item;
  }

  /**
   * Transform the raw cart (or null) into the grouped-by-store view the API
   * returns. Pure function of the input — no DB calls — so it's trivially
   * testable and used by every cart-returning endpoint.
   */
  private buildCartView(cart: CartWithItems | null): CartView {
    if (!cart || cart.items.length === 0) {
      return { stores: [], grandSubtotalInCents: 0, itemCount: 0 };
    }

    const storeMap = new Map<string, CartStoreView>();
    let grandSubtotalInCents = 0;
    let itemCount = 0;

    for (const item of cart.items) {
      const view = this.buildItemView(item);
      grandSubtotalInCents += view.lineTotalInCents;
      itemCount += view.quantity;

      const storeId = item.product.storeId;
      let storeView = storeMap.get(storeId);
      if (!storeView) {
        storeView = {
          storeId,
          storeName: item.product.store.displayName,
          storeSlug: item.product.store.slug,
          items: [],
          subtotalInCents: 0,
        };
        storeMap.set(storeId, storeView);
      }
      storeView.items.push(view);
      storeView.subtotalInCents += view.lineTotalInCents;
    }

    return {
      stores: [...storeMap.values()],
      grandSubtotalInCents,
      itemCount,
    };
  }

  private buildItemView(item: CartItemWithRelations): CartItemView {
    const unitPriceInCents =
      item.variant?.priceInCents ?? item.product.priceInCents;

    // How many units *this line* can actually ship. In the healthy case
    // (totalStock >= reservedStock) this equals item.quantity. If an admin
    // reduced totalStock below the sum of existing reservations, other
    // buyers' reservations take priority and this line's availability shrinks.
    const totalCapacity = item.variant
      ? item.variant.stock
      : item.product.totalStock;
    const totalReserved = item.variant
      ? item.variant.reservedStock
      : item.product.reservedStock;
    const otherReservations = Math.max(0, totalReserved - item.quantity);
    const availableQuantity = Math.max(
      0,
      Math.min(item.quantity, totalCapacity - otherReservations),
    );

    const productUnavailable = item.product.status !== ProductStatus.ACTIVE;
    const partial = availableQuantity < item.quantity;

    const status: CartItemView['status'] = productUnavailable
      ? 'unavailable'
      : partial
        ? 'partial_stock'
        : 'available';

    return {
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productTitle: item.product.title,
      productSlug: item.product.slug,
      variantName: item.variant?.name ?? null,
      thumbnailUrl: item.product.images[0]?.url ?? null,
      unitPriceInCents,
      quantity: item.quantity,
      lineTotalInCents: unitPriceInCents * item.quantity,
      status,
      availableQuantity,
    };
  }
}
