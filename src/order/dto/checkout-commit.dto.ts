import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutItemDto } from './checkout-item.dto';
import { GuestInfoDto } from './guest-info.dto';

/**
 * Commit request — locks the quote, creates Orders + PaymentGroup,
 * calls the payment provider, returns the redirect URL.
 *
 * Same address/guest/items shape as the quote DTO, plus provider callback
 * URLs and optional buyer notes.
 */
export class CheckoutCommitDto {
  @IsOptional()
  @IsString()
  addressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuestInfoDto)
  guest?: GuestInfoDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @ArrayMinSize(1)
  items?: CheckoutItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Where the payment provider redirects the buyer after successful payment. */
  @IsString()
  returnUrl: string;

  /**
   * Accepted for client compat but unused: Paystack's hosted page has no
   * cancel URL — abandonment is handled by the WebView intercept + the
   * pending-order cron.
   */
  @IsOptional()
  @IsString()
  cancelUrl?: string;

  /**
   * Optional: restrict the provider's hosted page to specific channels
   * (Paystack: card | eft | qr). Set by the mobile Payment step's method
   * selector; omit → all active channels.
   */
  @IsOptional()
  @IsArray()
  @IsIn(['card', 'eft', 'qr'], { each: true })
  paymentChannels?: string[];
}
