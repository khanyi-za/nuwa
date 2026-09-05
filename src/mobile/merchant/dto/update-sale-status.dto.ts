import { IsIn } from 'class-validator';
import { OrderStatus } from '@prisma/client';

/**
 * The only merchant-forward targets. The underlying MerchantOrdersService
 * enforces the full transition table (CONFIRMED→PROCESSING→READY_FOR_DISPATCH);
 * this narrows the surface so a phone client can't even ask for admin/courier
 * statuses.
 */
export class UpdateSaleStatusDto {
  @IsIn([OrderStatus.PROCESSING, OrderStatus.READY_FOR_DISPATCH])
  status!: OrderStatus;
}
