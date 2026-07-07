import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { StoreAnalyticsService } from './store-analytics.service';

/**
 * GET /stores/:storeId/analytics — live-computed merchant dashboard KPIs.
 * Authz service-side via canManageStore (owner or active accepted employee).
 */
@Controller('stores/:storeId/analytics')
export class StoreAnalyticsController {
  constructor(private readonly analytics: StoreAnalyticsService) {}

  @Get()
  getAnalytics(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.analytics.getAnalytics(userId, storeId);
  }
}
