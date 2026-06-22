import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: string;
  details?: { error?: string };
}

/**
 * Expo push delivery + device-token storage. All sends are best-effort — a push
 * failure must never break the payment/shipping flow that triggered it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Upsert a device's Expo push token for a user (idempotent on the token). */
  async registerToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastUsedAt: new Date() },
    });
  }

  /** Remove a device token (logout / sign-out on that device). */
  async removeToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  /** Fan a notification out to all of a user's registered devices. Never throws. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: 'default',
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push returned HTTP ${res.status} for user ${userId}`);
        return;
      }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      await this.pruneInvalid(
        tokens.map((t) => t.token),
        json.data ?? [],
      );
    } catch (err) {
      this.logger.warn(`Push send failed for user ${userId}: ${(err as Error).message}`);
    }
  }

  /** Drop tokens Expo reports as DeviceNotRegistered so we stop pushing to them. */
  private async pruneInvalid(tokens: string[], tickets: ExpoTicket[]): Promise<void> {
    const dead = tickets
      .map((ticket, i) =>
        ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
          ? tokens[i]
          : null,
      )
      .filter((t): t is string => !!t);
    if (dead.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
    }
  }
}
