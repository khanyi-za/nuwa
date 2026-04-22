import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Add-to-cart payload.
 *
 * `variantId` is optional — when omitted, the request targets the bare
 * product SKU (independent SKU model: bare and each variant carry their own
 * stock). Quantity has no DTO-level upper bound; stock availability is the
 * only ceiling (see Phase 3 decision #3).
 */
export class AddCartItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
