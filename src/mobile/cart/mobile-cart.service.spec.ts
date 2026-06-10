import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileCartService } from './mobile-cart.service';
import { reserveStock, releaseStock } from '../../order/cart/stock';

jest.mock('../../order/cart/stock', () => ({
  reserveStock: jest.fn(),
  releaseStock: jest.fn(),
}));
const mockReserveStock = reserveStock as jest.Mock;
const mockReleaseStock = releaseStock as jest.Mock;

const mockPrisma = {
  cart: { findUnique: jest.fn(), upsert: jest.fn() },
  product: { findUnique: jest.fn() },
  productVariant: { findUnique: jest.fn() },
  cartItem: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const cartRow = {
  id: 'c1',
  items: [
    {
      id: 'ci1',
      productId: 'p1',
      variantId: 'v1',
      quantity: 1,
      product: {
        title: 'Mosadi Kimono',
        priceInCents: 89900,
        status: 'ACTIVE',
        totalStock: 0,
        reservedStock: 0,
        images: [{ url: 'https://cdn.yiiva.co.za/p1.jpg' }],
        store: { id: 's1', slug: 'tol_thema', displayName: "Tol'thema" },
      },
      variant: { size: 'S', name: 'S', priceInCents: null, stock: 5, reservedStock: 1 },
    },
  ],
};

describe('MobileCartService', () => {
  let service: MobileCartService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileCartService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileCartService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
    mockReserveStock.mockResolvedValue(undefined);
    mockReleaseStock.mockResolvedValue(undefined);
  });

  describe('summary', () => {
    it('returns an empty summary for guests without hitting the DB', async () => {
      const result = await service.summary(undefined);
      expect(result).toEqual({ itemCount: 0, subtotal: 0, currency: 'ZAR' });
      expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
    });

    it('returns an empty summary when the user has no cart', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(null);
      expect(await service.summary('user-1')).toEqual({
        itemCount: 0,
        subtotal: 0,
        currency: 'ZAR',
      });
    });

    it('sums units and applies variant price overrides', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        items: [
          { quantity: 2, product: { priceInCents: 10000 }, variant: null },
          {
            quantity: 1,
            product: { priceInCents: 10000 },
            variant: { priceInCents: 12500 },
          },
        ],
      });

      expect(await service.summary('user-1')).toEqual({
        itemCount: 3,
        subtotal: 32500,
        currency: 'ZAR',
      });
    });
  });

  describe('addItem', () => {
    it('reserves stock, creates the line, and returns the full cart', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
        _count: { variants: 2 },
      });
      mockPrisma.productVariant.findUnique.mockResolvedValue({ productId: 'p1' });
      mockPrisma.cart.upsert.mockResolvedValue({ id: 'c1' });
      mockPrisma.cartItem.findFirst.mockResolvedValue(null);
      mockPrisma.cart.findUnique.mockResolvedValue(cartRow);

      const result = await service.addItem('user-1', {
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
      });

      expect(mockReserveStock).toHaveBeenCalledWith(mockPrisma, 'p1', 'v1', 1);
      expect(mockPrisma.cartItem.create).toHaveBeenCalled();
      expect(result.cart).toMatchObject({
        id: 'c1',
        itemCount: 1,
        subtotal: 89900,
      });
      expect(result.cart.items[0]).toMatchObject({
        productId: 'p1',
        size: 'S',
        unitPrice: 89900,
        lineTotal: 89900,
        merchant: { username: 'tol_thema' },
      });
    });

    it('throws 400 when a variant is required but missing', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
        _count: { variants: 3 },
      });

      await expect(
        service.addItem('user-1', { productId: 'p1' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockReserveStock).not.toHaveBeenCalled();
    });

    it('throws 404 when the product is missing or inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(
        service.addItem('user-1', { productId: 'nope' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps a stock-reservation conflict to OUT_OF_STOCK', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
        _count: { variants: 0 },
      });
      mockPrisma.cart.upsert.mockResolvedValue({ id: 'c1' });
      mockReserveStock.mockRejectedValue(new ConflictException('stock race'));

      await expect(
        service.addItem('user-1', { productId: 'p1', quantity: 1 }),
      ).rejects.toMatchObject({
        response: { code: 'OUT_OF_STOCK' },
      });
    });
  });

  describe('fullCart', () => {
    it('returns an empty cart shape when there are no items', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(null);
      const { cart } = await service.fullCart('user-1');
      expect(cart).toEqual({
        id: null,
        itemCount: 0,
        subtotal: 0,
        currency: 'ZAR',
        items: [],
      });
    });

    it('enriches items with available / stockCount / priceChanged', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(cartRow);
      const { cart } = await service.fullCart('user-1');
      expect(cart.items[0]).toMatchObject({
        available: true,
        stockCount: 4, // variant stock 5 − reserved 1
        priceChanged: false,
      });
    });
  });

  describe('getCart', () => {
    it('returns the empty cart for guests without hitting the DB', async () => {
      const { cart } = await service.getCart(undefined);
      expect(cart.items).toEqual([]);
      expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
    });

    it('returns the full cart for authenticated buyers', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(cartRow);
      const { cart } = await service.getCart('user-1');
      expect(cart.itemCount).toBe(1);
    });
  });

  describe('updateItem', () => {
    it('reserves the delta when increasing quantity', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: 'ci1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
        cart: { userId: 'user-1' },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(cartRow);

      await service.updateItem('user-1', 'ci1', { quantity: 3 });

      expect(mockReserveStock).toHaveBeenCalledWith(mockPrisma, 'p1', 'v1', 2);
      expect(mockReleaseStock).not.toHaveBeenCalled();
    });

    it('releases the delta when decreasing quantity', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: 'ci1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 3,
        cart: { userId: 'user-1' },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(cartRow);

      await service.updateItem('user-1', 'ci1', { quantity: 1 });

      expect(mockReleaseStock).toHaveBeenCalledWith(mockPrisma, 'p1', 'v1', 2);
      expect(mockReserveStock).not.toHaveBeenCalled();
    });

    it('throws 404 when the item is not owned by the user', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: 'ci1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
        cart: { userId: 'someone-else' },
      });
      await expect(
        service.updateItem('user-1', 'ci1', { quantity: 2 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps a stock conflict to OUT_OF_STOCK', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: 'ci1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
        cart: { userId: 'user-1' },
      });
      mockReserveStock.mockRejectedValue(new ConflictException('race'));

      await expect(
        service.updateItem('user-1', 'ci1', { quantity: 9 }),
      ).rejects.toMatchObject({ response: { code: 'OUT_OF_STOCK' } });
    });
  });

  describe('removeItem', () => {
    it('releases stock and deletes the line', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue({
        id: 'ci1',
        productId: 'p1',
        variantId: 'v1',
        quantity: 2,
        cart: { userId: 'user-1' },
      });
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await service.removeItem('user-1', 'ci1');

      expect(mockReleaseStock).toHaveBeenCalledWith(mockPrisma, 'p1', 'v1', 2);
      expect(mockPrisma.cartItem.delete).toHaveBeenCalledWith({
        where: { id: 'ci1' },
      });
    });

    it('throws 404 for an unknown item', async () => {
      mockPrisma.cartItem.findUnique.mockResolvedValue(null);
      await expect(service.removeItem('user-1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('clear', () => {
    it('releases every line then empties the cart', async () => {
      mockPrisma.cart.findUnique
        .mockResolvedValueOnce({
          id: 'c1',
          items: [
            { productId: 'p1', variantId: 'v1', quantity: 2 },
            { productId: 'p2', variantId: null, quantity: 1 },
          ],
        })
        .mockResolvedValueOnce(null); // fullCart re-read after clear

      const { cart } = await service.clear('user-1');

      expect(mockReleaseStock).toHaveBeenCalledTimes(2);
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'c1' },
      });
      expect(cart.items).toEqual([]);
    });
  });
});
