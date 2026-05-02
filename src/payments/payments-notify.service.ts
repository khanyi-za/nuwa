import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ItnTxType,
  Payment,
  PaymentEvent,
  PaymentGroup,
  PaymentStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PayfastConfig } from './payfast/payfast-config';
import { PayfastSignatureService } from './payfast/payfast-signature.service';
import { PayfastClient } from './payfast/payfast-client.service';
import { PayfastIpAllowlistService } from './payfast/payfast-ip-allowlist.service';
import { phpUrlencode } from './payfast/url-encode';
import { toPaymentStatus } from './payfast/payfast-types';

/**
 * Allowed PaymentGroup status transitions.
 *   - PENDING → COMPLETED/FAILED/CANCELLED: initial-payment ITNs (Phase 4)
 *   - COMPLETED → PARTIALLY_REFUNDED/REFUNDED: refund ITNs (Phase 5)
 *   - PARTIALLY_REFUNDED → PARTIALLY_REFUNDED (multi-step partials) | REFUNDED
 *
 * REFUNDED, FAILED, CANCELLED, RECONCILE_REQUIRED are terminal (manual ops only).
 */
const ALLOWED_TRANSITIONS: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  PENDING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
};

/** Sentinel thrown inside $transaction when the CAS guard loses a race. */
class CASLostError extends Error {
  constructor() {
    super('CAS_LOST');
    this.name = 'CASLostError';
  }
}

type PaymentGroupWithChildren = PaymentGroup & {
  payments: (Payment & { order: { id: string; status: string } })[];
};

/**
 * PaymentsNotifyService — orchestrates the four-step ITN validation,
 * idempotent event recording, optimistic-CAS state transitions, and child
 * Payment/Order updates.
 *
 * Throws BadRequestException to produce HTTP 400 (PayFast retries) for:
 *   - Bad signature
 *   - Bad source IP
 *   - Postback non-VALID
 *   - Amount mismatch
 *   - Missing m_payment_id
 *
 * Returns void (HTTP 200, no PayFast retry) for:
 *   - Replays (itnHash already recorded)
 *   - Unknown m_payment_id with valid signature (logs CRITICAL)
 *   - Invalid state transitions (terminal status, out-of-order)
 *   - CANCELLED-stays-CANCELLED late ITN (sets RECONCILE_REQUIRED)
 *   - Concurrent ITN that lost the CAS race
 */
@Injectable()
export class PaymentsNotifyService {
  private readonly logger = new Logger(PaymentsNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PayfastConfig,
    private readonly signature: PayfastSignatureService,
    private readonly client: PayfastClient,
    private readonly ipAllowlist: PayfastIpAllowlistService,
  ) {}

