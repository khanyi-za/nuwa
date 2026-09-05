import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';

/**
 * Query DTO for GET /api/merchant/orders. Deliberately separate from the web
 * MerchantOrderQueryDto (whose `take` is an untyped string parsed in the
 * service) — this one validates a real number and the mobile service converts
 * at the delegation boundary.
 */
export class MerchantSalesQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}
