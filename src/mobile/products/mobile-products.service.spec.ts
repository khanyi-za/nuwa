import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GenderType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileProductsService } from './mobile-products.service';
import { Paginated } from '../common/paginated';

const USER_ID = 'user-1';

const feedRow = {
  id: 'p1',
  title: 'Mosadi Kimono',
  priceInCents: 89900,
  genderType: GenderType.WOMEN,
  images: [{ url: 'https://cdn.yiiva.co.za/p1.jpg' }],
  categories: [{ category: { slug: 'outerwear', name: 'Outerwear' } }],
  store: {
    id: 's1',
    slug: 'tol_thema',
    displayName: "Tol'thema",
    logoUrl: 'https://cdn.yiiva.co.za/logo.png',
  },
};

const detailRow = {
  id: 'p1',
  title: 'Mosadi Kimono',
  description: 'A flowing kimono.',
  priceInCents: 89900,
  genderType: GenderType.WOMEN,
  status: 'ACTIVE',
  totalStock: 0,
  reservedStock: 0,
  images: [
    { url: 'https://cdn.yiiva.co.za/1.jpg', mediaType: 'IMAGE' },
    { url: 'https://cdn.yiiva.co.za/hero.mp4', mediaType: 'VIDEO' },
  ],
  variants: [
    { id: 'v1', name: 'XS', sku: 'K-XS', size: 'XS', stock: 3, reservedStock: 0 },
    { id: 'v2', name: 'S', sku: 'K-S', size: 'S', stock: 1, reservedStock: 1 },
  ],
  categories: [{ category: { slug: 'outerwear', name: 'Outerwear' } }],
  tags: [{ tag: { name: 'heritage' } }, { tag: { name: 'minimalist' } }],
  store: {
    id: 's1',
    slug: 'tol_thema',
    displayName: "Tol'thema",
    logoUrl: 'https://cdn.yiiva.co.za/logo.png',
    description: 'Heritage textiles.',
    status: 'ACTIVE',
  },
};

const mockPrisma = {
  product: { findMany: jest.fn(), findUnique: jest.fn() },
  wishlistItem: { findMany: jest.fn(), findUnique: jest.fn() },
  storeFollower: { findMany: jest.fn(), findUnique: jest.fn() },
  category: { findUnique: jest.fn(), findMany: jest.fn() },
  store: { findUnique: jest.fn() },
  analyticsEvent: { create: jest.fn() },
};