  async handle(
    parsedBody: Record<string, string>,
    sourceIp: string,
  ): Promise<void> {
    const mPaymentId = parsedBody.m_payment_id;

    // Step 1 — verify signature
    if (!this.signature.verifyItnSignature(parsedBody, this.config.passphrase)) {
      this.logger.warn(
        `ITN rejected: invalid signature (sourceIp=${sourceIp}, m_payment_id=${mPaymentId ?? 'missing'})`,
      );
      throw new BadRequestException();
    }

    // Step 2 — verify source IP
    if (!this.ipAllowlist.isAllowed(sourceIp)) {
      this.logger.warn(
        `ITN rejected: source IP not in allowlist (sourceIp=${sourceIp}, m_payment_id=${mPaymentId ?? 'missing'})`,
      );
      throw new BadRequestException();
    }

    if (!mPaymentId) {
      this.logger.warn('ITN rejected: missing m_payment_id');
      throw new BadRequestException();
    }

    // Step 3 — look up PaymentGroup
    const group = await this.prisma.paymentGroup.findUnique({
      where: { mPaymentId },
      include: {
        payments: {
          include: {
            order: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!group) {
      // Signature was valid → genuinely from PayFast → we lost data.
      // Return 200 so PayFast stops retrying; alert ops loudly.
      this.logger.error(
        `CRITICAL: Valid ITN for unknown m_payment_id=${mPaymentId} — possible data loss`,
      );
      return;
    }

    // Step 4 — verify amount match (PayFast spec allows 0.01 tolerance)
    const expectedRands = group.amountGrossInCents / 100;
    const receivedRands = Number.parseFloat(parsedBody.amount_gross ?? '0');
    if (Number.isNaN(receivedRands) || Math.abs(expectedRands - receivedRands) > 0.01) {
      this.logger.error(
        `CRITICAL: ITN amount mismatch m_payment_id=${mPaymentId} expected=${expectedRands.toFixed(2)} received=${parsedBody.amount_gross}`,
      );
      throw new BadRequestException();
    }

    // Step 5 — postback to PayFast for server-side confirmation
    const postbackBody = this.signature.buildPostbackBody(parsedBody);
    const postbackOk = await this.client.verifyItnPostback(postbackBody);
    if (!postbackOk) {
      this.logger.warn(
        `ITN rejected: postback to PayFast did not return VALID (m_payment_id=${mPaymentId})`,
      );
      throw new BadRequestException();
    }

    // Step 6 — compute idempotency hash
    const itnHash = this.computeItnHash(parsedBody);

    // Step 7 — classify event type and decide target status.
    // Refund ITNs are detected via PayFast's `transaction_type=refund` field.
    // For refunds, the target PaymentGroup status is computed from the aggregate
    // of child Payment.refundedAmountInCents (already updated synchronously by
    // AdminOrdersService.requestRefund); the ITN merely confirms.
    const isRefundItn = parsedBody.transaction_type === 'refund';
    const transactionType = isRefundItn ? ItnTxType.REFUND : ItnTxType.PAYMENT;
    const targetStatus = isRefundItn
      ? this.computeRefundTargetStatus(group)
      : toPaymentStatus(parsedBody.payment_status);

    // Step 8 — INSERT PaymentEvent (unique on itnHash → replay short-circuit)
    let event: PaymentEvent;
    try {
      event = await this.prisma.paymentEvent.create({
        data: {
          paymentGroupId: group.id,
          itnHash,
          pfPaymentId: parsedBody.pf_payment_id ?? null,
          status: targetStatus,
          transactionType,
          payload: parsedBody as unknown as Prisma.InputJsonValue,
          signature: parsedBody.signature,
          sourceIp,
          processed: false,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Duplicate itnHash → idempotent ack.
        this.logger.log(
          `ITN replay (already recorded): m_payment_id=${mPaymentId} itnHash=${itnHash.slice(0, 12)}`,
        );
        return;
      }
      throw err;
    }

    // Step 9 — apply state transition with CAS + side effects
    if (!this.isAllowedTransition(group.status, targetStatus)) {
      await this.markEventNotProcessed(
        event.id,
        `INVALID_TRANSITION:${group.status}→${targetStatus}`,
      );
      this.logger.warn(
        `ITN transition not allowed: m_payment_id=${mPaymentId} current=${group.status} target=${targetStatus}`,
      );
      return;
    }

    // CANCELLED-stays-CANCELLED rule (initial-payment ITNs only): a COMPLETED
    // ITN arriving after any child Order was cancelled must NOT resurrect the
    // order. Mark the PaymentGroup RECONCILE_REQUIRED for ops handling.
    if (!isRefundItn && targetStatus === PaymentStatus.COMPLETED) {
      const hasCancelledOrders = group.payments.some(
        (p) => p.order.status === 'CANCELLED',
      );
      if (hasCancelledOrders) {
        await this.markReconcileRequired(group, event.id, parsedBody);
        this.logger.error(
          `CRITICAL: ITN COMPLETED arrived after order cancellation — RECONCILE_REQUIRED ` +
            `m_payment_id=${mPaymentId} paymentGroupId=${group.id}`,
        );
        return;
      }
    }

    if (isRefundItn) {
      await this.applyRefundTransition(group, event.id, targetStatus, parsedBody);
    } else {
      await this.applyTransition(group, event.id, targetStatus, parsedBody);
    }
  }

  /**
   * For a refund ITN, the PaymentGroup target status is computed from the
   * current aggregate of child Payments. AdminOrdersService.requestRefund
   * has already accumulated each Payment.refundedAmountInCents synchronously
   * before the ITN arrives, so this is a pure read of in-DB state.
   *
   * Returns:
   *   - REFUNDED if every cent of every child Payment is refunded
   *   - PARTIALLY_REFUNDED otherwise (caller must verify total refunded > 0)
   */
  private computeRefundTargetStatus(
    group: PaymentGroupWithChildren,
  ): PaymentStatus {
    const totalGross = group.payments.reduce(
      (sum, p) => sum + p.amountGrossInCents,
      0,
    );
    const totalRefunded = group.payments.reduce(
      (sum, p) => sum + p.refundedAmountInCents,
      0,
    );
    return totalRefunded >= totalGross
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /**
   * Compute the idempotency hash. SHA-256 over the canonicalized payload
   * (alphabetical keys, phpUrlencode values, joined &). Including the
   * signature field guarantees byte-identical replays produce identical
   * hashes — the unique constraint then blocks reinsert.
   */
  private computeItnHash(parsedBody: Record<string, string>): string {
    const sortedKeys = Object.keys(parsedBody).sort();
    const parts = sortedKeys.map(
      (k) => `${k}=${phpUrlencode(String(parsedBody[k] ?? ''))}`,
    );
    return createHash('sha256').update(parts.join('&'), 'utf8').digest('hex');
  }

  private isAllowedTransition(
    current: PaymentStatus,
    target: PaymentStatus,
  ): boolean {
    const allowed = ALLOWED_TRANSITIONS[current];
    return allowed !== undefined && allowed.includes(target);
  }

  /** Apply an allowed PENDING → terminal transition + child updates atomically. */
  private async applyTransition(
    group: PaymentGroupWithChildren,
    eventId: string,
    targetStatus: PaymentStatus,
    parsedBody: Record<string, string>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // CAS guard: only update if status hasn't changed since we read it.
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: this.buildPaymentGroupUpdate(targetStatus, parsedBody),
        });

        if (updated.count === 0) {
          throw new CASLostError();
        }

        // Mirror status onto child Payments (only those still PENDING).
        await tx.payment.updateMany({
          where: { paymentGroupId: group.id, status: PaymentStatus.PENDING },
          data: this.buildPaymentUpdate(targetStatus),
        });

        // Update child Orders.
        const orderIds = group.payments.map((p) => p.orderId);
        if (targetStatus === PaymentStatus.COMPLETED) {
          await tx.order.updateMany({
            where: { id: { in: orderIds }, status: 'PENDING' },
            data: { status: 'CONFIRMED' },
          });
        } else if (
          targetStatus === PaymentStatus.FAILED ||
          targetStatus === PaymentStatus.CANCELLED
        ) {
          const cancelReason =
            targetStatus === PaymentStatus.FAILED
              ? 'SYSTEM:PAYMENT_FAILED'
              : 'SYSTEM:PAYMENT_CANCELLED';
          await tx.order.updateMany({
            where: { id: { in: orderIds }, status: 'PENDING' },
            data: { status: 'CANCELLED', cancelReason },
          });
        }

        await tx.paymentEvent.update({
          where: { id: eventId },
          data: { processed: true },
        });
      });
    } catch (err) {
      if (err instanceof CASLostError) {
        await this.markEventNotProcessed(eventId, 'CAS_LOST_RACE');
        this.logger.warn(
          `ITN CAS race lost during apply: paymentGroupId=${group.id}`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Apply a refund-ITN transition. Unlike `applyTransition`, this does NOT
   * mutate child Payment.refundedAmountInCents (already updated synchronously
   * by AdminOrdersService.requestRefund) and does NOT touch Order status
   * (also already updated synchronously). It only:
   *   - Transitions PaymentGroup.status with CAS guard
   *   - Stores the ITN payload + signature for audit
   *   - Marks the PaymentEvent processed=true
   */
  private async applyRefundTransition(
    group: PaymentGroupWithChildren,
    eventId: string,
    targetStatus: PaymentStatus,
    parsedBody: Record<string, string>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: {
            status: targetStatus,
            pfSignature: parsedBody.signature,
            itnPayload: parsedBody as unknown as Prisma.InputJsonValue,
          },
        });

        if (updated.count === 0) {
          throw new CASLostError();
        }

        await tx.paymentEvent.update({
          where: { id: eventId },
          data: { processed: true },
        });
      });
    } catch (err) {
      if (err instanceof CASLostError) {
        await this.markEventNotProcessed(eventId, 'CAS_LOST_RACE');
        this.logger.warn(
          `Refund ITN CAS race lost during apply: paymentGroupId=${group.id}`,
        );
        return;
      }
      throw err;
    }
  }

  /** Late-ITN-after-cancel: status → RECONCILE_REQUIRED, orders untouched. */
  private async markReconcileRequired(
    group: PaymentGroup,
    eventId: string,
    parsedBody: Record<string, string>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: {
            status: PaymentStatus.RECONCILE_REQUIRED,
            pfPaymentId: parsedBody.pf_payment_id ?? null,
            pfSignature: parsedBody.signature,
            itnPayload: parsedBody as unknown as Prisma.InputJsonValue,
            pfNameFirst: parsedBody.name_first ?? null,
            pfNameLast: parsedBody.name_last ?? null,
            pfEmailAddress: parsedBody.email_address ?? null,
          },
        });
        if (updated.count === 0) {
          throw new CASLostError();
        }

