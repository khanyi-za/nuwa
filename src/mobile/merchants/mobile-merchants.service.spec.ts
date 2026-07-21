import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GenderType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileMerchantsService } from './mobile-merchants.service';

const store = {
  id: 's1',
  slug: 'tol_thema',
  displayName: "Tol'thema",
  logoUrl: 'https://cdn.yiiva.co.za/logo.png',
  followerCount: 17201,
};

const profileStore = {
  id: 's1',
  slug: 'tol_thema',
  displayName: "Tol'thema",
  logoUrl: 'https://cdn.yiiva.co.za/logo.png',
  description: 'Heritage textiles.',
  status: 'ACTIVE',
  followerCount: 17201,
  contactEmail: 'hello@tolthema.co.za',
  bannerMedia: [
    { url: 'https://cdn.yiiva.co.za/hero1.mp4' },
    { url: 'https://cdn.yiiva.co.za/hero2.jpg' },
  ],
  addresses: [{ city: 'Cape Town' }],
};

const mockPrisma = {
  store: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  storeCollection: { findMany: jest.fn() },
  storeFollower: { findMany: jest.fn(), findUnique: jest.fn() },
  product: { count: jest.fn(), groupBy: jest.fn() },
  analyticsEvent: { create: jest.fn() },
  // Phalo trending ranking — default empty (heuristic fallback path).
  $queryRaw: jest.fn().mockResolvedValue([]),
};

