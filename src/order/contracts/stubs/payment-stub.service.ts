import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
  RefundRequest,
  RefundResponse,
} from '../payment-contract';

/**
 * Deterministic payment stub — mirrors the real provider's v3 response shape
 * (GET redirect to a hosted checkout, Paystack-style) so flows can be
 * exercised without a payment environment.
 *
 * Does NOT create any DB rows — CheckoutService creates PaymentGroup and
 * Payment rows itself; this stub only constructs a synthetic redirect payload.
 *
 * The real `PaystackService` (in src/payments/) replaces this stub via the
 * `PAYMENT_SERVICE` injection token in OrderModule. Unit tests inject their
 * own mock via `Test.createTestingModule` and bypass this stub entirely.
 */
@Injectable()
export class PaymentStubService implements IPaymentService {
  async initializePayment(
    req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    return {
      redirect: {
        url: `https://stub.payment.example/checkout?reference=${encodeURIComponent(req.reference)}`,
        method: 'GET',
      },
      providerRef: `stub-access-${req.reference}`,
    };
  }

  async refundPayment(_req: RefundRequest): Promise<RefundResponse> {
    throw new NotImplementedException(
      'PaymentStubService.refundPayment — refunds require the real PaystackService.',
    );
  }
}
