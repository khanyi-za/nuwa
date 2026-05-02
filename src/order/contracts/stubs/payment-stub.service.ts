import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
  RefundRequest,
  RefundResponse,
} from '../payment-contract';

/**
 * Deterministic payment stub — mirrors the real PaymentsService response shape
 * so Phase 4 unit tests for ITN handling can target the same `actionUrl + fields`
 * structure without needing a real PayFast environment.
 *
 * Does NOT create any DB rows — CheckoutService creates PaymentGroup and
 * Payment rows itself; this stub only constructs a synthetic redirect payload.
 *
 * The real `PaymentsService` (in src/payments/) replaces this stub via the
 * `PAYMENT_SERVICE` injection token in OrderModule. Unit tests inject their
 * own mock via `Test.createTestingModule` and bypass this stub entirely.
 */
@Injectable()
export class PaymentStubService implements IPaymentService {
  async initializePayment(
    req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    return {
      actionUrl: 'https://sandbox.payfast.co.za/eng/process',
      fields: {
        merchant_id: 'stub-merchant-id',
        merchant_key: 'stub-merchant-key',
        m_payment_id: req.mPaymentId,
        amount: (req.totalAmountInCents / 100).toFixed(2),
        item_name: req.itemName,
        name_first: req.buyerFirstName,
        name_last: req.buyerLastName,
        email_address: req.buyerEmail,
        signature: 'stub-signature-deadbeef',
      },
    };
  }

  async refundPayment(_req: RefundRequest): Promise<RefundResponse> {
    throw new NotImplementedException(
      'PaymentStubService.refundPayment — refunds require the real PaymentsService (Phase 5).',
    );
  }
}
