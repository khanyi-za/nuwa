import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileSearchService } from './mobile-search.service';

const mockPrisma = {
  store: { findMany: jest.fn() },
  product: { count: jest.fn() },
  analyticsEvent: { create: jest.fn() },
};

describe('MobileSearchService', () => {
  let service: MobileSearchService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileSearchService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileSearchService);
    jest.clearAllMocks();
  });

  describe('suggestions', () => {
    it('serves only terms that match enough live products, capped at 8', async () => {
      mockPrisma.store.findMany.mockResolvedValue([]);
      // Every candidate qualifies → the cap decides the count.
      mockPrisma.product.count.mockResolvedValue(10);

      const result = await service.suggestions({});

      expect(result.suggestions).toEqual([]);
      expect(result.trending).toHaveLength(8);
      for (const term of result.trending) {
        expect(term).not.toMatch(/^#/); // real search terms, not hashtags
      }
    });

    it('drops candidates below the match threshold', async () => {
      mockPrisma.store.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);

      const result = await service.suggestions({});

      expect(result.trending).toEqual([]);
    });

    it('blends top brand names into the candidate pool', async () => {
      mockPrisma.store.findMany.mockResolvedValue([
        { displayName: "Tol'thema" },
      ]);
      // Only the first candidate (the brand) qualifies.
      mockPrisma.product.count.mockImplementation(({ where }) =>
        Promise.resolve(
          JSON.stringify(where).includes("Tol'thema") ? 5 : 0,
        ),
      );

      const result = await service.suggestions({});

      expect(result.trending).toEqual(["Tol'thema"]);
      expect(mockPrisma.store.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        orderBy: { followerCount: 'desc' },
        take: 3,
        select: { displayName: true },
      });
    });

    it('caches the validated terms — second call hits no queries', async () => {
      mockPrisma.store.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(10);

      const first = await service.suggestions({});
      mockPrisma.store.findMany.mockClear();
      mockPrisma.product.count.mockClear();

      const second = await service.suggestions({});

      expect(second.trending).toEqual(first.trending);
      expect(mockPrisma.store.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.product.count).not.toHaveBeenCalled();
    });
  });

  describe('track', () => {
    it('writes a search AnalyticsEvent', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});

      const result = await service.track(
        { q: 'kimono', genderType: 'women', resultCount: 12 },
        'user-1',
      );

      expect(result).toEqual({ recorded: true });
      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: 'search',
          userId: 'user-1',
          productId: null,
          metadata: { q: 'kimono', genderType: 'women', resultCount: 12 },
        },
      });
    });

    it('writes a search_click AnalyticsEvent when clickedProductId is present', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});

      const result = await service.track(
        { q: 'kimono', genderType: 'women', clickedProductId: 'prod-1', position: 3 },
        'user-1',
      );

      expect(result).toEqual({ recorded: true });
      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: 'search_click',
          userId: 'user-1',
          productId: 'prod-1',
          metadata: { q: 'kimono', genderType: 'women', position: 3 },
        },
      });
    });

    it('anonymous click records with null userId and position', async () => {
      mockPrisma.analyticsEvent.create.mockResolvedValue({});

      await service.track({ q: 'hoodie', clickedProductId: 'prod-2' });

      expect(mockPrisma.analyticsEvent.create).toHaveBeenCalledWith({
        data: {
          eventType: 'search_click',
          userId: null,
          productId: 'prod-2',
          metadata: { q: 'hoodie', genderType: null, position: null },
        },
      });
    });
  });
});
