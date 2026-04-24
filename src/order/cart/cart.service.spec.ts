import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { CartService } from './cart.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as stock from './stock';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const CART_ID = 'cart-1';
const PRODUCT_ID = 'prod-1';
const VARIANT_ID = 'var-1';
const STORE_ID = 'store-1';

const baseProduct = {
  id: PRODUCT_ID,
  storeId: STORE_ID,
  title: 'Jacaranda Throw',
  slug: 'jacaranda-throw',
  status: ProductStatus.ACTIVE,
  priceInCents: 45_000,
  totalStock: 10,
  reservedStock: 2, // includes this buyer's own 2
  store: {
    id: STORE_ID,
    displayName: 'Jacaranda Studio',
    slug: 'jacaranda-studio',
  },
  images: [{ url: 'https://cdn.example/thumb.jpg', sortOrder: 0 }],
};

const baseItem = {
  id: 'item-1',
  cartId: CART_ID,
  productId: PRODUCT_ID,
  variantId: null as string | null,
  quantity: 2,
  createdAt: new Date('2026-04-16T00:00:00Z'),
  updatedAt: new Date('2026-04-16T00:00:00Z'),
  product: baseProduct,
  variant: null as null | {
    id: string;
    name: string;
    priceInCents: number | null;
    stock: number;
    reservedStock: number;
  },
};

// ─── Prisma mock ────────────────────────────────────────────────────────────

