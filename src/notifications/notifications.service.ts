import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PushService } from './push.service';
import {
  orderCancelledEmail,
  orderConfirmedEmail,
  orderDeliveredEmail,
  orderRefundedEmail,
  orderShippedEmail,
} from '../email/templates/order-emails';

function rand(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

/**
 * Orchestrates buyer notifications: writes the in-app inbox row, sends the push,
 * and sends the email — each independently best-effort. A failure in any channel
 * is logged and swallowed so it NEVER breaks the payment/shipping flow that
 * triggered it (same contract as the post-ITN shipment-booking side-effect).
 *
 * `data.orderId` is always the PaymentGroup id (the maya "order"), so a
 * notification tap deep-links straight into GET /api/orders/:id.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly push: PushService,
  ) {}

  /** Fire once per maya order (PaymentGroup) when its payment completes. */
  async orderConfirmed(paymentGroupId: string): Promise<void> {
    const ctx = await this.loadGroupContext(paymentGroupId);
    if (!ctx) return;
    await this.dispatch({
      userId: ctx.userId,
      type: NotificationType.ORDER_CONFIRMED,
      title: 'Order confirmed',
      body: `Payment received for ${ctx.orderNumber}. The merchant is preparing your order.`,
      data: { orderId: paymentGroupId, orderNumber: ctx.orderNumber },
      email: ctx.email
        ? {
            to: ctx.email,
            subject: `Order confirmed — ${ctx.orderNumber}`,
            html: orderConfirmedEmail(ctx.firstName, ctx.orderNumber, ctx.total),
          }
        : undefined,
    });
  }

  async paymentFailed(paymentGroupId: string): Promise<void> {
    const ctx = await this.loadGroupContext(paymentGroupId);
    if (!ctx) return;
    await this.dispatch({
      userId: ctx.userId,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment failed',
      body: `We couldn't confirm payment for ${ctx.orderNumber}. No charge was made.`,
      data: { orderId: paymentGroupId, orderNumber: ctx.orderNumber },
    });
  }

  /** Order shipped (dispatched) / delivered, fired from the ShipLogic webhook. */
  async orderStatusChanged(orderId: string, stage: 'shipped' | 'delivered'): Promise<void> {
    const ctx = await this.loadOrderContext(orderId);
    if (!ctx) return;
    const shipped = stage === 'shipped';
    await this.dispatch({
      userId: ctx.userId,
      type: shipped ? NotificationType.ORDER_SHIPPED : NotificationType.ORDER_DELIVERED,
      title: shipped ? 'Order on its way' : 'Order delivered',
      body: shipped
        ? `${ctx.orderNumber} has been handed to The Courier Guy.`
        : `${ctx.orderNumber} has been delivered. Enjoy!`,
      data: { orderId: ctx.deepLinkId, orderNumber: ctx.orderNumber },
      email: ctx.email
        ? {
            to: ctx.email,
            subject: `${shipped ? 'Order on its way' : 'Order delivered'} — ${ctx.orderNumber}`,
            html: shipped
              ? orderShippedEmail(ctx.firstName, ctx.orderNumber)
              : orderDeliveredEmail(ctx.firstName, ctx.orderNumber),
          }
        : undefined,
    });
  }

  async orderCancelled(orderId: string): Promise<void> {
    const ctx = await this.loadOrderContext(orderId);
    if (!ctx) return;
    await this.dispatch({
      userId: ctx.userId,
      type: NotificationType.ORDER_CANCELLED,
      title: 'Order cancelled',
      body: `${ctx.orderNumber} has been cancelled.`,
      data: { orderId: ctx.deepLinkId, orderNumber: ctx.orderNumber },
      email: ctx.email
        ? {
            to: ctx.email,
            subject: `Order cancelled — ${ctx.orderNumber}`,
            html: orderCancelledEmail(ctx.firstName, ctx.orderNumber),
          }
        : undefined,
    });
  }

  async refund(orderId: string, amountInCents: number, full: boolean): Promise<void> {
    const ctx = await this.loadOrderContext(orderId);
    if (!ctx) return;
    await this.dispatch({
      userId: ctx.userId,
      type: NotificationType.SYSTEM,
      title: full ? 'Refund processing' : 'Partial refund processing',
      body: `A refund of ${rand(amountInCents)} for ${ctx.orderNumber} is being processed.`,
      data: { orderId: ctx.deepLinkId, orderNumber: ctx.orderNumber },
      email: ctx.email
        ? {
            to: ctx.email,
            subject: `Refund processing — ${ctx.orderNumber}`,
            html: orderRefundedEmail(ctx.firstName, ctx.orderNumber, amountInCents, full),
          }
        : undefined,
    });
  }

  // ── Core dispatch ──────────────────────────────────────────────────────────

  private async dispatch(args: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    email?: { to: string; subject: string; html: string };
  }): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: args.userId,
          type: args.type,
          title: args.title,
          body: args.body,
          data: args.data as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Inbox row failed (${args.type}, user ${args.userId}): ${(err as Error).message}`,
      );
    }

    await this.push.sendToUser(args.userId, {
      title: args.title,
      body: args.body,
      data: args.data,
    });

    if (args.email) {
      await this.email.send(args.email);
    }
  }

  // ── Context loaders ──────────────────────────────────────────────────────────

  private async loadGroupContext(paymentGroupId: string) {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: paymentGroupId },
      select: {
        amountGrossInCents: true,
        payments: {
          select: {
            order: {
              select: {
                orderNumber: true,
                user: { select: { id: true, email: true, firstName: true } },
              },
            },
          },
        },
      },
    });
    const rep = group?.payments[0]?.order;
    if (!group || !rep) return null;
    return {
      userId: rep.user.id,
      email: rep.user.email,
      firstName: rep.user.firstName,
      orderNumber: rep.orderNumber,
      total: group.amountGrossInCents,
    };
  }

  private async loadOrderContext(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        user: { select: { id: true, email: true, firstName: true } },
        payment: { select: { paymentGroupId: true } },
      },
    });
    if (!order) return null;
    return {
      userId: order.user.id,
      email: order.user.email,
      firstName: order.user.firstName,
      orderNumber: order.orderNumber,
      // maya keys order detail/tracking off the PaymentGroup id; fall back to the
      // Order id if somehow unpaid (shouldn't happen past confirmation).
      deepLinkId: order.payment?.paymentGroupId ?? orderId,
    };
  }
}
