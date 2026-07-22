import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
  PaymentSplitInstruction,
  RefundRequest,
  RefundResponse,
} from '../order/contracts/payment-contract';
import { PaystackConfig } from './paystack/paystack-config';
import { PaystackClient } from './paystack/paystack-client.service';
import { PaystackRefundStatus } from './paystack/paystack-types';

/**
 * PaystackService — Paystack implementation of the v3 payment contract.
 * Takes over the `PAYMENT_SERVICE` binding from PayFast's PaymentsService at
 * migration Phase 5 (docs/payments-module/paystack-migration-foundation.md).
 *
 * - initializePayment: creates a hosted-checkout session; the buyer is
 *   redirected (plain GET) to `authorization_url`. Amounts stay integer ZAR
 *   cents end-to-end — no decimal-string conversion exists on this provider.
 * - refundPayment: full/partial refund by provider transaction id. Paystack
 *   confirms asynchronously via refund.* webhooks (Phase 3/4); the
 *   synchronous response reflects acceptance, not buyer credit.
 */
@Injectable()
export class PaystackService implements IPaymentService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(
    private readonly config: PaystackConfig,
    private readonly client: PaystackClient,
  ) {}

  async initializePayment(
    req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    const splitCode = await this.createSplitIfRequested(
      req.reference,
      req.splits,
    );

    const data = await this.client.initializeTransaction({
      amount: req.totalAmountInCents,
      email: req.buyerEmail,
      currency: 'ZAR',
      reference: req.reference,
      callback_url: req.returnUrl ?? this.config.callbackUrl,
      ...(req.channels?.length ? { channels: req.channels } : {}),
      ...(splitCode ? { split_code: splitCode } : {}),
      metadata: {
        order_ids: req.orderIds,
        item_name: req.itemName,
        ...(req.itemDescription
          ? { item_description: req.itemDescription }
          : {}),
        // Shown in the Paystack dashboard next to the transaction.
        custom_fields: [
          {
            display_name: 'Order',
            variable_name: 'order',
            value: req.itemName,
          },
        ],
      },
    });

    return {
      redirect: { url: data.authorization_url, method: 'GET' },
      providerRef: data.access_code,
    };
  }

  async refundPayment(req: RefundRequest): Promise<RefundResponse> {
    const data = await this.client.createRefund({
      transaction: req.providerPaymentId,
      amount: req.amountInCents,
      merchant_note: req.reason,
      // Paystack emails the customer on refund by default; customer_note is
      // the buyer-visible reason. notifyBuyer has no direct toggle here.
      customer_note: req.reason,
    });

    return {
      refundId: String(data.id),
      status: this.mapRefundStatus(data.status),
      raw: data,
    };
  }

  /**
   * Merchant payout splits (migration Phase 6): a per-transaction FLAT
   * multi-split routes each configured merchant's share (subtotal −
   * commission) straight to their subaccount; commission + shipping + any
   * unconfigured merchants' shares settle to the main YIIVA account.
   * Fee bearing: all-proportional (PS-8, decided 2026-07-22) — every party
   * bears processing fees on its own share, keeping the 2.5% commission
   * margin-positive on cards.
   *
   * DEGRADES GRACEFULLY: a split-creation failure must never block a buyer's
   * checkout — we log CRITICAL and initialize WITHOUT the split (settlement
   * lands on the main balance; merchant payout falls back to manual ops).
   */
  private async createSplitIfRequested(
    reference: string,
    splits: PaymentSplitInstruction[] | undefined,
  ): Promise<string | null> {
    if (!splits?.length) return null;
    try {
      const split = await this.client.createSplit({
        name: `yiiva-${reference}`.slice(0, 100),
        type: 'flat',
        currency: 'ZAR',
        subaccounts: splits.map((s) => ({
          subaccount: s.subaccountCode,
          share: s.amountInCents,
        })),
        bearer_type: 'all-proportional',
      });
      return split.split_code;
    } catch (err) {
      this.logger.error(
        `CRITICAL: split creation failed for reference=${reference} — ` +
          `proceeding WITHOUT split; merchant payouts for this transaction ` +
          `require manual ops. ${(err as Error).message}`,
      );
      return null;
    }
  }

  private mapRefundStatus(
    status: PaystackRefundStatus,
  ): RefundResponse['status'] {
    switch (status) {
      case 'pending':
        return 'PENDING';
      case 'processing':
        return 'PROCESSING';
      case 'processed':
        return 'COMPLETED';
      case 'failed':
        return 'FAILED';
      default:
        return 'PROCESSING';
    }
  }
}
