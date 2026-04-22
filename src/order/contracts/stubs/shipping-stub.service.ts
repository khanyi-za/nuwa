import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IShippingService,
  ShippingRateRequest,
  ShippingRateResponse,
} from '../shipping-contract';

const DEFAULT_FLAT_FEE_IN_CENTS = 11_000; // R110

/**
 * Deterministic shipping stub — returns a flat R110 rate regardless of
 * origin/destination/weight. The real Shipping module (The Courier Guy) will
 * replace this binding when it ships.
 *
 * Rate is read from `SHIPPING_FLAT_FEE_IN_CENTS` env var, defaulting to
 * 11000 (R110). This lets finance/ops tune the fee without a deploy.
 */
@Injectable()
export class ShippingStubService implements IShippingService {
  private readonly flatFeeInCents: number;

  constructor() {
    const env = process.env.SHIPPING_FLAT_FEE_IN_CENTS;
    this.flatFeeInCents = env ? parseInt(env, 10) : DEFAULT_FLAT_FEE_IN_CENTS;
  }

  async getRate(_req: ShippingRateRequest): Promise<ShippingRateResponse> {
    return {
      quoteId: `stub-flat-${randomUUID()}`,
      rateInCents: this.flatFeeInCents,
      rateExVatInCents: this.flatFeeInCents, // no VAT for MVP
      serviceTier: 'ECO',
      estimatedDeliveryDate: new Date(
        Date.now() + 5 * 24 * 60 * 60 * 1000, // +5 business days
      ),
    };
  }
}
