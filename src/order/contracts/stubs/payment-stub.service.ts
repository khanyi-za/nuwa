import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
} from '../payment-contract';

/**
 * Deterministic payment stub — returns a synthetic PayFast-shaped response
 * so Phase 4 checkout is end-to-end testable. The real Payments module
 * (PayFast integration) will replace this binding when it ships.
 *
 * Does NOT create any DB rows — the CheckoutService creates PaymentGroup
 * and Payment rows itself; this stub only provides the redirect URL.
 */
@Injectable()
export class PaymentStubService implements IPaymentService {
  async initializePayment(
    req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    const mPaymentId = `stub-${randomUUID()}`;

    return {
      paymentGroupId: `stub-pg-${randomUUID()}`,
      mPaymentId,
      payfastRedirectUrl: `https://sandbox.payfast.co.za/eng/process?m_payment_id=${mPaymentId}&amount=${req.totalAmountInCents}`,
    };
  }
}