const mockPrisma = {
  cart: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  cartItem: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn((fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  ),
};

// Mock the stock module so we can assert call shape without exercising raw SQL.
jest.mock('./stock', () => ({
  reserveStock: jest.fn(),
  releaseStock: jest.fn(),
}));

const reserveStockMock = stock.reserveStock as jest.Mock;
const releaseStockMock = stock.releaseStock as jest.Mock;

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('CartService', () => {
  let service: CartService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CartService>(CartService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns an empty grouped shape when the user has no cart row', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      const result = await service.get(USER_ID);

      expect(result).toEqual({
        stores: [],
        grandSubtotalInCents: 0,
        itemCount: 0,
      });
    });

    it('groups items by store and computes per-store + grand subtotals', async () => {
      const otherStoreItem = {
        ...baseItem,
        id: 'item-2',
        productId: 'prod-2',
        quantity: 1,
        product: {
          ...baseProduct,
          id: 'prod-2',
          storeId: 'store-2',
          title: 'Karoo Candle',
          slug: 'karoo-candle',
          priceInCents: 12_000,
          store: {
            id: 'store-2',
            displayName: 'Karoo Co.',
            slug: 'karoo-co',
          },
        },
      };

      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [baseItem, otherStoreItem],
      });

      const result = await service.get(USER_ID);

      expect(result.stores).toHaveLength(2);
      expect(result.stores[0]).toMatchObject({
        storeId: STORE_ID,
        storeName: 'Jacaranda Studio',
        subtotalInCents: 90_000, // 45000 × 2
      });
      expect(result.stores[1]).toMatchObject({
        storeId: 'store-2',
        storeName: 'Karoo Co.',
        subtotalInCents: 12_000,
      });
      expect(result.grandSubtotalInCents).toBe(102_000);
      expect(result.itemCount).toBe(3);
    });

    it('flags items as "unavailable" when product status is not ACTIVE', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            product: { ...baseProduct, status: ProductStatus.ARCHIVED },
          },
        ],
      });

      const result = await service.get(USER_ID);
      expect(result.stores[0].items[0].status).toBe('unavailable');
    });

    it('flags items as "partial_stock" when capacity was reduced below reservations', async () => {
      // totalStock = 1, reservedStock = 2 (admin cut stock below reservations)
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            quantity: 2,
            product: {
              ...baseProduct,
              totalStock: 1,
              reservedStock: 2,
            },
          },
        ],
      });

      const result = await service.get(USER_ID);
      expect(result.stores[0].items[0].status).toBe('partial_stock');
      expect(result.stores[0].items[0].availableQuantity).toBe(1);
    });

    it('prefers variant price when a variant is attached', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            variantId: VARIANT_ID,
            variant: {
              id: VARIANT_ID,
              name: 'Large',
              priceInCents: 50_000,
              stock: 5,
              reservedStock: 2,
            },
          },
        ],
      });

      const result = await service.get(USER_ID);
      expect(result.stores[0].items[0].unitPriceInCents).toBe(50_000);
      expect(result.stores[0].items[0].lineTotalInCents).toBe(100_000);
    });

    it('falls back to product price when variant priceInCents is null', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            variantId: VARIANT_ID,
            variant: {
              id: VARIANT_ID,
              name: 'Small',
              priceInCents: null,
              stock: 5,
              reservedStock: 2,
            },
          },
        ],
      });

      const result = await service.get(USER_ID);
      expect(result.stores[0].items[0].unitPriceInCents).toBe(45_000);
    });
  });

  // ─── addItem ─────────────────────────────────────────────────────────────

  describe('addItem', () => {
    beforeEach(() => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        status: ProductStatus.ACTIVE,
      });
      mockPrisma.cart.upsert.mockResolvedValue({ id: CART_ID });
      mockPrisma.cart.findUnique.mockResolvedValue(null); // for get() reload
    });

    it('upserts the cart, reserves stock, and creates a new line when absent', async () => {
      mockPrisma.cartItem.findFirst.mockResolvedValue(null);

      await service.addItem(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 3,
      });

      expect(mockPrisma.cart.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        create: { userId: USER_ID },
        update: {},
        select: { id: true },
      });
      expect(reserveStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        3,
      );
      expect(mockPrisma.cartItem.findFirst).toHaveBeenCalledWith({
        where: { cartId: CART_ID, productId: PRODUCT_ID, variantId: null },
        select: { id: true },
      });
      expect(mockPrisma.cartItem.create).toHaveBeenCalledWith({
        data: {
          cartId: CART_ID,
          productId: PRODUCT_ID,
          variantId: null,
          quantity: 3,
        },
      });
      expect(mockPrisma.cartItem.update).not.toHaveBeenCalled();
    });

    it('increments quantity when the same (product, variant) line already exists', async () => {
      mockPrisma.cartItem.findFirst.mockResolvedValue({ id: 'item-1' });

      await service.addItem(USER_ID, {
        productId: PRODUCT_ID,
        quantity: 2,
      });

      expect(reserveStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        2,
      );
      expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: { increment: 2 } },
      });
      expect(mockPrisma.cartItem.create).not.toHaveBeenCalled();
    });

    it('validates the variant belongs to the product', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: VARIANT_ID,
        productId: 'some-other-product',
      });

      await expect(
        service.addItem(USER_ID, {
          productId: PRODUCT_ID,
          variantId: VARIANT_ID,
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(reserveStockMock).not.toHaveBeenCalled();
    });

    it('throws 404 when the product is not ACTIVE', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        status: ProductStatus.ARCHIVED,
      });

      await expect(
        service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(reserveStockMock).not.toHaveBeenCalled();
    });

    it('throws 404 when the product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates 409 from reserveStock when out of stock', async () => {
      reserveStockMock.mockRejectedValueOnce(
        new ConflictException('Out of stock'),
      );

      await expect(
        service.addItem(USER_ID, { productId: PRODUCT_ID, quantity: 99 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── updateItem ──────────────────────────────────────────────────────────

  describe('updateItem', () => {
    it('reserves the delta when quantity increases', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        quantity: 2,
        cart: { userId: USER_ID },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null); // for get() reload

      await service.updateItem(USER_ID, 'item-1', { quantity: 5 });

      expect(reserveStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        3,
      );
      expect(releaseStockMock).not.toHaveBeenCalled();
      expect(mockPrisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: 5 },
      });
    });

    it('releases the delta when quantity decreases', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        quantity: 5,
        cart: { userId: USER_ID },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.updateItem(USER_ID, 'item-1', { quantity: 2 });

      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        3,
      );
      expect(reserveStockMock).not.toHaveBeenCalled();
    });

    it('skips stock movement when quantity is unchanged', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        quantity: 2,
        cart: { userId: USER_ID },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.updateItem(USER_ID, 'item-1', { quantity: 2 });

      expect(reserveStockMock).not.toHaveBeenCalled();
      expect(releaseStockMock).not.toHaveBeenCalled();
      expect(mockPrisma.cartItem.update).toHaveBeenCalled();
    });

    it('routes stock movement to the variant when variantId is set', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        variantId: VARIANT_ID,
        quantity: 1,
        cart: { userId: USER_ID },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.updateItem(USER_ID, 'item-1', { quantity: 3 });

      expect(reserveStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        VARIANT_ID,
        2,
      );
    });

    it('throws 404 when the item belongs to another user', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        cart: { userId: 'someone-else' },
      });

      await expect(
        service.updateItem(USER_ID, 'item-1', { quantity: 3 }),
      ).rejects.toThrow(NotFoundException);
      expect(reserveStockMock).not.toHaveBeenCalled();
    });

    it('throws 404 when the item does not exist', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue(null);

      await expect(
        service.updateItem(USER_ID, 'ghost-item', { quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── removeItem ──────────────────────────────────────────────────────────

  describe('removeItem', () => {
    it('releases the full line quantity and deletes the row', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        quantity: 4,
        cart: { userId: USER_ID },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.removeItem(USER_ID, 'item-1');

      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        4,
      );
      expect(mockPrisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'item-1' },
      });
    });

    it('throws 404 when the item does not belong to the caller', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        ...baseItem,
        cart: { userId: 'someone-else' },
      });

      await expect(service.removeItem(USER_ID, 'item-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(releaseStockMock).not.toHaveBeenCalled();
      expect(mockPrisma.cartItem.delete).not.toHaveBeenCalled();
    });
  });

  // ─── clear ───────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('releases stock per line and deletes all items in one transaction', async () => {
      const cartRow = {
        id: CART_ID,
        userId: USER_ID,
        items: [
          { ...baseItem, quantity: 2 },
          {
            ...baseItem,
            id: 'item-2',
            variantId: VARIANT_ID,
            productId: 'prod-2',
            quantity: 3,
          },
        ],
      };
      // First call for `clear`, second null for the subsequent `get` reload.
      mockPrisma.cart.findUnique
        .mockResolvedValueOnce(cartRow)
        .mockResolvedValueOnce(null);

      await service.clear(USER_ID);

      expect(releaseStockMock).toHaveBeenCalledTimes(2);
      expect(releaseStockMock).toHaveBeenNthCalledWith(
        1,
        mockPrisma,
        PRODUCT_ID,
        null,
        2,
      );
      expect(releaseStockMock).toHaveBeenNthCalledWith(
        2,
        mockPrisma,
        'prod-2',
        VARIANT_ID,
        3,
      );
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: CART_ID },
      });
    });

    it('is a no-op when the user has no cart row', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.clear(USER_ID);

      expect(releaseStockMock).not.toHaveBeenCalled();
      expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('is a no-op when the cart is empty', async () => {
      mockPrisma.cart.findUnique
        .mockResolvedValueOnce({ id: CART_ID, userId: USER_ID, items: [] })
        .mockResolvedValueOnce(null);

      await service.clear(USER_ID);

      expect(releaseStockMock).not.toHaveBeenCalled();
      expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── Phase 10 gap tests ────────────────────────────────────────────────

  describe('buildItemView — availability edge cases', () => {
    it('returns availableQuantity 0 when totalCapacity is 0', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            quantity: 2,
            product: {
              ...baseProduct,
              totalStock: 0,
              reservedStock: 2,
            },
          },
        ],
      });

      const result = await service.get(USER_ID);

      expect(result.stores[0].items[0].availableQuantity).toBe(0);
      expect(result.stores[0].items[0].status).toBe('partial_stock');
    });

    it('caps availableQuantity at item.quantity when stock is abundant', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            quantity: 2,
            product: {
              ...baseProduct,
              totalStock: 100,
              reservedStock: 2, // only this buyer's reservation
            },
          },
        ],
      });

      const result = await service.get(USER_ID);

      // availableQuantity should be capped at the item's quantity, not totalCapacity.
      expect(result.stores[0].items[0].availableQuantity).toBe(2);
      expect(result.stores[0].items[0].status).toBe('available');
    });

    it('computes availability correctly with variant stock', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: CART_ID,
        userId: USER_ID,
        items: [
          {
            ...baseItem,
            variantId: VARIANT_ID,
            quantity: 3,
            variant: {
              id: VARIANT_ID,
              name: 'Large',
              priceInCents: 50_000,
              stock: 5,         // totalCapacity
              reservedStock: 4, // 3 this buyer + 1 other
            },
          },
        ],
      });

      const result = await service.get(USER_ID);

      // otherReservations = max(0, 4 - 3) = 1
      // availableQuantity = max(0, min(3, 5 - 1)) = max(0, min(3, 4)) = 3
      expect(result.stores[0].items[0].availableQuantity).toBe(3);
      expect(result.stores[0].items[0].status).toBe('available');
    });
  });
});
