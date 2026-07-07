import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';
import { EmployeeInviteController } from './employee-invite.controller';
import { StoreService } from './store.service';
import { BannerMediaController } from './banner-media/banner-media.controller';
import { BannerMediaService } from './banner-media/banner-media.service';
import { StoreAnalyticsController } from './analytics/store-analytics.controller';
import { StoreAnalyticsService } from './analytics/store-analytics.service';
import { StoreEarningsController } from './earnings/store-earnings.controller';
import { StoreEarningsService } from './earnings/store-earnings.service';

@Module({
  controllers: [
    StoreController,
    EmployeeInviteController,
    BannerMediaController,
    StoreAnalyticsController,
    StoreEarningsController,
  ],
  providers: [
    StoreService,
    BannerMediaService,
    StoreAnalyticsService,
    StoreEarningsService,
  ],
  exports: [StoreService], // Exported for use by Product, Order, and other future modules
})
export class StoreModule {}
