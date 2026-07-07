import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StoreEarningsService } from './store-earnings.service';

/**
 * GET /stores/:storeId/earnings?month=YYYY-MM&cursor&take — merchant money
 * visibility: lifetime + monthly accrued earnings and the per-order ledger.
 * Authz service-side via canManageStore.
 */
@Controller('stores/:storeId/earnings')
export class StoreEarningsController {
  constructor(private readonly earnings: StoreEarningsService) {}

  @Get()
  getEarnings(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Query('month') month?: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.earnings.getEarnings(userId, storeId, { month, cursor, take });
  }
}