        await tx.paymentEvent.update({
          where: { id: eventId },
          data: {
            processed: false,
            processError: 'ORDER_ALREADY_CANCELLED',
          },
        });
      });
    } catch (err) {
      if (err instanceof CASLostError) {
        await this.markEventNotProcessed(eventId, 'CAS_LOST_RACE');
        return;
      }
      throw err;
    }
  }

  private async markEventNotProcessed(
    eventId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.paymentEvent.update({
      where: { id: eventId },
      data: { processed: false, processError: reason },
    });
  }

  private buildPaymentGroupUpdate(
    targetStatus: PaymentStatus,
    parsedBody: Record<string, string>,
  ): Prisma.PaymentGroupUpdateManyMutationInput {
    const base: Prisma.PaymentGroupUpdateManyMutationInput = {
      status: targetStatus,
      pfPaymentId: parsedBody.pf_payment_id ?? null,
      pfSignature: parsedBody.signature,
      itnPayload: parsedBody as unknown as Prisma.InputJsonValue,
      pfNameFirst: parsedBody.name_first ?? null,
      pfNameLast: parsedBody.name_last ?? null,
      pfEmailAddress: parsedBody.email_address ?? null,
    };

    if (targetStatus === PaymentStatus.COMPLETED) {
      base.paidAt = new Date();
      const fee = Number.parseFloat(parsedBody.amount_fee ?? '0');
      const net = Number.parseFloat(parsedBody.amount_net ?? '0');
      if (!Number.isNaN(fee)) base.amountFeeInCents = Math.round(Math.abs(fee) * 100);
      if (!Number.isNaN(net)) base.amountNetInCents = Math.round(net * 100);
    } else if (
      targetStatus === PaymentStatus.FAILED ||
      targetStatus === PaymentStatus.CANCELLED
    ) {
      base.failedAt = new Date();
    }

    return base;
  }

  private buildPaymentUpdate(
    targetStatus: PaymentStatus,
  ): Prisma.PaymentUpdateManyMutationInput {
    const base: Prisma.PaymentUpdateManyMutationInput = { status: targetStatus };
    if (targetStatus === PaymentStatus.COMPLETED) {
      base.paidAt = new Date();
    }
    return base;
  }
}
