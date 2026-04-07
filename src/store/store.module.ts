import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService], // Exported for use by Product, Order, and other future modules
})
export class StoreModule {}
