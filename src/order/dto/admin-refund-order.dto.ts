import {
  IsBoolean,
  IsEnum,
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
 * Triggers a PayFast REST refund. Supports partial refunds via `amountInCents`.
 * The buyer is credited via PayFast (their bank account, configured via
 * `accType`). PayFast confirms the refund asynchronously via ITN.
 *
 * Reason text is shown to the buyer in their refund email.
 */
export class AdminRefundOrderDto {
  /** Amount to refund in cents. Must be ≤ remaining (gross − already-refunded). */
  @IsInt()
  @IsPositive()
  amountInCents: number;

  /** Reason shown to the buyer. PayFast emails this in the refund confirmation. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;

  /**
   * Buyer's bank account type. PayFast requires this for refund disbursement.
   * Operators capture this at refund time; for v1 we ask the admin to enter it.
   */
  @IsEnum(['current', 'savings'])
  accType: 'current' | 'savings';

  /** When true (default), PayFast emails the buyer. */
  @IsOptional()
  @IsBoolean()
  notifyBuyer?: boolean;
}
