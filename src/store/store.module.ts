import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';
import { EmployeeInviteController } from './employee-invite.controller';
import { StoreService } from './store.service';
import { BannerMediaController } from './banner-media/banner-media.controller';
import { BannerMediaService } from './banner-media/banner-media.service';

@Module({
  controllers: [
    StoreController,
    EmployeeInviteController,
    BannerMediaController,
  ],
  providers: [StoreService, BannerMediaService],
  exports: [StoreService], // Exported for use by Product, Order, and other future modules
})
export class StoreModule {}
