import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';

/**
 * StoreAnalyticsService — live-computed v1 merchant analytics.
 *
 * Serves GET /stores/:storeId/analytics for the athena dashboard KPI cards
 * (the "▶ PHALO SWAP POINT" in athena's lib/analytics/store-analytics.ts).
 *
 * v1 computes everything at request time from Order + Store + Product rows —
 * no aggregate tables. When Phalo Phase 3 ships `phalo.store_stats_daily`,
 * this service's internals swap to reading that table; THE RESPONSE SHAPE
 * MUST NOT CHANGE (athena and this contract are coupled by design).
 *
 * Definitions (documented once, here):
 * - Window: last 14 calendar days (UTC), inclusive of today, vs the previous
 *   14 days for trend deltas.
 * - Revenue = SUM(Order.subtotalInCents) of orders CONFIRMED in the window
 *   (confirmedAt is when the payment webhook landed). Shipping is excluded —
 *   it is YIIVA→courier money, never the merchant's. Refunds are not
 *   subtracted in v1.
 * - Orders = COUNT of orders confirmed in the window.
 * - Followers / rating: current values only — no history exists yet, so the
 *   sparklines are flat and trendPct is 0. History accumulates once Phalo's
 *   daily snapshots run.
 * - Active products: current ACTIVE products bucketed by publishedAt — an
 *   approximation of growth (ignores archive history).
 */

const WINDOW_DAYS = 14;

export interface StoreAnalyticsResponse {
  window: { days: number; from: string; to: string };
  revenue: {
    valueInCents: number;
    trendPct: number;
    series: { date: string; valueInCents: number }[];
  };
  orders: { count: number; trendPct: number; spark: number[] };
  followers: { count: number; trendPct: number; spark: number[] };
  activeProducts: { count: number; trendPct: number; spark: number[] };
  rating: { value: number; trendPct: number; spark: number[] };
}

@Injectable()
export class StoreAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async getAnalytics(
    userId: string,
    storeId: string,
  ): Promise<StoreAnalyticsResponse> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to view analytics for this store',
      );
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { followerCount: true, averageRating: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const now = new Date();
    const dayKeys = this.lastNDayKeys(now, WINDOW_DAYS);
    const currentStart = this.startOfDayUtc(now, WINDOW_DAYS - 1);
    const previousStart = this.startOfDayUtc(now, WINDOW_DAYS * 2 - 1);

    // One read covers both windows; bucketing happens in JS (store-scale data).
    const confirmedOrders = await this.prisma.order.findMany({
      where: {
        storeId,
        confirmedAt: { not: null, gte: previousStart },
      },
      select: { confirmedAt: true, subtotalInCents: true },
    });

    const revenueByDay = new Map<string, number>(dayKeys.map((d) => [d, 0]));
    const ordersByDay = new Map<string, number>(dayKeys.map((d) => [d, 0]));
    let currentRevenue = 0;
    let previousRevenue = 0;
    let currentOrders = 0;
    let previousOrders = 0;

    for (const order of confirmedOrders) {
      const confirmedAt = order.confirmedAt as Date;
      if (confirmedAt >= currentStart) {
        currentRevenue += order.subtotalInCents;
        currentOrders += 1;
        const key = this.dayKey(confirmedAt);
        if (revenueByDay.has(key)) {
          revenueByDay.set(key, revenueByDay.get(key)! + order.subtotalInCents);
          ordersByDay.set(key, ordersByDay.get(key)! + 1);
        }
      } else {
        previousRevenue += order.subtotalInCents;
        previousOrders += 1;
      }
    }

    // Active-products growth: currently-ACTIVE products cumulated by publish day.
    const activeProducts = await this.prisma.product.findMany({
      where: { storeId, status: ProductStatus.ACTIVE },
      select: { publishedAt: true, createdAt: true },
    });
    const activeSpark = dayKeys.map((key) => {
      const endOfDay = new Date(`${key}T23:59:59.999Z`);
      return activeProducts.filter(
        (p) => (p.publishedAt ?? p.createdAt) <= endOfDay,
      ).length;
    });
    const activeCount = activeProducts.length;

    const followerCount = store.followerCount;
    const rating = Number(store.averageRating);

    return {
      window: {
        days: WINDOW_DAYS,
        from: dayKeys[0],
        to: dayKeys[dayKeys.length - 1],
      },
      revenue: {
        valueInCents: currentRevenue,
        trendPct: this.trendPct(currentRevenue, previousRevenue),
        series: dayKeys.map((date) => ({
          date,
          valueInCents: revenueByDay.get(date)!,
        })),
      },
      orders: {
        count: currentOrders,
        trendPct: this.trendPct(currentOrders, previousOrders),
        spark: dayKeys.map((date) => ordersByDay.get(date)!),
      },
      followers: {
        count: followerCount,
        trendPct: 0,
        spark: dayKeys.map(() => followerCount),
      },
      activeProducts: {
        count: activeCount,
        trendPct: this.trendPct(
          activeSpark[activeSpark.length - 1],
          activeSpark[0],
        ),
        spark: activeSpark,
      },
      rating: {
        value: rating,
        trendPct: 0,
        spark: dayKeys.map(() => rating),
      },
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** % change current vs previous; previous 0 → 100 when current > 0, else 0. */
  private trendPct(current: number, previous: number): number {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** UTC midnight `daysAgo` days before `now`. */
  private startOfDayUtc(now: Date, daysAgo: number): Date {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d;
  }

  /** Oldest → newest ISO day keys for the current window. */
  private lastNDayKeys(now: Date, n: number): string[] {
    const keys: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      keys.push(this.dayKey(this.startOfDayUtc(now, i)));
    }
    return keys;
  }
}
