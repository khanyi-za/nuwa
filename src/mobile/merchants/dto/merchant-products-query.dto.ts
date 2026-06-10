import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class MerchantProductsQueryDto {
  /** Category slug from the merchant's catalogue (from the categories[] list). */
  @IsOptional()
  @IsString()
  clothingType?: string;

  // Accepted for forward-compat (MP-7). Only `newest` is effective in v1 —
  // price sorts need cursor-on-price and are deferred to v2.
  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc'])
  sort?: string = 'newest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}
