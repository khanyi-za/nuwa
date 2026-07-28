import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GenderType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileProductsService } from './mobile-products.service';
import { Paginated } from '../common/paginated';
import { encodeDiscoveryCursor } from '../common/cursor';

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
  // findMany feeds personalAffinity (category affinity from recent views) —
  // empty by default so pre-personalization tests keep legacy ordering.
  analyticsEvent: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  productCategory: { findMany: jest.fn().mockResolvedValue([]) },
  // Phalo product_scores reader — rejecting by default exercises the
  // fallback path (empty score map = legacy seeded-shuffle ordering), which
  // is what every pre-scores test asserts against.
  $queryRaw: jest.fn().mockRejectedValue(new Error('phalo schema absent')),
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
    // Discovery feed makes two product queries: candidate {id, storeId} rows
    // (recency-ordered), then FEED_SELECT hydration for the page's ids.
    const candidateRow = { id: 'p1', storeId: 's1' };

    it('maps rows to feed-card shape and omits personalised fields for guests', async () => {
      mockPrisma.product.findMany
        .mockResolvedValueOnce([candidateRow])
        .mockResolvedValueOnce([feedRow]);

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
      mockPrisma.product.findMany
        .mockResolvedValueOnce([candidateRow])
        .mockResolvedValueOnce([feedRow]);
      mockPrisma.wishlistItem.findMany.mockResolvedValue([{ productId: 'p1' }]);
      mockPrisma.storeFollower.findMany.mockResolvedValue([]);

      const result = await service.feed({ genderType: 'women' }, USER_ID);

      const product = (result.data as { products: any[] }).products[0];
      expect(product.isLikedByMe).toBe(false);
      expect(product.isBookmarkedByMe).toBe(true);
      expect(product.merchant.isFollowedByMe).toBe(false);
    });

    it('sets hasMore + a discovery cursor when more rows remain', async () => {
      mockPrisma.product.findMany
        .mockResolvedValueOnce([candidateRow, { id: 'p2', storeId: 's1' }])
        .mockResolvedValueOnce([feedRow]);

      const result = await service.feed({ genderType: 'women', limit: 1 });

      expect(result.pagination.hasMore).toBe(true);
      const decoded = Buffer.from(
        result.pagination.nextCursor!,
        'base64url',
      ).toString('utf8');
      expect(decoded).toMatch(/^d1:[0-9a-f]{8}:1$/);
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

    // Six products across three stores, clustered per-store in recency order —
    // the exact shape batch imports produce.
    const clusteredCandidates = [
      { id: 'a1', storeId: 'store-a' },
      { id: 'a2', storeId: 'store-a' },
      { id: 'a3', storeId: 'store-a' },
      { id: 'b1', storeId: 'store-b' },
      { id: 'b2', storeId: 'store-b' },
      { id: 'c1', storeId: 'store-c' },
    ];
    const hydrated = clusteredCandidates.map((c) => ({
      ...feedRow,
      id: c.id,
      store: { ...feedRow.store, id: c.storeId },
    }));

    it('round-robins brands: every store appears once before any repeats', async () => {
      mockPrisma.product.findMany
        .mockResolvedValueOnce(clusteredCandidates)
        .mockResolvedValueOnce(hydrated);

      const result = await service.feed({ genderType: 'women', limit: 6 });

      const ids = (result.data as { products: any[] }).products.map(
        (p) => p.id,
      );
      // Round 0 = each store's newest, round 1 = seconds, round 2 = the rest.
      expect(new Set(ids.slice(0, 3))).toEqual(new Set(['a1', 'b1', 'c1']));
      expect(new Set(ids.slice(3, 5))).toEqual(new Set(['a2', 'b2']));
      expect(ids[5]).toBe('a3');
    });

    it('the cursor continues the same arrangement without duplicates', async () => {
      mockPrisma.product.findMany
        .mockResolvedValueOnce(clusteredCandidates)
        .mockResolvedValueOnce(hydrated)
        .mockResolvedValueOnce(clusteredCandidates)
        .mockResolvedValueOnce(hydrated);

      const page1 = await service.feed({ genderType: 'women', limit: 3 });
      const page2 = await service.feed({
        genderType: 'women',
        limit: 3,
        cursor: page1.pagination.nextCursor!,
      });

      const ids1 = (page1.data as { products: any[] }).products.map((p) => p.id);
      const ids2 = (page2.data as { products: any[] }).products.map((p) => p.id);
      expect(new Set([...ids1, ...ids2]).size).toBe(6);
      expect(page2.pagination.hasMore).toBe(false);
      expect(page2.pagination.nextCursor).toBeNull();
    });

    it('rejects a malformed discovery cursor with 400 INVALID_CURSOR', async () => {
      await expect(
        service.feed({ genderType: 'women', cursor: 'not-a-cursor' }),
      ).rejects.toThrow(BadRequestException);
    });

    // ── Phalo scores: "fair rounds, smart slots" ────────────────────────────
    describe('with phalo product_scores', () => {
      it("a store's top-scored product represents it in round 0; unscored keep recency; round sets stay fair", async () => {
        mockPrisma.product.findMany
          .mockResolvedValueOnce(clusteredCandidates)
          .mockResolvedValueOnce(hydrated);
        // a3 is store-a's OLDEST but best-scoring product.
        mockPrisma.$queryRaw.mockResolvedValueOnce([
          { product_id: 'a3', score: 50 },
        ]);

        const result = await service.feed({ genderType: 'women', limit: 6 });
        const ids = (result.data as { products: any[] }).products.map(
          (p) => p.id,
        );

        // store-a's within-store order becomes [a3, a1, a2] (score, then
        // recency); rounds stay one-per-store-per-round.
        expect(new Set(ids.slice(0, 3))).toEqual(new Set(['a3', 'b1', 'c1']));
        expect(new Set(ids.slice(3, 5))).toEqual(new Set(['a1', 'b2']));
        expect(ids[5]).toBe('a2');
      });

      it('a dominant score always leads its round — jitter cannot flip it', async () => {
        mockPrisma.product.findMany
          .mockResolvedValueOnce(clusteredCandidates)
          .mockResolvedValueOnce(hydrated);
        // c1 at 100: min effective (101×0.5) far exceeds an unscored max (1×1.5).
        mockPrisma.$queryRaw.mockResolvedValueOnce([
          { product_id: 'c1', score: 100 },
        ]);

        const result = await service.feed({ genderType: 'women', limit: 6 });
        const ids = (result.data as { products: any[] }).products.map(
          (p) => p.id,
        );
        expect(ids[0]).toBe('c1');
      });

      it('a failing phalo read orders identically to an empty score set (fallback = legacy shuffle)', async () => {
        const fixedCursor = encodeDiscoveryCursor('deadbeef', 0);
        const run = async () => {
          mockPrisma.product.findMany
            .mockResolvedValueOnce(clusteredCandidates)
            .mockResolvedValueOnce(hydrated);
          const result = await service.feed({
            genderType: 'women',
            limit: 6,
            cursor: fixedCursor,
          });
          return (result.data as { products: any[] }).products.map((p) => p.id);
        };

        mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('phalo down'));
        const failingRead = await run();
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);
        const emptyRead = await run();

        expect(failingRead).toEqual(emptyRead);
      });

      it('a followed store leads its round; engagement still outranks the boost', async () => {
        mockPrisma.product.findMany
          .mockResolvedValueOnce(clusteredCandidates)
          .mockResolvedValueOnce(hydrated);
        mockPrisma.$queryRaw.mockResolvedValueOnce([
          { product_id: 'a1', score: 100 },
        ]);
        mockPrisma.storeFollower.findMany.mockResolvedValue([
          { storeId: 'store-c' },
        ]);
        mockPrisma.wishlistItem.findMany.mockResolvedValue([]);

        const result = await service.feed(
          { genderType: 'women', limit: 6 },
          USER_ID,
        );
        const ids = (result.data as { products: any[] }).products.map(
          (p) => p.id,
        );

        // a1 at score 100 beats followed-but-unscored c1 (engagement > boost);
        // c1's 3.5× boost beats plain jitter, so it precedes b1.
        expect(ids.slice(0, 3)).toEqual(['a1', 'c1', 'b1']);
        // Fairness unchanged: still one product per store per round.
        expect(new Set(ids.slice(3, 5))).toEqual(new Set(['a2', 'b2']));
      });

      it("category affinity picks which product represents a brand (buyer's browsed category wins the tie)", async () => {
        const withCats = [
          { id: 'a1', storeId: 'store-a', categories: [{ categoryId: 'cat-x' }] },
          { id: 'a2', storeId: 'store-a', categories: [{ categoryId: 'cat-y' }] },
          { id: 'a3', storeId: 'store-a', categories: [{ categoryId: 'cat-x' }] },
          { id: 'b1', storeId: 'store-b', categories: [{ categoryId: 'cat-x' }] },
          { id: 'b2', storeId: 'store-b', categories: [{ categoryId: 'cat-x' }] },
          { id: 'c1', storeId: 'store-c', categories: [{ categoryId: 'cat-x' }] },
        ];
        mockPrisma.product.findMany
          .mockResolvedValueOnce(withCats)
          .mockResolvedValueOnce(hydrated);
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);
        mockPrisma.storeFollower.findMany.mockResolvedValue([]);
        mockPrisma.wishlistItem.findMany.mockResolvedValue([]);
        // Buyer's recent views resolve to cat-y.
        mockPrisma.analyticsEvent.findMany.mockResolvedValueOnce([
          { productId: 'seen-1' },
          { productId: 'seen-1' },
        ]);
        mockPrisma.productCategory.findMany.mockResolvedValueOnce([
          { productId: 'seen-1', categoryId: 'cat-y' },
        ]);

        const result = await service.feed(
          { genderType: 'women', limit: 6 },
          USER_ID,
        );
        const ids = (result.data as { products: any[] }).products.map(
          (p) => p.id,
        );

        // store-a's round-0 representative is a2 (cat-y affinity), not the
        // newer a1.
        expect(new Set(ids.slice(0, 3))).toEqual(new Set(['a2', 'b1', 'c1']));
      });

      it('guests trigger no personalization queries and keep legacy ordering', async () => {
        mockPrisma.product.findMany.mockResolvedValue([]);
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);

        await service.feed({ genderType: 'women' });

        expect(mockPrisma.storeFollower.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.analyticsEvent.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.productCategory.findMany).not.toHaveBeenCalled();
      });

      it('queries only fresh popularity rows with positive scores', async () => {
        mockPrisma.product.findMany.mockResolvedValue([]);
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);

        await service.feed({ genderType: 'women' });

        const sql = (mockPrisma.$queryRaw.mock.calls[0] ?? [])
          .flat()
          .join(' ');
        expect(sql).toContain('phalo.product_scores');
        expect(sql).toContain("score_type = 'popularity'");
        expect(sql).toContain('score > 0');
        expect(sql).toContain("interval '24 hours'");
      });
    });
  });

  describe('feed — spotlight mode (FEED_SPOTLIGHT_STORE)', () => {
    afterEach(() => {
      delete process.env.FEED_SPOTLIGHT_STORE;
      delete process.env.FEED_SPOTLIGHT_WEIGHT;
    });

    // Spotlight brand (store-f) has 6 products; two other brands have 2 each.
    const spotlightCandidates = [
      { id: 'f1', storeId: 'store-f' },
      { id: 'f2', storeId: 'store-f' },
      { id: 'f3', storeId: 'store-f' },
      { id: 'f4', storeId: 'store-f' },
      { id: 'f5', storeId: 'store-f' },
      { id: 'f6', storeId: 'store-f' },
      { id: 'a1', storeId: 'store-a' },
      { id: 'a2', storeId: 'store-a' },
      { id: 'b1', storeId: 'store-b' },
      { id: 'b2', storeId: 'store-b' },
    ];
    const spotlightHydrated = spotlightCandidates.map((c) => ({
      ...feedRow,
      id: c.id,
      store: { ...feedRow.store, id: c.storeId },
    }));

    it('gives the spotlight store `weight` slots per round, shuffled among the rest', async () => {
      process.env.FEED_SPOTLIGHT_STORE = 'fieldsstore';
      mockPrisma.store.findUnique.mockResolvedValue({ id: 'store-f' });
      mockPrisma.product.findMany
        .mockResolvedValueOnce(spotlightCandidates)
        .mockResolvedValueOnce(spotlightHydrated);

      const result = await service.feed({ genderType: 'women', limit: 10 });

      const ids = (result.data as { products: any[] }).products.map(
        (p) => p.id,
      );
      // Round 0 = each brand's first slot(s): a1, b1 + THREE spotlight items.
      expect(new Set(ids.slice(0, 5))).toEqual(
        new Set(['a1', 'b1', 'f1', 'f2', 'f3']),
      );
      // Round 1 = the remainder.
      expect(new Set(ids.slice(5))).toEqual(
        new Set(['a2', 'b2', 'f4', 'f5', 'f6']),
      );
      expect(mockPrisma.store.findUnique).toHaveBeenCalledWith({
        where: { slug: 'fieldsstore' },
        select: { id: true },
      });
    });

    it('falls back to the standard round-robin when the spotlight slug matches no store', async () => {
      process.env.FEED_SPOTLIGHT_STORE = 'ghost-store';
      mockPrisma.store.findUnique.mockResolvedValue(null);
      mockPrisma.product.findMany
        .mockResolvedValueOnce(spotlightCandidates)
        .mockResolvedValueOnce(spotlightHydrated);

      const result = await service.feed({ genderType: 'women', limit: 10 });

      const ids = (result.data as { products: any[] }).products.map(
        (p) => p.id,
      );
      // Standard algorithm: round 0 is one item per store.
      expect(new Set(ids.slice(0, 3))).toEqual(new Set(['f1', 'a1', 'b1']));
    });

    it('does not touch the store table when spotlight mode is off', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.feed({ genderType: 'women' });
      expect(mockPrisma.store.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('newArrivals', () => {
    const naHydrated = (ids: string[]) =>
      ids.map((id) => ({ ...feedRow, id }));

    it('maps rows to feed-card shape incl. merchant.username (brand links)', async () => {
      mockPrisma.product.findMany
        .mockResolvedValueOnce([{ id: 'p9', storeId: 's1' }])
        .mockResolvedValueOnce(naHydrated(['p9']));

      const result = await service.newArrivals({
        genderType: 'men',
        limit: 6,
      });

      const products = (result.data as { products: any[] }).products;
      expect(products[0]).toMatchObject({
        id: 'p9',
        name: 'Mosadi Kimono',
        price: 89900,
        primaryImage: 'https://cdn.yiiva.co.za/p1.jpg',
        merchant: { username: 'tol_thema', displayName: "Tol'thema" },
      });
      expect(result.pagination).toEqual({
        limit: 6,
        nextCursor: null,
        hasMore: false,
      });
    });

    it("takes each brand's newest first — no single-brand rail", async () => {
      // Recency order: brand A's entire fresh drop, then B's, then C's.
      mockPrisma.product.findMany
        .mockResolvedValueOnce([
          { id: 'a1', storeId: 'store-a' },
          { id: 'a2', storeId: 'store-a' },
          { id: 'a3', storeId: 'store-a' },
          { id: 'b1', storeId: 'store-b' },
          { id: 'c1', storeId: 'store-c' },
        ])
        .mockResolvedValueOnce(naHydrated(['a1', 'a2', 'b1', 'c1']));

      const result = await service.newArrivals({
        genderType: 'women',
        limit: 4,
      });

      // Round 0 in recency order (a1, b1, c1), then round 1 begins (a2).
      expect(
        (result.data as { products: any[] }).products.map((p) => p.id),
      ).toEqual(['a1', 'b1', 'c1', 'a2']);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('the offset cursor continues the deterministic ordering without duplicates', async () => {
      const candidates = [
        { id: 'a1', storeId: 'store-a' },
        { id: 'a2', storeId: 'store-a' },
        { id: 'a3', storeId: 'store-a' },
        { id: 'b1', storeId: 'store-b' },
        { id: 'c1', storeId: 'store-c' },
      ];
      mockPrisma.product.findMany
        .mockResolvedValueOnce(candidates)
        .mockResolvedValueOnce(naHydrated(['a1', 'b1', 'c1']))
        .mockResolvedValueOnce(candidates)
        .mockResolvedValueOnce(naHydrated(['a2', 'a3']));

      const page1 = await service.newArrivals({ genderType: 'women', limit: 3 });
      const page2 = await service.newArrivals({
        genderType: 'women',
        limit: 3,
        cursor: page1.pagination.nextCursor!,
      });

      const ids1 = (page1.data as { products: any[] }).products.map((p) => p.id);
      const ids2 = (page2.data as { products: any[] }).products.map((p) => p.id);
      expect(ids1).toEqual(['a1', 'b1', 'c1']);
      expect(ids2).toEqual(['a2', 'a3']);
      expect(page2.pagination.hasMore).toBe(false);
      expect(page2.pagination.nextCursor).toBeNull();
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
        { id: 'v1', size: 'XS', color: null, label: 'XS', sku: 'K-XS', available: true, stockCount: 3 },
        { id: 'v2', size: 'S', color: null, label: 'S', sku: 'K-S', available: false, stockCount: 0 },
      ]);
      // No store policy on the fixture → honest platform fallback (no
      // invented windows/guarantees).
      expect(product.returnPolicy).toEqual({
        source: 'platform',
        displayText:
          'Easy exchanges & returns — chat with the brand to arrange, or contact YIIVA support.',
        fullText: null,
      });
      expect(product.media).toEqual([
        { type: 'image', url: 'https://cdn.yiiva.co.za/1.jpg' },
        { type: 'video', url: 'https://cdn.yiiva.co.za/hero.mp4' },
      ]);
      expect(product).not.toHaveProperty('inventoryType');
      expect(product).not.toHaveProperty('isBookmarkedByMe');
      expect(product.merchant).not.toHaveProperty('isFollowedByMe');
    });

    it("serves the store's own returns policy when captured from Shopify", async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...detailRow,
        store: {
          ...detailRow.store,
          returnPolicyText: 'Returns accepted within 14 days of delivery.',
        },
      });

      const { product } = await service.detail('p1');

      expect(product.returnPolicy).toEqual({
        source: 'store',
        displayText: "Tol'thema's returns policy applies to this item.",
        fullText: 'Returns accepted within 14 days of delivery.',
      });
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
    it('returns the same brand\'s other items, excluding the source', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'p1',
        storeId: 's1',
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
      expect(arg.where.storeId).toBe('s1');
      expect(arg.where.genderType).toBeUndefined();
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
      expect(where.OR).toHaveLength(5); // + compacted-slug brand match
      expect(where.genderType.in).toEqual([GenderType.WOMEN, GenderType.UNISEX]);
    });

    it('matches stylized brand names via the compacted slug', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      // "so broke" should reach slug "sobroke" even though the displayName
      // is "BROKE" and contains-match fails.
      await service.searchUniversal({ q: 'So Broke!', limit: 20 });

      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      const slugTerm = where.OR.find((t: any) => t.store?.slug);
      expect(slugTerm.store.slug.contains).toBe('sobroke');
    });

    it('skips the slug term for tiny queries', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.searchUniversal({ q: 'ab', limit: 20 });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.OR).toHaveLength(4);
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

    it('merchant search matches store name, slug, or compacted slug', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      await service.searchByMerchant({ merchantName: 'tol', limit: 20 });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.store.OR).toHaveLength(3);
    });
  });

  describe('merchantProducts', () => {
    it('returns the store catalogue + category slugs with brand-own covers', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      mockPrisma.product.findMany.mockResolvedValue([feedRow]);
      mockPrisma.category.findMany.mockResolvedValue([
        {
          slug: 'kimono',
          products: [
            { product: { images: [{ url: 'https://cdn.yiiva.co.za/k.jpg' }] } },
          ],
        },
        // No imaged product in this category → cover null.
        { slug: 'shirt', products: [] },
      ]);

      const result = await service.merchantProducts('tol_thema', { limit: 20 });

      expect((result.data as any).products[0].name).toBe('Mosadi Kimono');
      expect((result.data as any).categories).toEqual(['kimono', 'shirt']);
      expect((result.data as any).categoryCovers).toEqual([
        { slug: 'kimono', image: 'https://cdn.yiiva.co.za/k.jpg' },
        { slug: 'shirt', image: null },
      ]);
      expect(mockPrisma.product.findMany.mock.calls[0][0].where.storeId).toBe(
        's1',
      );
      // Cover source is scoped to THIS store's ACTIVE products.
      const catWhere = mockPrisma.category.findMany.mock.calls[0][0].select
        .products.where;
      expect(catWhere).toEqual({
        product: { storeId: 's1', status: 'ACTIVE' },
      });
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

    it('filters by collection slug scoped to the store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.category.findMany.mockResolvedValue([]);

      await service.merchantProducts('tol_thema', {
        collection: 'new-in',
        limit: 20,
      });
      const where = mockPrisma.product.findMany.mock.calls[0][0].where;
      expect(where.collections).toEqual({
        some: {
          collection: {
            storeId: 's1',
            slug: { equals: 'new-in', mode: 'insensitive' },
          },
        },
      });
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