describe('MobileProductsService', () => {
  let service: MobileProductsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileProductsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileProductsService);
    jest.clearAllMocks();
  });

  describe('feed', () => {
    it('maps rows to feed-card shape and omits personalised fields for guests', async () => {
      mockPrisma.product.findMany.mockResolvedValue([feedRow]);

      const result = await service.feed({ genderType: 'women', limit: 20 });

      expect(result).toBeInstanceOf(Paginated);
      const product = (result.data as { products: any[] }).products[0];
      expect(product).toMatchObject({
        id: 'p1',
        name: 'Mosadi Kimono',
        price: 89900,
        currency: 'ZAR',
        primaryImage: 'https://cdn.yiiva.co.za/p1.jpg',
        category: 'outerwear',
        clothingType: 'Outerwear',
        genderType: 'women',
        merchant: { username: 'tol_thema', isVerified: true },
      });
      expect(product).not.toHaveProperty('isLikedByMe');
      expect(product).not.toHaveProperty('isBookmarkedByMe');
      expect(product.merchant).not.toHaveProperty('isFollowedByMe');
      expect(result.pagination).toEqual({
        limit: 20,
        nextCursor: null,
        hasMore: false,
      });
    });

    it('includes personalised flags for authenticated buyers', async () => {
      mockPrisma.product.findMany.mockResolvedValue([feedRow]);
      mockPrisma.wishlistItem.findMany.mockResolvedValue([{ productId: 'p1' }]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([]);

      const result = await service.feed({ genderType: 'women' }, USER_ID);

      const product = (result.data as { products: any[] }).products[0];
      expect(product.isLikedByMe).toBe(false);
      expect(product.isBookmarkedByMe).toBe(true);
      expect(product.merchant.isFollowedByMe).toBe(false);
    });

    it('sets hasMore + nextCursor when an extra row is returned', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        feedRow,
        { ...feedRow, id: 'p2' },
      ]);

      const result = await service.feed({ genderType: 'women', limit: 1 });

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe(
        Buffer.from('p1', 'utf8').toString('base64url'),
      );
      expect((result.data as { products: any[] }).products).toHaveLength(1);
    });

    it('UNISEX is included in the women feed filter', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.feed({ genderType: 'women' });
      const arg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(arg.where.genderType.in).toEqual([
        GenderType.WOMEN,
        GenderType.UNISEX,
      ]);
    });
  });

  describe('newArrivals', () => {
    it('maps rows to carousel shape', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'p9',
          title: 'Knit Golfer',
          priceInCents: 65000,
          images: [{ url: 'https://cdn.yiiva.co.za/p9.jpg' }],
          store: { displayName: 'SUHU' },
        },
      ]);

      const { products } = await service.newArrivals({
        genderType: 'men',
        limit: 6,
      });

      expect(products[0]).toEqual({
        id: 'p9',
        name: 'Knit Golfer',
        price: 65000,
        currency: 'ZAR',
        image: 'https://cdn.yiiva.co.za/p9.jpg',
        merchant: { displayName: 'SUHU' },
      });
    });
  });

  describe('detail', () => {
    it('maps the full detail shape and omits inventoryType/personalised for guests', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(detailRow);

      const { product } = await service.detail('p1');

      expect(product).toMatchObject({
        id: 'p1',
        name: 'Mosadi Kimono',
        price: 89900,
        category: 'outerwear',
        clothingType: 'Outerwear',
        genderType: 'women',
        smartCategories: ['heritage', 'minimalist'],
        stock: { available: true },
        merchant: { username: 'tol_thema', bio: 'Heritage textiles.' },
      });
      expect(product.variants).toEqual([
        { id: 'v1', size: 'XS', sku: 'K-XS', available: true, stockCount: 3 },
        { id: 'v2', size: 'S', sku: 'K-S', available: false, stockCount: 0 },
      ]);
      expect(product.media).toEqual([
        { type: 'image', url: 'https://cdn.yiiva.co.za/1.jpg' },
        { type: 'video', url: 'https://cdn.yiiva.co.za/hero.mp4' },
      ]);
      expect(product).not.toHaveProperty('inventoryType');
      expect(product).not.toHaveProperty('isBookmarkedByMe');
      expect(product.merchant).not.toHaveProperty('isFollowedByMe');
    });

    it('includes personalised fields for authenticated buyers', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(detailRow);
      mockPrisma.wishlistItem.findUnique.mockResolvedValue({ id: 'w1' });
      mockPrisma.storeFollower.findUnique.mockResolvedValue(null);

      const { product } = await service.detail('p1', 'user-1');

      expect(product.isLikedByMe).toBe(false);
      expect(product.isBookmarkedByMe).toBe(true);
      expect(product.likeCount).toBe(0);
      expect(product.merchant.isFollowedByMe).toBe(false);
    });

    it('throws 404 when the product is missing or inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.detail('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('similar', () => {
    it('returns same-gender carousel items excluding the source', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        genderType: GenderType.WOMEN,
        status: 'ACTIVE',
      });
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'p2',
          title: 'Lufuno Set',
          priceInCents: 120000,
          images: [{ url: 'https://cdn.yiiva.co.za/p2.jpg' }],
          store: { displayName: "Tol'thema" },
        },
      ]);

      const { products } = await service.similar('p1', 6);

      expect(products[0].id).toBe('p2');
      const arg = mockPrisma.product.findMany.mock.calls[0][0];
      expect(arg.where.id).toEqual({ not: 'p1' });
      expect(arg.where.genderType).toBe(GenderType.WOMEN);
    });

    it('throws 404 when the base product is missing', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);
      await expect(service.similar('nope', 6)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recordView', () => {
    it('writes a product_view AnalyticsEvent', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});

      expect(await service.recordView('p1', 'user-1')).toEqual({
        recorded: true,
      });
      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: { eventType: 'product_view', productId: 'p1', userId: 'user-1' },
      });
    });

    it('records anonymous views with null userId', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});
      await service.recordView('p1');
      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: { eventType: 'product_view', productId: 'p1', userId: null },
      });
    });
  });

  describe('search', () => {
    it('universal search ORs across title / merchant / category / tag', async () => {
      mockPrisma.product.findMany.mockResolvedValue([feedRow]);

      const result = await service.searchUniversal({
        q: 'kimono',
        genderType: 'women',
        limit: 20,
      });

      expect((result.data as { products: any[] }).products[0].name).toBe(
        'Mosadi Kimono',
      );
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(4);
      expect(where.genderType.in).toEqual([GenderType.WOMEN, GenderType.UNISEX]);
    });

    it('category search matches category name or slug', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.searchByCategory({ category: 'outerwear', limit: 20 });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.categories.some.category.OR).toHaveLength(2);
      expect(where.genderType).toBeUndefined(); // no gender passed
    });

    it('smart-category search matches a tag name', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.searchBySmartCategory({ smartCategory: 'heritage', limit: 20 });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.tags.some.tag.name.contains).toBe('heritage');
    });

    it('merchant search matches store name or slug', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.searchByMerchant({ merchantName: 'tol', limit: 20 });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.store.OR).toHaveLength(2);
    });
  });

  describe('merchantProducts', () => {
    it('returns the store catalogue + distinct category slugs', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      mockPrisma.product.findMany.mockResolvedValue([feedRow]);
      mockPrisma.category.findMany.mockResolvedValue([
        { slug: 'kimono' },
        { slug: 'shirt' },
      ]);

      const result = await service.merchantProducts('tol_thema', { limit: 20 });

      expect((result.data as any).products[0].name).toBe('Mosadi Kimono');
      expect((result.data as any).categories).toEqual(['kimono', 'shirt']);
      expect(mockPrisma.product.findMany.mock.calls[0][0].where.storeId).toBe(
        's1',
      );
    });

    it('filters by clothingType via category slug/name', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.category.findMany.mockResolvedValue([]);

      await service.merchantProducts('tol_thema', {
        clothingType: 'kimono',
        limit: 20,
      });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.categories.some.category.OR).toHaveLength(2);
    });

    it('404s a non-active store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 's1',
        status: 'SUSPENDED',
      });
      await expect(
        service.merchantProducts('x', { limit: 20 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
