import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

/**
 * Buyer notifications: in-app inbox rows + Resend emails + Expo push. @Global
 * (like EmailModule) so payments/shipping/order can inject NotificationsService
 * without import wiring or circular-dep risk. PrismaService + EmailService are
 * themselves global, so this module declares no imports.
 */
@Global()
@Module({
  providers: [NotificationsService, PushService],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
