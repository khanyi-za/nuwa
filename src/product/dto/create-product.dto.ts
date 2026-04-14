import { IsString, IsOptional, IsInt, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @Length(2, 120)
  title: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceInCents: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comparePriceInCents?: number;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalStock?: number;
}
