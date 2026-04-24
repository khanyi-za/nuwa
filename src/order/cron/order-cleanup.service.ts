import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { releaseStock } from '../cart/stock';

const STALE_CART_HOURS = 24;
const PENDING_ORDER_MINUTES = 30;
const BATCH_SIZE = 100;

@Injectable()
export class OrderCleanupService {
  private readonly logger = new Logger(OrderCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every 5 minutes. Handles two cleanup tasks:
   * 1. Release stock reservations on stale carts (24h no activity)
   * 2. Expire PENDING orders (30 min with no payment)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCleanup(): Promise<void> {
    await this.releaseStaleCartReservations();
    await this.expirePendingOrders();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STALE CART RESERVATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Release stock reservations for cart items in carts that haven't been
   * touched in 24 hours. The cart items themselves are kept — they become
   * "unreserved" and will be re-reserved on the next checkout attempt.
   *
   * Staleness is per-cart: if ANY item was updated recently, the whole cart
   * is considered fresh.
   */
  async releaseStaleCartReservations(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_CART_HOURS * 60 * 60 * 1000);
    let totalReleased = 0;

    // Loop in batches until no more stale carts.
    while (true) {
      const staleCarts = await this.prisma.cart.findMany({
        where: {
          updatedAt: { lt: cutoff },
          items: {
            some: {}, // only carts with items
          },
        },
        select: {
          id: true,
          items: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
            },
          },
        },
        take: BATCH_SIZE,
      });

      if (staleCarts.length === 0) break;

      for (const cart of staleCarts) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // Release stock for each item in the stale cart.
            for (const item of cart.items) {
              await releaseStock(
                tx,
                item.productId,
                item.variantId,
                item.quantity,
              );
            }

            // Touch the cart's updatedAt so we don't reprocess it next cycle.
            // Items stay — they're just unreserved now.
            await tx.cart.update({
              where: { id: cart.id },
              data: { updatedAt: new Date() },
            });
          });

          totalReleased += cart.items.length;
        } catch (err) {
          // Log and continue — don't let one bad cart block the whole batch.
          this.logger.error(
            `Failed to release reservations for cart ${cart.id}: ${(err as Error).message}`,
          );

          // Bump updatedAt so this cart isn't re-processed every cycle.
          // Without this, a persistently failing cart would be retried
          // every 5 minutes indefinitely.
          try {
            await this.prisma.cart.update({
              where: { id: cart.id },
              data: { updatedAt: new Date() },
            });
          } catch {
            // If even the bump fails, we'll retry next cycle — acceptable.
          }
        }
      }

      // If we got fewer than BATCH_SIZE, we're done.
      if (staleCarts.length < BATCH_SIZE) break;
    }

    if (totalReleased > 0) {
      this.logger.log(
        `Released reservations for ${totalReleased} stale cart items`,
      );
    }

    return totalReleased;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PENDING ORDER EXPIRY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Expire PENDING orders that were created more than 30 minutes ago with
   * no payment received. Releases stock reservations and sets status to
   * CANCELLED. PaymentGroup and Payments are kept for audit.
   */
  async expirePendingOrders(): Promise<number> {
    const cutoff = new Date(
      Date.now() - PENDING_ORDER_MINUTES * 60 * 1000,
    );
    let totalExpired = 0;

    while (true) {
      const pendingOrders = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING,
          createdAt: { lt: cutoff },
        },
        select: {
          id: true,
          items: {
            select: {
              productId: true,
              variantId: true,
              quantity: true,
            },
          },
        },
        take: BATCH_SIZE,
      });

      if (pendingOrders.length === 0) break;

      for (const order of pendingOrders) {
        try {
          await this.prisma.$transaction(async (tx) => {
            // Release stock reservations for each order item.
            for (const item of order.items) {
              await releaseStock(
                tx,
                item.productId,
                item.variantId,
                item.quantity,
              );
            }

            // Cancel the order.
            await tx.order.update({
              where: { id: order.id },
              data: {
                status: OrderStatus.CANCELLED,
                cancelReason: 'SYSTEM:PAYMENT_TIMEOUT',
                cancelledAt: new Date(),
              },
            });
          });

          totalExpired++;
        } catch (err) {
          this.logger.error(
            `Failed to expire pending order ${order.id}: ${(err as Error).message}`,
          );
        }
      }

      if (pendingOrders.length < BATCH_SIZE) break;
    }

    if (totalExpired > 0) {
      this.logger.log(`Expired ${totalExpired} pending orders`);
    }

    return totalExpired;
  }
}
