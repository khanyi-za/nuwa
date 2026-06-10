import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { StoreModule } from './store/store.module';
import { ProductModule } from './product/product.module';
import { OrderModule } from './order/order.module';
import { PaymentsModule } from './payments/payments.module';
import { UploadsModule } from './uploads/uploads.module';
import { ShippingModule } from './shipping/shipping.module';
import { MobileModule } from './mobile/mobile.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    EmailModule,
    AuthModule,
    StoreModule,
    ProductModule,
    OrderModule,
    PaymentsModule,
    UploadsModule,
    ShippingModule,
    MobileModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
