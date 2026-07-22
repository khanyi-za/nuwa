import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifySyncService } from './shopify-sync.service';

/**
 * ShopifySyncCronService — nightly reconcile across all synced connections
 * (03:15, off the hour to dodge other crons). The safety net for missed
 * webhooks: ShipLogic taught us webhook delivery can't be trusted until
 * proven in production, so stock/price/existence drift is repaired from a
 * full pull once a day regardless.
 *
 * Per-connection failures are isolated — one dead shop must not stop the
 * others' reconcile.
 */
@Injectable()
export class ShopifySyncCronService {
  private readonly logger = new Logger(ShopifySyncCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ShopifySyncService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async reconcileAll(): Promise<void> {
    const connections = await this.prisma.shopifyConnection.findMany({
      where: { status: 'ACTIVE', storeId: { not: null } },
      select: { id: true, shopDomain: true },
    });
    if (connections.length === 0) return;

    this.logger.log(
      `Nightly Shopify reconcile: ${connections.length} connection(s)`,
    );
    for (const connection of connections) {
      try {
        await this.sync.reconcileConnection(connection.id);
      } catch (err) {
        this.logger.error(
          `Reconcile failed for ${connection.shopDomain}: ${(err as Error).message} — continuing with the rest`,
        );
      }
    }
  }
}
