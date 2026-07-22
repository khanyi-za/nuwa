import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import {
  ItnTxType,
  Payment,
  PaymentGroup,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackConfig } from './paystack/paystack-config';
import { PaystackWebhookEvent } from './paystack/paystack-types';
import { ShipmentCreationService } from '../shipping/shipment-creation.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Allowed PaymentGroup transitions — identical table to the PayFast ITN
 * pipeline (the state machine is provider-agnostic; only the wire format
 * changed). REFUNDED, FAILED, CANCELLED, RECONCILE_REQUIRED are terminal.
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

interface ChargeSuccessData {
  id: number;
  reference: string;
  amount: number; // integer subunits (ZAR cents)
  fees: number | null;
  customer?: { email?: string };
  [key: string]: unknown;
}

interface RefundEventData {
  transaction_reference?: string;
  refund_reference?: string;
  amount?: number;
  status?: string;
  [key: string]: unknown;
}

/**
 * PaystackWebhookService — Paystack replacement for the PayFast ITN pipeline
 * (PaymentsNotifyService, which it retires at migration Phase 5).
 *
 * Same processing discipline, simpler validation:
 *   verify HMAC-SHA512 signature over the RAW body → look up PaymentGroup by
 *   reference → exact integer amount match → INSERT PaymentEvent (unique
 *   payload hash = replay shield) → CAS state transition → side effects
 *   OUTSIDE the transaction (shipment booking, notifications).
 *
 * Dropped relative to ITN (cryptographically redundant here): source-IP
 *   allowlist, server postback, signature-order sensitivity, Rand-string
 *   amount parsing (Paystack amounts are integer cents end-to-end).
 *
 * HTTP semantics:
 *   - 400 (Paystack retries): missing/invalid signature, malformed JSON,
 *     amount mismatch.
 *   - 200 ack (no retry): replays, unknown reference (CRITICAL log), invalid
 *     transitions, CAS races, CANCELLED-stays-CANCELLED (→ RECONCILE_REQUIRED),
 *     unknown event types.
 */
@Injectable()
export class PaystackWebhookService {
  private readonly logger = new Logger(PaystackWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PaystackConfig,
    private readonly shipmentCreation: ShipmentCreationService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    sourceIp: string,
  ): Promise<void> {
    // Step 1 — verify the HMAC-SHA512 signature over the RAW bytes.
    if (!rawBody || rawBody.length === 0) {
      this.logger.warn('Webhook rejected: empty body');
      throw new BadRequestException();
    }
    if (!this.verifySignature(rawBody, signatureHeader)) {
      this.logger.warn(
        `Webhook rejected: invalid signature (sourceIp=${sourceIp})`,
      );
      throw new BadRequestException();
    }

    // Step 2 — parse the event.
    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as PaystackWebhookEvent;
    } catch {
      this.logger.warn('Webhook rejected: body is not valid JSON');
      throw new BadRequestException();
    }

    // Step 3 — route by event type.
    if (event.event === 'charge.success') {
      await this.handleChargeSuccess(
        event,
        rawBody,
        signatureHeader!,
        sourceIp,
      );
      return;
    }
    if (event.event.startsWith('refund.')) {
      await this.handleRefundEvent(event, rawBody, signatureHeader!, sourceIp);
      return;
    }

