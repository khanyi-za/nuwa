import { Injectable } from '@nestjs/common';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
  RefundRequest,
  RefundResponse,
} from '../order/contracts/payment-contract';
import { PayfastConfig } from './payfast/payfast-config';
import { PayfastSignatureService } from './payfast/payfast-signature.service';
import { PayfastClient } from './payfast/payfast-client.service';

/**
 * PaymentsService — real PayFast implementation behind the `PAYMENT_SERVICE`
 * injection token. Replaces `PaymentStubService` from Phase 3 onward.
 *
 * - initializePayment: builds the form-flow payload, signs it, returns
 *   `{ actionUrl, fields }` for the frontend to render and submit.
 * - refundPayment: invokes PayFast's REST refund API. PayFast confirms
 *   the refund asynchronously via ITN — our synchronous return reflects
 *   only that PayFast accepted the request.
 */
@Injectable()
export class PaymentsService implements IPaymentService {
  constructor(
    private readonly config: PayfastConfig,
    private readonly signature: PayfastSignatureService,
    private readonly client: PayfastClient,
  ) {}

  async initializePayment(
    req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    const fields: Record<string, string> = {
      merchant_id: this.config.merchantId,
      merchant_key: this.config.merchantKey,
      return_url: req.returnUrl ?? this.config.returnUrl,
      cancel_url: req.cancelUrl ?? this.config.cancelUrl,
      notify_url: this.config.notifyUrl,
      name_first: req.buyerFirstName,
      name_last: req.buyerLastName,
      email_address: req.buyerEmail,
      m_payment_id: req.mPaymentId,
      amount: this.formatAmount(req.totalAmountInCents),
      item_name: req.itemName,
    };

    if (req.buyerCellNumber) {
      fields.cell_number = req.buyerCellNumber;
    }
    if (req.itemDescription) {
      fields.item_description = req.itemDescription;
    }

    const signed = this.signature.signFormPayload(
      fields,
      this.config.passphrase,
    );

    return {
      actionUrl: `${this.config.formBaseUrl}/eng/process`,
      fields: { ...fields, signature: signed },
    };
  }

  async refundPayment(req: RefundRequest): Promise<RefundResponse> {
    const raw = await this.client.createRefund({
      pfPaymentId: req.pfPaymentId,
      amountInCents: req.amountInCents,
      reason: req.reason,
      accType: req.accType,
      notifyBuyer: req.notifyBuyer,
    });

    // PayFast's refund API returns synchronously when accepted; the actual
    // refund completion is confirmed asynchronously via ITN. We surface
    // PROCESSING here so callers know the buyer hasn't been credited yet.
    // PayFast keys refunds by the original pf_payment_id (no separate refund
    // UUID is returned in the create response that we can rely on).
    return {
      refundId: req.pfPaymentId,
      status: 'PROCESSING',
      raw,
    };
  }

  /** Convert integer cents to PayFast's expected `X.XX` decimal string. */
  private formatAmount(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
