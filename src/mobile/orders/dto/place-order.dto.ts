import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * maya POST /orders body. v1 supports authenticated delivery checkout via
 * Paystack redirect. `addressId`, `returnUrl`, `paymentMethod` are used; the rest are
 * accepted for forward-compat with maya's documented body but ignored in v1
 * (pickup, saved cards, Apple Pay, promo, guest email are all deferred).
 */
export class PlaceOrderDto {
  @IsString()
  @MinLength(1)
  addressId!: string;

  /** Where the provider's hosted page returns the buyer (https sentinel). */
  @IsString()
  returnUrl!: string;

  /** Accepted for compat; Paystack has no cancel URL (WebView intercept + cron). */
  @IsString()
  cancelUrl!: string;

  /**
   * Payment channel chosen on the Payment step (card | eft | qr) — restricts
   * the Paystack hosted page to that method. Unknown values → all channels.
   */
  @IsOptional() @IsString() paymentMethod?: string;

  // ── Accepted but ignored in v1 ──────────────────────────────────────────
  @IsOptional() @IsString() shippingMethod?: string;
  @IsOptional() @IsString() shippingRateId?: string;
  @IsOptional() @IsString() pickupLocationId?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
  @IsOptional() @IsString() applePayToken?: string;
  @IsOptional() @IsString() promoCode?: string;
  @IsOptional() @IsString() email?: string;
}
