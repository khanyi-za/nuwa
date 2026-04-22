import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutItemDto } from './checkout-item.dto';
import { GuestInfoDto } from './guest-info.dto';

/**
 * Commit request — locks the quote, creates Orders + PaymentGroup,
 * calls PayFast, returns the redirect URL.
 *
 * Same address/guest/items shape as the quote DTO, plus PayFast callback
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

  /** Where PayFast redirects the buyer after successful payment. */
  @IsString()
  returnUrl: string;

  /** Where PayFast redirects the buyer if they cancel. */
  @IsString()
  cancelUrl: string;
}
