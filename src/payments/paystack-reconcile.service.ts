import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackClient } from './paystack/paystack-client.service';
import { PaystackVerifyData } from './paystack/paystack-types';

export type PaystackReconcileVerdict =
  | 'MATCH' // Paystack success ↔ our COMPLETED/refund family
  | 'MISMATCH' // terminal states disagree, or amounts differ
  | 'NOT_FOUND' // Paystack has no record of the reference
  | 'MATCH_PENDING'; // both sides still in-flight/abandoned

export interface PaystackReconcileResult {
  paymentGroup: {
    id: string;
    reference: string;
    status: PaymentStatus;
    amountGrossInCents: number;
    createdAt: Date;
  };
  paystack: {
    found: boolean;
    transactionId?: number;
    status?: string;
    amountInCents?: number;
    paidAt?: string | null;
    channel?: string;
  };
  verdict: PaystackReconcileVerdict;
}

/** Our statuses that legitimately correspond to a successful provider charge. */
const COMPLETED_FAMILY: PaymentStatus[] = [
  PaymentStatus.COMPLETED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Provider statuses that mean "no money moved (yet)". */
const PROVIDER_PENDING = ['pending', 'ongoing', 'processing', 'queued', 'abandoned'];

/**
 * PaystackReconcileService — read-only investigation tool for stuck
 * PaymentGroups, the Paystack counterpart of PaymentsReconcileService.
 *
 * Much simpler than the PayFast version: Paystack HAS a single-transaction
 * status query (GET /transaction/verify/:reference), so no date-window
 * scanning of a history endpoint is needed. Never mutates state.
 */
@Injectable()
export class PaystackReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: PaystackClient,
  ) {}

  async reconcile(paymentGroupId: string): Promise<PaystackReconcileResult> {
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
      throw new NotFoundException({
        code: 'PAYMENT_GROUP_NOT_FOUND',
        message: 'Payment group not found',
      });
    }

    const tx = await this.client.tryVerifyTransaction(group.mPaymentId);

    const base = {
      paymentGroup: {
        id: group.id,
        reference: group.mPaymentId,
        status: group.status,
        amountGrossInCents: group.amountGrossInCents,
        createdAt: group.createdAt,
      },
    };

    if (!tx) {
      return { ...base, paystack: { found: false }, verdict: 'NOT_FOUND' };
    }

    return {
      ...base,
      paystack: {
        found: true,
        transactionId: tx.id,
        status: tx.status,
        amountInCents: tx.amount,
        paidAt: tx.paid_at,
        channel: tx.channel,
      },
      verdict: this.verdictFor(group.status, group.amountGrossInCents, tx),
    };
  }

  private verdictFor(
    ours: PaymentStatus,
    ourAmount: number,
    tx: PaystackVerifyData,
  ): PaystackReconcileVerdict {
    if (tx.status === 'success') {
      return COMPLETED_FAMILY.includes(ours) && tx.amount === ourAmount
        ? 'MATCH'
        : 'MISMATCH';
    }
    if (PROVIDER_PENDING.includes(tx.status)) {
      return ours === PaymentStatus.PENDING ? 'MATCH_PENDING' : 'MISMATCH';
    }
    // failed / reversed on the provider side.
    return ours === PaymentStatus.FAILED || ours === PaymentStatus.CANCELLED
      ? 'MATCH'
      : 'MISMATCH';
  }
}
