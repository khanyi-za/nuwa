import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CheckoutItemDto } from './checkout-item.dto';
import { GuestInfoDto } from './guest-info.dto';

/**
 * Quote request — returns per-store totals + shipping for UI confirmation.
 * No DB writes.
 *
 * Authenticated buyers send `addressId` (items come from server cart).
 * Guests send `guest` info + `items` array (from localStorage).
 */
export class CheckoutQuoteDto {
  /** Existing address ID. Required for authenticated buyers. */
  @IsOptional()
  @IsString()
  addressId?: string;

  /** Guest identity + delivery address. Required when no JWT. */
  @IsOptional()
  @ValidateNested()
  @Type(() => GuestInfoDto)
  guest?: GuestInfoDto;

  /** Cart items from localStorage. Required for guests, ignored for authed. */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @ArrayMinSize(1)
  items?: CheckoutItemDto[];
}
