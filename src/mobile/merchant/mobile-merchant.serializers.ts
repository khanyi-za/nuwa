import type { StoreAnalyticsResponse } from '../../store/analytics/store-analytics.service';
import type {
  MerchantOrderDetail,
  MerchantOrderSummary,
} from '../../order/merchant-orders/merchant-orders.service';

/**
 * Serializers for the mobile merchant surface (maya "Manage my store").
 * These re-shape the web contracts into what the phone actually renders —
 * the source responses (StoreAnalyticsResponse especially) are LOCKED athena
 * contracts and must never be mutated, only read.
 */

export interface MerchantOverviewView {
  window: { days: number; from: string; to: string };
  revenue: {
    valueInCents: number;
    trendPct: number;
    /** 14 daily points, oldest → newest — enough for a hand-rolled bar row. */
    series: { date: string; valueInCents: number }[];
  };
  orders: { count: number; trendPct: number };
  followers: { count: number; trendPct: number };
  rating: { value: number; trendPct: number };
  /** Live work-queue counts (all-time, not windowed) for the "needs attention" strip. */
  actionable: { newSales: number; preparing: number };
}

/**
 * Phone overview = athena's 14-day KPI feed minus what mobile doesn't render:
 * spark arrays (no chart lib in maya) and activeProducts (catalogue editing
 * stays on the web dashboard).
 */
export function toOverviewView(
  a: StoreAnalyticsResponse,
  actionable: { newSales: number; preparing: number },
): MerchantOverviewView {
  return {
    window: a.window,
    revenue: {
      valueInCents: a.revenue.valueInCents,
      trendPct: a.revenue.trendPct,
      series: a.revenue.series,
    },
    orders: { count: a.orders.count, trendPct: a.orders.trendPct },
    followers: { count: a.followers.count, trendPct: a.followers.trendPct },
    rating: { value: a.rating.value, trendPct: a.rating.trendPct },
    actionable,
  };
}

/** Sale rows pass through the merchant-orders shapes; Dates → ISO via JSON. */
export function toSaleSummaryView(o: MerchantOrderSummary): MerchantOrderSummary {
  return o;
}

export function toSaleDetailView(o: MerchantOrderDetail): MerchantOrderDetail {
  return o;
}