describe('MobileMerchantsService', () => {
  let service: MobileMerchantsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileMerchantsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileMerchantsService);
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.storeCollection.findMany.mockResolvedValue([]);
  });

  it('returns trending merchants without isFollowedByMe for guests', async () => {
    mockPrisma.store.findMany.mockResolvedValue([store]);

    const { merchants } = await service.trending({ limit: 10 });

    expect(merchants[0]).toEqual({
      id: 's1',
      username: 'tol_thema',
      displayName: "Tol'thema",
      logo: 'https://cdn.yiiva.co.za/logo.png',
      followerCount: 17201,
      isVerified: true,
    });
    expect(merchants[0]).not.toHaveProperty('isFollowedByMe');
    expect(mockPrisma.storeFollower.findMany).not.toHaveBeenCalled();
  });

  it('resolves isFollowedByMe for authenticated buyers', async () => {
    mockPrisma.store.findMany.mockResolvedValue([store]);
    mockPrisma.storeFollower.findMany.mockResolvedValue([{ storeId: 's1' }]);

    const { merchants } = await service.trending({
      limit: 10,
      userId: 'user-1',
    });

    expect(merchants[0].isFollowedByMe).toBe(true);
  });

  it('orders by the Phalo ranking when fresh rows exist', async () => {
    const second = { ...store, id: 's2', slug: 'suhu', displayName: 'SUHU' };
    mockPrisma.$queryRaw.mockResolvedValue([
      { store_id: 's2' },
      { store_id: 's1' },
    ]);
    // findMany returns candidates in DB order; the ranking must win.
    mockPrisma.store.findMany.mockResolvedValue([store, second]);

    const { merchants } = await service.trending({ limit: 10 });

    expect(merchants.map((m) => m.id)).toEqual(['s2', 's1']);
    // Candidate fetch is constrained to the ranked ids.
    const arg = mockPrisma.store.findMany.mock.calls[0][0];
    expect(arg.where.id.in).toEqual(['s2', 's1']);
  });

  it('falls back to followerCount when the Phalo query throws (table absent)', async () => {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('relation does not exist'));
    mockPrisma.store.findMany.mockResolvedValue([store]);

    const { merchants } = await service.trending({ limit: 10 });

    expect(merchants[0].id).toBe('s1');
    const arg = mockPrisma.store.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ followerCount: 'desc' }, { id: 'desc' }]);
  });

  it('falls back when the gender filter eliminates every ranked store', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ store_id: 's9' }]);
    // Ranked candidate fetch finds nothing; fallback fetch finds the store.
    mockPrisma.store.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([store]);

    const { merchants } = await service.trending({ genderType: 'women', limit: 10 });

    expect(merchants[0].id).toBe('s1');
    expect(mockPrisma.store.findMany).toHaveBeenCalledTimes(2);
  });

  it('filters by gender (incl. UNISEX) when genderType is given', async () => {
    mockPrisma.store.findMany.mockResolvedValue([]);

    await service.trending({ genderType: 'men', limit: 10 });

    const arg = mockPrisma.store.findMany.mock.calls[0][0];
    expect(arg.where.products.some.genderType.in).toEqual([
      GenderType.MEN,
      GenderType.UNISEX,
    ]);
  });

  describe('trending — spotlight mode (FEED_SPOTLIGHT_STORE)', () => {
    const rail = (slugs: string[]) =>
      slugs.map((slug, i) => ({
        ...store,
        id: `s-${slug}`,
        slug,
        followerCount: 1000 - i,
      }));

    afterEach(() => {
      delete process.env.FEED_SPOTLIGHT_STORE;
    });

    it('injects an unranked spotlight brand at position 2, capped at limit', async () => {
      process.env.FEED_SPOTLIGHT_STORE = 'netterose';
      mockPrisma.store.findMany.mockResolvedValue(rail(['a', 'b', 'c', 'd']));
      mockPrisma.store.findFirst.mockResolvedValue({
        ...store,
        id: 's-spot',
        slug: 'netterose',
      });

      const { merchants } = await service.trending({ limit: 4 });

      expect(merchants.map((m) => m.username)).toEqual(['a', 'netterose', 'b', 'c']);
      // Injection respects the caller's where (ACTIVE + gender scope).
      expect(mockPrisma.store.findFirst.mock.calls[0][0].where.slug).toBe('netterose');
    });

    it('hoists an already-ranked spotlight brand without duplicating it', async () => {
      process.env.FEED_SPOTLIGHT_STORE = 'c';
      mockPrisma.store.findMany.mockResolvedValue(rail(['a', 'b', 'c', 'd']));

      const { merchants } = await service.trending({ limit: 4 });

      expect(merchants.map((m) => m.username)).toEqual(['a', 'c', 'b', 'd']);
      expect(mockPrisma.store.findFirst).not.toHaveBeenCalled();
    });

    it('skips injection when the gender filter excludes the brand', async () => {
      process.env.FEED_SPOTLIGHT_STORE = 'menswear-only';
      mockPrisma.store.findMany.mockResolvedValue(rail(['a', 'b']));
      mockPrisma.store.findFirst.mockResolvedValue(null);

      const { merchants } = await service.trending({ genderType: 'women', limit: 4 });

      expect(merchants.map((m) => m.username)).toEqual(['a', 'b']);
    });

    it('makes no extra queries when spotlight mode is off', async () => {
      mockPrisma.store.findMany.mockResolvedValue(rail(['a', 'b']));

      await service.trending({ limit: 4 });

      expect(mockPrisma.store.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('directory', () => {
    const dirStore = {
      id: 's1',
      slug: 'tol_thema',
      displayName: "Tol'thema",
      logoUrl: 'https://cdn.yiiva.co.za/logo.png',
      followerCount: 17201,
    };

    it('returns directory cards with productCount + lettersWithBrands', async () => {
      mockPrisma.store.findMany.mockResolvedValue([dirStore]);
      mockPrisma.product.groupBy.mockResolvedValue([
        { storeId: 's1', _count: { _all: 12 } },
      ]);

      const result = await service.directory({ limit: 100 });

      expect((result.data as any).merchants[0]).toEqual({
        id: 's1',
        username: 'tol_thema',
        displayName: "Tol'thema",
        logo: 'https://cdn.yiiva.co.za/logo.png',
        isVerified: true,
        followerCount: 17201,
        productCount: 12,
      });
      expect((result.data as any).lettersWithBrands).toEqual(['T']);
      expect((result.data as any).merchants[0]).not.toHaveProperty(
        'isFollowedByMe',
      );
    });

    it('filters by gender (incl. UNISEX)', async () => {
      mockPrisma.store.findMany.mockResolvedValue([]);
      mockPrisma.product.groupBy.mockResolvedValue([]);

      await service.directory({ genderType: 'women', limit: 100 });

      const where = mockPrisma.store.findMany.mock.calls[0][0].where;
      expect(where.products.some.genderType.in).toEqual([
        GenderType.WOMEN,
        GenderType.UNISEX,
      ]);
    });

    it('includes isFollowedByMe for authenticated buyers', async () => {
      mockPrisma.store.findMany.mockResolvedValue([dirStore]);
      mockPrisma.product.groupBy.mockResolvedValue([]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([{ storeId: 's1' }]);

      const result = await service.directory({ limit: 100 }, 'user-1');
      expect((result.data as any).merchants[0].isFollowedByMe).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('maps a store to the maya merchant profile (guest)', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(profileStore);
      mockPrisma.product.count.mockResolvedValue(42);

      const { merchant } = await service.getProfile('tol_thema');

      expect(merchant).toEqual({
        id: 's1',
        username: 'tol_thema',
        displayName: "Tol'thema",
        logo: 'https://cdn.yiiva.co.za/logo.png',
        heroMedia: [
          'https://cdn.yiiva.co.za/hero1.mp4',
          'https://cdn.yiiva.co.za/hero2.jpg',
        ],
        bio: 'Heritage textiles.',
        location: 'Cape Town',
        isVerified: true,
        status: 'ACTIVE',
        followerCount: 17201,
        followingCount: 0,
        postCount: 42,
        messagingEnabled: true,
        contact: { email: 'hello@tolthema.co.za' },
        collections: [],
      });
      expect(merchant).not.toHaveProperty('isFollowedByMe');
    });

    it('returns the merchant collections in sortOrder with ACTIVE counts', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(profileStore);
      mockPrisma.product.count.mockResolvedValue(42);
      mockPrisma.storeCollection.findMany.mockResolvedValue([
        {
          slug: 'new-in',
          name: 'New In',
          imageUrl: 'https://cdn.yiiva.co.za/new-in.jpg',
          products: [
            { product: { images: [{ url: 'https://cdn.yiiva.co.za/p1.jpg' }] } },
          ],
          _count: { products: 8 },
        },
        {
          slug: 'dresses',
          name: 'Dresses',
          imageUrl: null,
          products: [],
          _count: { products: 12 },
        },
      ]);

      const { merchant } = await service.getProfile('tol_thema');

      expect(merchant.collections).toEqual([
        {
          // Merchant-set cover wins over the product fallback.
          slug: 'new-in',
          name: 'New In',
          image: 'https://cdn.yiiva.co.za/new-in.jpg',
          productCount: 8,
        },
        { slug: 'dresses', name: 'Dresses', image: null, productCount: 12 },
      ]);
      // Only profile-visible collections with ≥1 ACTIVE product, in the
      // merchant's order.
      expect(mockPrisma.storeCollection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: 's1',
            showOnProfile: true,
            products: { some: { product: { status: 'ACTIVE' } } },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
      );
    });

    it('falls back to a product primary image when the collection has no cover', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(profileStore);
      mockPrisma.product.count.mockResolvedValue(42);
      mockPrisma.storeCollection.findMany.mockResolvedValue([
        {
          slug: 'kimono',
          name: 'Kimono',
          imageUrl: null,
          products: [
            { product: { images: [{ url: 'https://cdn.yiiva.co.za/kimono-1.jpg' }] } },
          ],
          _count: { products: 4 },
        },
      ]);

      const { merchant } = await service.getProfile('tol_thema');

      expect(merchant.collections).toEqual([
        {
          slug: 'kimono',
          name: 'Kimono',
          image: 'https://cdn.yiiva.co.za/kimono-1.jpg',
          productCount: 4,
        },
      ]);
    });

    it('includes isFollowedByMe for authenticated buyers', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(profileStore);
      mockPrisma.product.count.mockResolvedValue(42);
      mockPrisma.storeFollower.findUnique.mockResolvedValue({ id: 'f1' });

      const { merchant } = await service.getProfile('tol_thema', 'user-1');
      expect(merchant.isFollowedByMe).toBe(true);
    });

    it('returns SUSPENDED stores with status (placeholder) not 404', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        ...profileStore,
        status: 'SUSPENDED',
      });
      mockPrisma.product.count.mockResolvedValue(0);

      const { merchant } = await service.getProfile('tol_thema');
      expect(merchant.status).toBe('SUSPENDED');
      expect(merchant.isVerified).toBe(false);
    });

    it('404s a never-live store (DRAFT)', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        ...profileStore,
        status: 'DRAFT',
      });
      await expect(service.getProfile('tol_thema')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s an unknown handle', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recordView', () => {
    it('writes a merchant_view AnalyticsEvent', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});
      expect(await service.recordView('s1', 'user-1')).toEqual({
        recorded: true,
      });
      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: { eventType: 'merchant_view', storeId: 's1', userId: 'user-1' },
      });
    });
  });
});
