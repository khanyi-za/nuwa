import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  IShippingService,
  ShippingRateRequest,
  ShippingRateResponse,
} from '../shipping-contract';

/**
 * Placeholder implementation of {@link IShippingService}. Any code path that
 * reaches the shipping layer before the real Shipping module ships will throw.
 */
@Injectable()
export class ShippingStubService implements IShippingService {
  async getRate(_req: ShippingRateRequest): Promise<ShippingRateResponse> {
    throw new NotImplementedException(
      'Shipping module is not yet implemented. Rate quotes are unavailable.',
    );
  }
}
