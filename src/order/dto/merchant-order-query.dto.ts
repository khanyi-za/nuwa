import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class MerchantOrderQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string; // order number search

  @IsOptional()
  @IsString()
  cursor?: string; // order ID for cursor-based pagination

  @IsOptional()
  @IsString()
  take?: string; // page size as query string (parsed to number in service)
}
