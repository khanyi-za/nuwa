import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PushService } from '../../notifications/push.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Paginated } from '../common/paginated';

/**
 * Buyer-facing notifications surface (the in-app inbox + push-token registry).
 * Reads the `Notification` rows the backend NotificationsService writes; the
 * push-token endpoints delegate to the shared PushService.
 */
@Injectable()
export class MobileNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** GET /api/me/notifications — cursor-paginated inbox + live unread count. */
  async list(userId: string, opts: { limit: number; cursor?: string }) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor
        ? { cursor: { id: decodeCursor(opts.cursor) }, skip: 1 }
        : {}),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        isRead: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > opts.limit;
    const page = hasMore ? rows.slice(0, opts.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return new Paginated(
      { notifications: page, unreadCount },
      { limit: opts.limit, nextCursor, hasMore },
    );
  }

  /** GET /api/me/notifications/unread-count — badge count. */
  async unreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  /** PATCH /api/me/notifications/:id/read — mark one read (404 if not owned). */
  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    if (res.count === 0) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    return { id, isRead: true };
  }

  /** POST /api/me/notifications/read-all — mark every unread notification read. */
  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: res.count };
  }

  /** POST /api/me/push-tokens — register this device's Expo push token. */
  async registerPushToken(userId: string, token: string, platform: string) {
    await this.push.registerToken(userId, token, platform);
    return { registered: true };
  }

  /** DELETE /api/me/push-tokens — drop this device's token (logout). */
  async removePushToken(userId: string, token: string) {
    await this.push.removeToken(userId, token);
    return { removed: true };
  }
}
