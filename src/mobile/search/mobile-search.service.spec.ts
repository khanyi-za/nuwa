import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileSearchService } from './mobile-search.service';

const mockPrisma = {
  tag: { findMany: jest.fn() },
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
    it('returns top tags by usageCount as #hashtags', async () => {
      mockPrisma.tag.findMany.mockResolvedValue([
        { name: 'heritage' },
        { name: 'minimalist' },
      ]);

      const result = await service.suggestions({});

      expect(result).toEqual({
        trending: ['#heritage', '#minimalist'],
        suggestions: [],
      });
      expect(mockPrisma.tag.findMany.mock.calls[0][0].orderBy).toEqual([
        { usageCount: 'desc' },
        { name: 'asc' },
      ]);
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
