import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapShipLogicStatus } from './shipping-status-map';
import { NotificationsService } from '../notifications/notifications.service';

export interface ApplyStatusInput {
  shipmentId: string;
  rawStatus: string;
  eventTime: Date | null;
  hub: string | null;
  message: string | null;
  /**
   * When set, the ShipmentEvent row with this payloadHash is marked
   * processed INSIDE the same transaction (webhook path). The reconcile
   * path has no event row and omits it.
   */
  markEventPayloadHash?: string;
}

/**
 * ShipmentStatusApplyService — the single place a raw ShipLogic status is
 * applied to YIIVA state. Extracted from ShippingWebhookService so the
 * tracking-reconcile poller applies statuses through the EXACT same rules:
 *
 *   - Shipment.shiplogicStatus always updated (raw, for admin triage)
 *   - Shipment.status + collectedAt/deliveredAt when the mapping says so
 *   - buyer-visible ShipmentTrackingEvent row on mappable progress
 *   - Order.status via CAS guards (forward-only; delayed/out-of-order
 *     events silently no-op) + dispatchedAt/deliveredAt/cancelReason
 *   - shipped/delivered notification fired AFTER commit, and only when the
 *     Order actually transitioned (CAS matched a row)
 *
 * Whole apply is one transaction; the caller owns error handling.
 */
@Injectable()
export class ShipmentStatusApplyService {
  private readonly logger = new Logger(ShipmentStatusApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Returns true when the Order made a real forward transition. */
  async apply(input: ApplyStatusInput): Promise<boolean> {
    const { shipmentId, rawStatus, eventTime, hub, message } = input;
    const mapping = mapShipLogicStatus(rawStatus);

    // Set inside the TX only when the Order actually transitions (CAS matched);
    // fired AFTER commit so a no-op (delayed/out-of-order event) doesn't notify.
    const notify = await this.prisma.$transaction(async (tx) => {
      let transitioned: { orderId: string; stage: 'shipped' | 'delivered' } | null =
        null;
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, orderId: true, status: true, shiplogicStatus: true },
      });
      if (!shipment) {
        this.logger.warn(
          `Shipment ${shipmentId} disappeared before status apply — skipping`,
        );
        return null;
      }

      // Always update the raw status on Shipment for the admin tool.
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          shiplogicStatus: rawStatus,
          ...(mapping.shipmentStatus
            ? { status: mapping.shipmentStatus }
            : {}),
          ...(mapping.shipmentStatus === 'COLLECTED'
            ? { collectedAt: eventTime ?? new Date() }
            : {}),
          ...(mapping.shipmentStatus === 'DELIVERED'
            ? { deliveredAt: eventTime ?? new Date() }
            : {}),
        },
      });

      // Append a buyer-visible tracking row when we got mappable progress.
      if (mapping.shipmentStatus || mapping.orderStatus) {
        await tx.shipmentTrackingEvent.create({
          data: {
            shipmentId,
            status: rawStatus,
            description: message,
            location: hub,
            timestamp: eventTime ?? new Date(),
          },
        });
      }

      // Transition the Order — CAS-style: only forward, never backward,
      // and never overwrite a CANCELLED/REFUNDED terminal state.
      if (mapping.orderStatus) {
        const guardStatuses = this.allowedSourceStatusesFor(mapping.orderStatus);
        const res = await tx.order.updateMany({
          where: {
            id: shipment.orderId,
            status: { in: guardStatuses },
          },
          data: {
            status: mapping.orderStatus,
            ...(mapping.orderStatus === 'DISPATCHED'
              ? { dispatchedAt: eventTime ?? new Date() }
              : {}),
            ...(mapping.orderStatus === 'DELIVERED'
              ? { deliveredAt: eventTime ?? new Date() }
              : {}),
            ...(mapping.cancelReason
              ? {
                  cancelReason: mapping.cancelReason,
                  cancelledAt: eventTime ?? new Date(),
                }
              : {}),
          },
        });
        // Notify only on a real forward transition (CAS matched a row).
        if (res.count > 0) {
          if (mapping.orderStatus === 'DISPATCHED') {
            transitioned = { orderId: shipment.orderId, stage: 'shipped' };
          } else if (mapping.orderStatus === 'DELIVERED') {
            transitioned = { orderId: shipment.orderId, stage: 'delivered' };
          }
        }
      }

      if (input.markEventPayloadHash) {
        await tx.shipmentEvent.update({
          where: { payloadHash: input.markEventPayloadHash },
          data: { processed: true, processError: null },
        });
      }

      return transitioned;
    });

    // Best-effort, post-commit.
    if (notify) {
      await this.notifications.orderStatusChanged(notify.orderId, notify.stage);
      return true;
    }
    return false;
  }

  /**
   * Which Order.status values are valid predecessors for the target. Prevents
   * out-of-order events from regressing the state machine (e.g. a delayed
   * 'collected' event after we already saw 'delivered').
   */
  private allowedSourceStatusesFor(target: OrderStatus): OrderStatus[] {
    switch (target) {
      case OrderStatus.DISPATCHED:
        return [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.READY_FOR_DISPATCH,
        ];
      case OrderStatus.IN_TRANSIT:
        return [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.READY_FOR_DISPATCH,
          OrderStatus.DISPATCHED,
        ];
      case OrderStatus.DELIVERED:
        return [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.READY_FOR_DISPATCH,
          OrderStatus.DISPATCHED,
          OrderStatus.IN_TRANSIT,
        ];
      case OrderStatus.CANCELLED:
        // ShipLogic cancellations don't override REFUNDED/REFUND_REQUESTED.
        return [
          OrderStatus.PENDING,
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.READY_FOR_DISPATCH,
          OrderStatus.DISPATCHED,
          OrderStatus.IN_TRANSIT,
        ];
      default:
        return [];
    }
  }
}
