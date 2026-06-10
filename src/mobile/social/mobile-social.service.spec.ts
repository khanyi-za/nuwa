import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileSocialService } from './mobile-social.service';

const USER_ID = 'user-1';

const mockPrisma = {
  product: { findUnique: jest.fn() },
  wishlistItem: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
  store: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  storeFollower: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

function wishlistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    createdAt: new Date('2026-06-03T14:20:00.000Z'),
    product: {
      id: 'p1',
      title: 'Mosadi Kimono',
      priceInCents: 89900,
      genderType: 'WOMEN',
      status: 'ACTIVE',
      totalStock: 5,
      reservedStock: 0,
      images: [{ url: 'https://cdn.yiiva.co.za/p1.jpg' }],
      categories: [{ category: { slug: 'outerwear', name: 'Outerwear' } }],
      store: {
        id: 's1',
        slug: 'tol_thema',
        displayName: "Tol'thema",
        logoUrl: 'https://cdn.yiiva.co.za/logo.png',
      },
      variants: [],
      ...overrides,
    },
  };
}

describe('MobileSocialService', () => {
  let service: MobileSocialService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileSocialService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileSocialService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  describe('setBookmark', () => {
    it('upserts a wishlist item when bookmarking an existing product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1' });
      mockPrisma.wishlistItem.upsert.mockResolvedValue({});

      expect(await service.setBookmark(USER_ID, 'p1', true)).toEqual({
        bookmarked: true,
      });
      expect(mockPrisma.wishlistItem.upsert).toHaveBeenCalled();
    });

    it('throws 404 PRODUCT_NOT_FOUND when bookmarking an unknown product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.setBookmark(USER_ID, 'nope', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the bookmark idempotently (no product lookup)', async () => {
      mockPrisma.wishlistItem.deleteMany.mockResolvedValue({ count: 1 });

      expect(await service.setBookmark(USER_ID, 'p1', false)).toEqual({
        bookmarked: false,
      });
      expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('setFollow', () => {
    it('follows an active store and increments followerCount', async () => {
      mockPrisma.store.findFirst.mockResolvedValue({
        id: 's1',
        ownerId: 'owner-2',
        followerCount: 10,
      });
      mockPrisma.storeFollower.findUnique.mockResolvedValue(null);

      const result = await service.setFollow(USER_ID, 's1', true);

      expect(result).toEqual({ following: true, followerCount: 11 });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('is a no-op when already following (no increment)', async () => {
      mockPrisma.store.findFirst.mockResolvedValue({
        id: 's1',
        ownerId: 'owner-2',
        followerCount: 10,
      });
      mockPrisma.storeFollower.findUnique.mockResolvedValue({ id: 'f1' });

      const result = await service.setFollow(USER_ID, 's1', true);

      expect(result).toEqual({ following: true, followerCount: 10 });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 409 CANNOT_FOLLOW_SELF when following own store', async () => {
      mockPrisma.store.findFirst.mockResolvedValue({
        id: 's1',
        ownerId: USER_ID,
        followerCount: 10,
      });
      await expect(service.setFollow(USER_ID, 's1', true)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 404 MERCHANT_NOT_FOUND when the store is not active', async () => {
      mockPrisma.store.findFirst.mockResolvedValue(null);
      await expect(service.setFollow(USER_ID, 's1', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('unfollows and decrements when currently following', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 's1',
        followerCount: 10,
      });
      mockPrisma.storeFollower.findUnique.mockResolvedValue({ id: 'f1' });

      const result = await service.setFollow(USER_ID, 's1', false);

      expect(result).toEqual({ following: false, followerCount: 9 });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('unfollow is a no-op when not following', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 's1',
        followerCount: 10,
      });
      mockPrisma.storeFollower.findUnique.mockResolvedValue(null);

      const result = await service.setFollow(USER_ID, 's1', false);

      expect(result).toEqual({ following: false, followerCount: 10 });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listBookmarks', () => {
    it('maps WishlistItems to bookmark wrappers (available, isBookmarkedByMe)', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([wishlistRow()]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([]);

      const result = await service.listBookmarks(USER_ID, { limit: 20 });

      const bm = (result.data as any).bookmarks[0];
      expect(bm).toMatchObject({ priceChanged: false, priceAtBookmark: 89900 });
      expect(bm.product).toMatchObject({
        name: 'Mosadi Kimono',
        available: true,
        isBookmarkedByMe: true,
        isLikedByMe: false,
      });
      expect(result.pagination.hasMore).toBe(false);
    });

    it('keeps inactive products but marks them unavailable (WL-11)', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        wishlistRow({ status: 'ARCHIVED', totalStock: 0 }),
      ]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([]);

      const result = await service.listBookmarks(USER_ID, { limit: 20 });
      expect((result.data as any).bookmarks[0].product.available).toBe(false);
    });

    it('sets nextCursor + hasMore when an extra row is returned', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([
        wishlistRow(),
        { ...wishlistRow(), id: 'w2' },
      ]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([]);

      const result = await service.listBookmarks(USER_ID, { limit: 1 });
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe(
        Buffer.from('w1', 'utf8').toString('base64url'),
      );
    });
  });
});
