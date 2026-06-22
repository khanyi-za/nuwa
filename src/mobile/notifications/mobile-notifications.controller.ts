import { Body, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileNotificationsService } from './mobile-notifications.service';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { RegisterPushTokenDto, RemovePushTokenDto } from './dto/register-push-token.dto';

// Auth-required (the global JwtAuthGuard applies — no @Public).
@MobileController('api/me')
export class MobileNotificationsController {
  constructor(private readonly service: MobileNotificationsService) {}

  @Get('notifications')
  list(@Query() dto: NotificationsQueryDto, @CurrentUser('id') userId: string) {
    return this.service.list(userId, { limit: dto.limit ?? 20, cursor: dto.cursor });
  }

  @Get('notifications/unread-count')
  unreadCount(@CurrentUser('id') userId: string) {
    return this.service.unreadCount(userId);
  }

  @Patch('notifications/:id/read')
  markRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.service.markRead(userId, id);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser('id') userId: string) {
    return this.service.markAllRead(userId);
  }

  @Post('push-tokens')
  @HttpCode(200)
  registerPushToken(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.registerPushToken(userId, dto.token, dto.platform);
  }

  @Delete('push-tokens')
  removePushToken(
    @Body() dto: RemovePushTokenDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.removePushToken(userId, dto.token);
  }
}
