import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * AdminRefundOrderDto — body of POST /admin/orders/:orderId/refund.
 *
 * Triggers a Paystack refund. Supports partial refunds via `amountInCents`;
 * Paystack credits the buyer's original payment method and confirms
 * asynchronously via refund.* webhooks.
 *
 * Reason text is shown to the buyer in their refund confirmation.
 */
export class AdminRefundOrderDto {
  /** Amount to refund in cents. Must be ≤ remaining (gross − already-refunded). */
  @IsInt()
  @IsPositive()
  amountInCents: number;

  /** Reason shown to the buyer in the refund confirmation. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;

  /** When true (default), the provider notifies the buyer. */
  @IsOptional()
  @IsBoolean()
  notifyBuyer?: boolean;
}
