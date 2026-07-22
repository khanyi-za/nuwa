import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';

/**
 * StoreEarningsService — merchant money visibility.
 *
 * Serves GET /stores/:storeId/earnings for the athena Earnings page: lifetime
 * + monthly summaries and a per-order ledger, all read straight from Payment
 * rows (commission and payout were locked per-order at checkout time, so this
 * is the authoritative record — nothing is recomputed).
 *
 * Definitions:
 * - A payment counts as EARNED once its status is COMPLETED (the provider webhook
 *   landed). Later refunds keep status COMPLETED and accumulate on
 *   refundedAmountInCents — reported separately, never rewritten history.
 * - grossInCents = the store's subtotal slice (shipping is YIIVA→courier
 *   money and never appears in merchant earnings).
 * - Period bucketing uses Order.confirmedAt (UTC), the payment-landed moment.
 * - These are ACCRUED earnings. Payout disbursement records (the Payout
 *   model) are a later phase — the UI must not imply money has been paid out.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface EarningsTotals {
  grossInCents: number;
  commissionInCents: number;
  payoutInCents: number;
  refundedInCents: number;
  orderCount: number;
}

export interface EarningsLedgerRow {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  confirmedAt: Date | null;
  grossInCents: number;
  commissionInCents: number;
  payoutInCents: number;
  refundedInCents: number;
}

export interface StoreEarningsResponse {
  summary: {
    lifetime: EarningsTotals;
    period: EarningsTotals & { month: string };
  };
  ledger: {
    rows: EarningsLedgerRow[];
    nextCursor: string | null;
  };
}

@Injectable()
export class StoreEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async getEarnings(
    userId: string,
    storeId: string,
    opts: { month?: string; cursor?: string; take?: string } = {},
  ): Promise<StoreEarningsResponse> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to view earnings for this store',
      );
    }

    const month = this.resolveMonth(opts.month);
    const { monthStart, monthEnd } = this.monthBounds(month);
    const take = Math.min(
      parseInt(opts.take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const earnedWhere: Prisma.PaymentWhereInput = {
      status: PaymentStatus.COMPLETED,
      order: { storeId },
    };

    const [lifetime, period, ledgerRows] = await Promise.all([
      this.prisma.payment.aggregate({
        where: earnedWhere,
        _sum: {
          amountGrossInCents: true,
          platformCommissionInCents: true,
          merchantPayoutInCents: true,
          refundedAmountInCents: true,
        },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          ...earnedWhere,
          order: { storeId, confirmedAt: { gte: monthStart, lt: monthEnd } },
        },
        _sum: {
          amountGrossInCents: true,
          platformCommissionInCents: true,
          merchantPayoutInCents: true,
          refundedAmountInCents: true,
        },
        _count: true,
      }),
      // Ledger is scoped to the selected month (statement view).
      this.prisma.payment.findMany({
        where: {
          ...earnedWhere,
          order: { storeId, confirmedAt: { gte: monthStart, lt: monthEnd } },
        },
        orderBy: [{ order: { confirmedAt: 'desc' } }, { id: 'desc' }],
        take: take + 1,
        ...(opts.cursor && { cursor: { id: opts.cursor }, skip: 1 }),
        select: {
          id: true,
          amountGrossInCents: true,
          platformCommissionInCents: true,
          merchantPayoutInCents: true,
          refundedAmountInCents: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              confirmedAt: true,
            },
          },
        },
      }),
    ]);

    const hasMore = ledgerRows.length > take;
    const page = hasMore ? ledgerRows.slice(0, take) : ledgerRows;

    return {
      summary: {
        lifetime: this.toTotals(lifetime),
        period: { month, ...this.toTotals(period) },
      },
      ledger: {
        rows: page.map((p) => ({
          orderId: p.order.id,
          orderNumber: p.order.orderNumber,
          orderStatus: p.order.status,
          confirmedAt: p.order.confirmedAt,
          grossInCents: p.amountGrossInCents,
          commissionInCents: p.platformCommissionInCents,
          payoutInCents: p.merchantPayoutInCents,
          refundedInCents: p.refundedAmountInCents,
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      },
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private toTotals(agg: {
    _sum: {
      amountGrossInCents: number | null;
      platformCommissionInCents: number | null;
      merchantPayoutInCents: number | null;
      refundedAmountInCents: number | null;
    };
    _count: number;
  }): EarningsTotals {
    return {
      grossInCents: agg._sum.amountGrossInCents ?? 0,
      commissionInCents: agg._sum.platformCommissionInCents ?? 0,
      payoutInCents: agg._sum.merchantPayoutInCents ?? 0,
      refundedInCents: agg._sum.refundedAmountInCents ?? 0,
      orderCount: agg._count,
    };
  }

  private resolveMonth(month?: string): string {
    if (!month) {
      return new Date().toISOString().slice(0, 7);
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must be formatted YYYY-MM');
    }
    return month;
  }

  private monthBounds(month: string): { monthStart: Date; monthEnd: Date } {
    const [year, mm] = month.split('-').map((v) => parseInt(v, 10));
    const monthStart = new Date(Date.UTC(year, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(year, mm, 1));
    return { monthStart, monthEnd };
  }
}
