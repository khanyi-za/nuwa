import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query for GET /api/orders (buyer order history). Cursor-paginated on the
 * PaymentGroup id, newest first. No server-side status filter in v1 — the
 * "Active" pill is a client-side filter (orders-flows.md §6.1).
 */
export class OrdersQueryDto {
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