    // Unknown event types are acked silently — Paystack adds events without
    // notice and none of them may mutate our state by default.
    this.logger.log(`Webhook event ignored (unhandled type): ${event.event}`);
  }

  // ─── charge.success ───────────────────────────────────────────────────────

  private async handleChargeSuccess(
    event: PaystackWebhookEvent,
    rawBody: Buffer,
    signatureHeader: string,
    sourceIp: string,
  ): Promise<void> {
    const data = event.data as unknown as ChargeSuccessData;
    const reference = data.reference;
    if (!reference) {
      this.logger.warn('charge.success rejected: missing data.reference');
      throw new BadRequestException();
    }

    const group = await this.lookupGroup(reference);
    if (!group) {
      // Signature was valid → genuinely from Paystack → we lost data.
      // Ack 200 so Paystack stops retrying; alert ops loudly.
      this.logger.error(
        `CRITICAL: valid charge.success for unknown reference=${reference} — possible data loss`,
      );
      return;
    }

    // Exact integer match — both sides are ZAR cents (no float tolerance
    // needed, unlike PayFast's decimal Rand strings).
    if (data.amount !== group.amountGrossInCents) {
      this.logger.error(
        `CRITICAL: charge.success amount mismatch reference=${reference} ` +
          `expected=${group.amountGrossInCents} received=${data.amount}`,
      );
      throw new BadRequestException();
    }

    const eventRow = await this.insertEvent({
      group,
      rawBody,
      signatureHeader,
      sourceIp,
      event,
      providerPaymentId: String(data.id),
      transactionType: ItnTxType.PAYMENT,
      targetStatus: PaymentStatus.COMPLETED,
    });
    if (!eventRow) return; // replay

    if (!this.isAllowedTransition(group.status, PaymentStatus.COMPLETED)) {
      await this.markEventNotProcessed(
        eventRow.id,
        `INVALID_TRANSITION:${group.status}→COMPLETED`,
      );
      this.logger.warn(
        `charge.success transition not allowed: reference=${reference} current=${group.status}`,
      );
      return;
    }

    // CANCELLED-stays-CANCELLED: a success webhook arriving after any child
    // order was cancelled must NOT resurrect it → RECONCILE_REQUIRED.
    const hasCancelledOrders = group.payments.some(
      (p) => p.order.status === 'CANCELLED',
    );
    if (hasCancelledOrders) {
      await this.markReconcileRequired(group, eventRow.id, event, data);
      this.logger.error(
        `CRITICAL: charge.success arrived after order cancellation — RECONCILE_REQUIRED ` +
          `reference=${reference} paymentGroupId=${group.id}`,
      );
      return;
    }

    await this.applyCompletedTransition(group, eventRow.id, event, data);
  }

  private async applyCompletedTransition(
    group: PaymentGroupWithChildren,
    eventId: string,
    event: PaystackWebhookEvent,
    data: ChargeSuccessData,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const fees = typeof data.fees === 'number' ? data.fees : null;
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: {
            status: PaymentStatus.COMPLETED,
            pfPaymentId: String(data.id), // provider payment id (column rename PS-5)
            itnPayload: event as unknown as Prisma.InputJsonValue,
            pfEmailAddress: data.customer?.email ?? null,
            paidAt: new Date(),
            ...(fees !== null
              ? {
                  amountFeeInCents: fees,
                  amountNetInCents: group.amountGrossInCents - fees,
                }
              : {}),
          },
        });
        if (updated.count === 0) throw new CASLostError();

        await tx.payment.updateMany({
          where: { paymentGroupId: group.id, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.COMPLETED, paidAt: new Date() },
        });

        const orderIds = group.payments.map((p) => p.orderId);
        await tx.order.updateMany({
          where: { id: { in: orderIds }, status: 'PENDING' },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });

        await tx.paymentEvent.update({
          where: { id: eventId },
          data: { processed: true },
        });
      });
    } catch (err) {
      if (err instanceof CASLostError) {
        await this.markEventNotProcessed(eventId, 'CAS_LOST_RACE');
        this.logger.warn(
          `charge.success CAS race lost during apply: paymentGroupId=${group.id}`,
        );
        return;
      }
      throw err;
    }

    // ── Side effects OUTSIDE the DB transaction (house rule) ──
    // Failures are logged, never rolled back: the buyer paid.
    const orderIds = group.payments.map((p) => p.orderId);
    await Promise.allSettled(
      orderIds.map(async (orderId) => {
        try {
          await this.shipmentCreation.createShipmentForOrder(orderId);
        } catch (err) {
          this.logger.error(
            `Shipment booking failed post-webhook for order ${orderId}: ${(err as Error).message}. Order remains CONFIRMED; ops review required.`,
          );
        }
      }),
    );
    await this.notifications.orderConfirmed(group.id);
  }

  // ─── refund.* (confirmation-only) ─────────────────────────────────────────

  /**
   * Refund state was already accumulated SYNCHRONOUSLY by
   * AdminOrdersService.requestRefund (Payment.refundedAmountInCents + Order
   * status) — webhooks only confirm:
   *   - refund.processed → CAS the PaymentGroup to PARTIALLY_REFUNDED/REFUNDED
   *     (computed from the child aggregate, same rule as the ITN pipeline)
   *   - refund.pending / refund.processing → audit row only
   *   - refund.failed → audit row + CRITICAL log (money mismatch: we already
   *     accumulated the refund locally — manual ops reversal required)
   */
  private async handleRefundEvent(
    event: PaystackWebhookEvent,
    rawBody: Buffer,
    signatureHeader: string,
    sourceIp: string,
  ): Promise<void> {
    const data = event.data as unknown as RefundEventData;
    const reference =
      data.transaction_reference ??
      (data.transaction as { reference?: string } | undefined)?.reference;
    if (!reference) {
      this.logger.warn(`${event.event} ignored: no transaction reference`);
      return;
    }

    const group = await this.lookupGroup(reference);
    if (!group) {
      this.logger.error(
        `CRITICAL: valid ${event.event} for unknown reference=${reference}`,
      );
      return;
    }

    const targetStatus = this.computeRefundTargetStatus(group);
    const eventRow = await this.insertEvent({
      group,
      rawBody,
      signatureHeader,
      sourceIp,
      event,
      providerPaymentId: group.pfPaymentId,
      transactionType: ItnTxType.REFUND,
      targetStatus,
    });
    if (!eventRow) return; // replay

    if (event.event === 'refund.failed') {
      await this.markEventNotProcessed(eventRow.id, 'REFUND_FAILED_AT_PROVIDER');
      this.logger.error(
        `CRITICAL: refund FAILED at Paystack for reference=${reference} — ` +
          `local refund accounting already applied; manual ops reversal required`,
      );
      return;
    }

    if (event.event !== 'refund.processed') {
      // pending / processing — informational audit row only.
      await this.prisma.paymentEvent.update({
        where: { id: eventRow.id },
        data: { processed: true },
      });
      return;
    }

    if (!this.isAllowedTransition(group.status, targetStatus)) {
      await this.markEventNotProcessed(
        eventRow.id,
        `INVALID_TRANSITION:${group.status}→${targetStatus}`,
      );
      return;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: {
            status: targetStatus,
            itnPayload: event as unknown as Prisma.InputJsonValue,
          },
        });
        if (updated.count === 0) throw new CASLostError();
        await tx.paymentEvent.update({
          where: { id: eventRow.id },
          data: { processed: true },
        });
      });
    } catch (err) {
      if (err instanceof CASLostError) {
        await this.markEventNotProcessed(eventRow.id, 'CAS_LOST_RACE');
        return;
      }
      throw err;
    }
  }

  // ─── shared helpers ───────────────────────────────────────────────────────

  private verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha512', this.config.secretKey)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private lookupGroup(
    reference: string,
  ): Promise<PaymentGroupWithChildren | null> {
    return this.prisma.paymentGroup.findUnique({
      where: { mPaymentId: reference }, // our reference (column rename PS-5)
      include: {
        payments: {
          include: { order: { select: { id: true, status: true } } },
        },
      },
    });
  }

  /**
   * INSERT the audit/idempotency row. Hash = SHA-256 of the RAW body — a
   * byte-identical redelivery hits the unique constraint and is acked as a
   * replay (returns null).
   */
  private async insertEvent(args: {
    group: PaymentGroupWithChildren;
    rawBody: Buffer;
    signatureHeader: string;
    sourceIp: string;
    event: PaystackWebhookEvent;
    providerPaymentId: string | null;
    transactionType: ItnTxType;
    targetStatus: PaymentStatus;
  }): Promise<{ id: string } | null> {
    const hash = createHash('sha256').update(args.rawBody).digest('hex');
    try {
      return await this.prisma.paymentEvent.create({
        data: {
          paymentGroupId: args.group.id,
          itnHash: hash, // semantic: webhook payload hash (column rename PS-5)
          pfPaymentId: args.providerPaymentId,
          status: args.targetStatus,
          transactionType: args.transactionType,
          payload: args.event as unknown as Prisma.InputJsonValue,
          signature: args.signatureHeader,
          sourceIp: args.sourceIp,
          processed: false,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(
          `Webhook replay (already recorded): paymentGroupId=${args.group.id} hash=${hash.slice(0, 12)}`,
        );
        return null;
      }
      throw err;
    }
  }

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

  private isAllowedTransition(
    current: PaymentStatus,
    target: PaymentStatus,
  ): boolean {
    const allowed = ALLOWED_TRANSITIONS[current];
    return allowed !== undefined && allowed.includes(target);
  }

  private async markReconcileRequired(
    group: PaymentGroupWithChildren,
    eventId: string,
    event: PaystackWebhookEvent,
    data: ChargeSuccessData,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.paymentGroup.updateMany({
          where: { id: group.id, status: group.status },
          data: {
            status: PaymentStatus.RECONCILE_REQUIRED,
            pfPaymentId: String(data.id),
            itnPayload: event as unknown as Prisma.InputJsonValue,
          },
        });
        if (updated.count === 0) throw new CASLostError();
        await tx.paymentEvent.update({
          where: { id: eventId },
          data: { processed: false, processError: 'ORDER_ALREADY_CANCELLED' },
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
}
