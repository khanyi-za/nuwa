import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class AddCartItemDto {
  @IsString()
  @MinLength(1)
  productId!: string;

  /** Required when the product has variants; omitted for sizeless products. */
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;
}
