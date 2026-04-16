import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IPaymentService,
  PaymentInitRequest,
  PaymentInitResponse,
} from '../payment-contract';

/**
 * Placeholder implementation of {@link IPaymentService}. Any code path that
 * reaches the payments layer before the real Payments module ships will throw.
 */
@Injectable()
export class PaymentStubService implements IPaymentService {
  async initializePayment(
    _req: PaymentInitRequest,
  ): Promise<PaymentInitResponse> {
    throw new NotImplementedException(
      'Payments module is not yet implemented. PayFast initialization is unavailable.',
    );
  }
}
