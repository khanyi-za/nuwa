import { Injectable } from '@nestjs/common';
import { CheckoutService } from '../../order/checkout/checkout.service';
import { vatIncludedPortion } from '../common/tax';
import { QuoteDto } from './dto/quote.dto';

/**
 * Order-total preview for the Checkout screen. Reuses the web CheckoutService's
 * quote (real per-store ShipLogic rates, no DB writes) and flattens the
 * per-store breakdown into maya's single-order totals. `tax` is the VAT already
 * included in the total (display only) — see D6 / CK-2.
 */
@Injectable()
export class MobileCheckoutService {
  constructor(private readonly checkout: CheckoutService) {}

  async quote(userId: string, dto: QuoteDto) {
    const totals = await this.checkout.quote(userId, {
      addressId: dto.addressId,
    });

    const total = totals.grandTotalInCents;
    return {
      subtotal: totals.grandSubtotalInCents,
      shipping: totals.grandShippingInCents,
      tax: vatIncludedPortion(total),
      total,
      currency: 'ZAR',
    };
  }
}
