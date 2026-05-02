import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayfastClient } from './payfast/payfast-client.service';

const RECONCILE_WINDOW_DAYS = 7;

export type ReconcileVerdict =
  | 'MATCH' // PayFast says COMPLETE, we say COMPLETED — all good
  | 'MISMATCH' // PayFast and our records disagree on terminal state
  | 'NOT_FOUND' // PayFast has no record of this m_payment_id in the window
  | 'MATCH_PENDING'; // both sides still PENDING — checkout in flight or abandoned

export interface ReconcileResult {
  paymentGroup: {
    id: string;
    mPaymentId: string;
    status: PaymentStatus;
    amountGrossInCents: number;
    createdAt: Date;
  };
  payfast: {
    found: boolean;
    pfPaymentId?: string;
    paymentStatus?: string;
    amountGross?: string;
    raw?: Record<string, string>;
  };
  verdict: ReconcileVerdict;
  /** Date window queried against PayFast (YYYY-MM-DD inclusive). */
  window: { from: string; to: string };
}

/**
 * PaymentsReconcileService — read-only investigation tool for stuck PaymentGroups.
 *
 * PayFast's REST API does not expose a single-transaction status query. When a
 * payment is stuck (PENDING > 30min, RECONCILE_REQUIRED, or admin-reported
 * complaint), ops uses this service to scan PayFast's transactions/history
 * for a date window around `PaymentGroup.createdAt` and locate the matching
 * `m_payment_id`. The service does not mutate state; the response is for
 * human or future-automated handling.
 */
@Injectable()
export class PaymentsReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PayfastClient,
  ) {}

  async reconcile(paymentGroupId: string): Promise<ReconcileResult> {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: paymentGroupId },
      select: {
        id: true,
        mPaymentId: true,
        status: true,
        amountGrossInCents: true,
        createdAt: true,
      },
    });

    if (!group) {
      throw new NotFoundException('PaymentGroup not found');
    }

    const window = this.computeWindow(group.createdAt);

    const history = await this.client.fetchTransactionHistory({
      from: window.from,
      to: window.to,
    });

    const match = history.transactions.find(
      (t) => t.m_payment_id === group.mPaymentId,
    );

    const verdict = this.computeVerdict(group.status, match);

    return {
      paymentGroup: {
        id: group.id,
        mPaymentId: group.mPaymentId,
        status: group.status,
        amountGrossInCents: group.amountGrossInCents,
        createdAt: group.createdAt,
      },
      payfast: match
        ? {
            found: true,
            pfPaymentId: match.pf_payment_id,
            paymentStatus: match.payment_status,
            amountGross: match.amount_gross,
            raw: match,
          }
        : { found: false },
      verdict,
      window,
    };
  }

  private computeWindow(centerDate: Date): { from: string; to: string } {
    const from = new Date(centerDate);
    from.setUTCDate(from.getUTCDate() - RECONCILE_WINDOW_DAYS);
    const to = new Date(centerDate);
    to.setUTCDate(to.getUTCDate() + RECONCILE_WINDOW_DAYS);
    return {
      from: this.formatDate(from),
      to: this.formatDate(to),
    };
  }

  private formatDate(d: Date): string {
    // YYYY-MM-DD per PayFast's expected format
    return d.toISOString().slice(0, 10);
  }

  private computeVerdict(
    ourStatus: PaymentStatus,
    payfastTx?: Record<string, string>,
  ): ReconcileVerdict {
    if (!payfastTx) return 'NOT_FOUND';

    const theirStatus = payfastTx.payment_status?.toUpperCase();

    if (theirStatus === 'PENDING' && ourStatus === PaymentStatus.PENDING) {
      return 'MATCH_PENDING';
    }

    // Map PayFast's COMPLETE → our COMPLETED for comparison.
    const theirNormalized = theirStatus === 'COMPLETE' ? 'COMPLETED' : theirStatus;
    if (theirNormalized === ourStatus) {
      return 'MATCH';
    }

    return 'MISMATCH';
  }
}
