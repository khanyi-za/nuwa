import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'buyer-1';
const PRODUCT_ID = 'prod-1';
const ITEM_ID = 'wish-1';

const productRow = {
  id: PRODUCT_ID,
  title: 'Jacaranda Throw',
  slug: 'jacaranda-throw',
  priceInCents: 45_000,
  status: ProductStatus.ACTIVE,
  store: { displayName: 'Jacaranda Studio', slug: 'jacaranda-studio' },
  images: [{ url: 'https://cdn.example/thumb.jpg' }],
};

const wishlistItemRow = {
  id: ITEM_ID,
  userId: USER_ID,
  productId: PRODUCT_ID,
  createdAt: new Date('2026-04-20'),
  product: productRow,
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma = {
  wishlistItem: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('WishlistService', () => {
  let service: WishlistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishlistService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WishlistService>(WishlistService);
    jest.clearAllMocks();
  });

  // ─── list ───────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns wishlist items with product details', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([wishlistItemRow]);
      mockPrisma.wishlistItem.count.mockResolvedValue(1);

      const result = await service.list(USER_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: ITEM_ID,
        productId: PRODUCT_ID,
        productTitle: 'Jacaranda Throw',
        storeName: 'Jacaranda Studio',
        priceInCents: 45_000,
        isAvailable: true,
      });
      expect(result.totalCount).toBe(1);
      expect(result.nextCursor).toBeNull();
    });

    it('marks unavailable products', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        {
          ...wishlistItemRow,
          product: { ...productRow, status: ProductStatus.ARCHIVED },
        },
      ]);
      mockPrisma.wishlistItem.count.mockResolvedValue(1);

      const result = await service.list(USER_ID);

      expect(result.items[0].isAvailable).toBe(false);
    });

    it('returns empty list when wishlist is empty', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([]);
      mockPrisma.wishlistItem.count.mockResolvedValue(0);

      const result = await service.list(USER_ID);

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it('returns nextCursor when there are more pages', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...wishlistItemRow,
        id: `wish-${i}`,
      }));
      mockPrisma.wishlistItem.findMany.mockResolvedValue(items);
      mockPrisma.wishlistItem.count.mockResolvedValue(25);

      const result = await service.list(USER_ID);

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBe('wish-19');
      expect(result.totalCount).toBe(25);
    });

    it('handles product with no images', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        {
          ...wishlistItemRow,
          product: { ...productRow, images: [] },
        },
      ]);
      mockPrisma.wishlistItem.count.mockResolvedValue(1);

      const result = await service.list(USER_ID);

      expect(result.items[0].productImageUrl).toBeNull();
    });
  });

  // ─── add ────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('adds a product to the wishlist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        status: ProductStatus.ACTIVE,
      });
      mockPrisma.wishlistItem.create.mockResolvedValue({ id: ITEM_ID });

      const result = await service.add(USER_ID, PRODUCT_ID);

      expect(result.id).toBe(ITEM_ID);
      expect(mockPrisma.wishlistItem.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, productId: PRODUCT_ID },
        select: { id: true },
      });
    });

    it('throws 404 when product does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.add(USER_ID, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when product is not ACTIVE', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        status: ProductStatus.ARCHIVED,
      });

      await expect(
        service.add(USER_ID, PRODUCT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when product is already in wishlist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        status: ProductStatus.ACTIVE,
      });
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.0.0' },
      );
      mockPrisma.wishlistItem.create.mockRejectedValue(p2002);

      await expect(
        service.add(USER_ID, PRODUCT_ID),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── remove ─────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes a wishlist item', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue({
        id: ITEM_ID,
        userId: USER_ID,
      });

      await service.remove(USER_ID, ITEM_ID);

      expect(mockPrisma.wishlistItem.delete).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
      });
    });

    it('throws 404 when item does not exist', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(USER_ID, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when item belongs to another user', async () => {
      mockPrisma.wishlistItem.findUnique.mockResolvedValue({
        id: ITEM_ID,
        userId: 'other-user',
      });

      await expect(
        service.remove(USER_ID, ITEM_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
