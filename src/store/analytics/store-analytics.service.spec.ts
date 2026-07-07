import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoreAnalyticsService } from './store-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const STORE_ID = 'store-1';

const baseStore = {
  followerCount: 42,
  averageRating: 4.5,
};

/** UTC midnight `daysAgo` days before now, plus `hours` into that day. */
function daysAgoUtc(daysAgo: number, hours = 12): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hours);
  return d;
}

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  store: { findUnique: jest.fn() },
  order: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('StoreAnalyticsService', () => {
  let service: StoreAnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(StoreAnalyticsService);
    jest.clearAllMocks();

    mockStoreService.canManageStore.mockResolvedValue(true);
    mockPrisma.store.findUnique.mockResolvedValue(baseStore);
    mockPrisma.order.findMany.mockResolvedValue([]);
    mockPrisma.product.findMany.mockResolvedValue([]);
  });

  describe('getAnalytics', () => {
    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(service.getAnalytics(USER_ID, STORE_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
    });

    it('throws 404 when the store does not exist', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);

      await expect(service.getAnalytics(USER_ID, STORE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns a 14-day window with zeroed series for a quiet store', async () => {
      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.window.days).toBe(14);
      expect(result.revenue.valueInCents).toBe(0);
      expect(result.revenue.trendPct).toBe(0);
      expect(result.revenue.series).toHaveLength(14);
      expect(result.revenue.series.every((p) => p.valueInCents === 0)).toBe(true);
      expect(result.orders.count).toBe(0);
      expect(result.orders.spark).toEqual(new Array(14).fill(0));
    });

    it('sums confirmed-order subtotals into the current window and buckets by day', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { confirmedAt: daysAgoUtc(0), subtotalInCents: 10_000 },
        { confirmedAt: daysAgoUtc(0), subtotalInCents: 5_000 },
        { confirmedAt: daysAgoUtc(3), subtotalInCents: 20_000 },
      ]);

      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.revenue.valueInCents).toBe(35_000);
      expect(result.orders.count).toBe(3);
      // Today is the last bucket (oldest → newest).
      expect(result.revenue.series[13].valueInCents).toBe(15_000);
      expect(result.revenue.series[10].valueInCents).toBe(20_000);
      expect(result.orders.spark[13]).toBe(2);
      expect(result.orders.spark[10]).toBe(1);
    });

    it('computes trendPct against the previous 14-day window', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        // Current window: 30_000
        { confirmedAt: daysAgoUtc(1), subtotalInCents: 30_000 },
        // Previous window: 20_000
        { confirmedAt: daysAgoUtc(20), subtotalInCents: 20_000 },
      ]);

      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.revenue.trendPct).toBe(50);
      // 1 order now vs 1 order before → 0% change.
      expect(result.orders.trendPct).toBe(0);
    });

    it('reports 100% trend when the previous window was empty but the current is not', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        { confirmedAt: daysAgoUtc(2), subtotalInCents: 12_000 },
      ]);

      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.revenue.trendPct).toBe(100);
      expect(result.orders.trendPct).toBe(100);
    });

    it('returns flat sparks and zero trend for followers and rating (no history yet)', async () => {
      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.followers.count).toBe(42);
      expect(result.followers.trendPct).toBe(0);
      expect(result.followers.spark).toEqual(new Array(14).fill(42));
      expect(result.rating.value).toBe(4.5);
      expect(result.rating.spark).toEqual(new Array(14).fill(4.5));
    });

    it('cumulates active products by publish day', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { publishedAt: daysAgoUtc(30), createdAt: daysAgoUtc(31) },
        { publishedAt: daysAgoUtc(5), createdAt: daysAgoUtc(6) },
        { publishedAt: null, createdAt: daysAgoUtc(1) },
      ]);

      const result = await service.getAnalytics(USER_ID, STORE_ID);

      expect(result.activeProducts.count).toBe(3);
      // Oldest bucket: only the 30-days-ago product existed.
      expect(result.activeProducts.spark[0]).toBe(1);
      // Newest bucket: all three.
      expect(result.activeProducts.spark[13]).toBe(3);
      // Growth 1 → 3 = +200%.
      expect(result.activeProducts.trendPct).toBe(200);
    });

    it('queries orders scoped to the store with a confirmed-only filter', async () => {
      await service.getAnalytics(USER_ID, STORE_ID);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: STORE_ID,
            confirmedAt: expect.objectContaining({ not: null }),
          }),
        }),
      );
    });
  });
});
