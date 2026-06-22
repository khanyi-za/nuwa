import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { OrderStatus, Prisma, ShipmentEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import { mapShipLogicStatus } from './shipping-status-map';
import { NotificationsService } from '../notifications/notifications.service';

export type WebhookOutcome =
  | 'accepted'
  | 'duplicate'      // payloadHash already in ShipmentEvent (replay)
  | 'unauthenticated' // secret mismatch or no secret configured
  | 'ip_rejected'    // source IP not in allowlist
  | 'malformed';     // payload not parseable as JSON

/**
 * Ingests inbound ShipLogic webhooks. Mirrors the PaymentsNotifyService
 * pattern from the payments module: receive → validate → idempotency-check
 * via unique payloadHash → apply state → mark processed.
 *
 * Triggered from the public webhook controller. Returns a `WebhookOutcome`
 * tag the controller maps to HTTP responses:
 *   - 'accepted' / 'duplicate' → 200 (ShipLogic should NOT retry)
 *   - 'unauthenticated' / 'ip_rejected' → 404 (stealth — looks like a wrong URL)
 *   - 'malformed' → 400
 *
 * Security:
 *   - Path-embedded secret (constant-time compare against config.webhookSecret).
 *   - Optional IP allowlist via config.webhookIpAllowlist (empty = no check).
 *
 * Idempotency:
 *   - Body is hashed (SHA-256). Insert into ShipmentEvent races against the
 *     unique constraint on payloadHash; failure = replay → 200 no-op.
 *
 * State application:
 *   - Match `short_tracking_reference` from payload to `Shipment.waybillNumber`.
 *   - Map raw ShipLogic status to YIIVA OrderStatus via shipping-status-map.
 *   - Update Shipment row + (if mapping is non-null) Order row.
 *   - Append a buyer-visible ShipmentTrackingEvent row for TRACKING_EVENT
 *     types that resulted in a buyer-facing status change.
 */
@Injectable()
export class ShippingWebhookService {
  private readonly logger = new Logger(ShippingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShipLogicConfig,
    private readonly notifications: NotificationsService,
  ) {}

  async ingest(args: {
    secret: string | undefined | null;
    sourceIp: string | undefined | null;
    rawBody: string;
  }): Promise<WebhookOutcome> {
    if (!this.checkSecret(args.secret)) return 'unauthenticated';
    if (!this.checkIp(args.sourceIp)) return 'ip_rejected';

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(args.rawBody);
    } catch {
      return 'malformed';
    }

    const payloadHash = createHash('sha256')
      .update(args.rawBody, 'utf8')
      .digest('hex');

    const eventType = this.detectEventType(payload);
    const waybill = this.extractWaybill(payload);
    const rawStatus = typeof payload['status'] === 'string'
      ? (payload['status'] as string)
      : null;

    // Best-effort match — null shipmentId is fine, we still persist the row.
    let shipmentId: string | null = null;
    if (waybill) {
      const ship = await this.prisma.shipment.findUnique({
        where: { waybillNumber: waybill },
        select: { id: true },
      });
      shipmentId = ship?.id ?? null;
    }

    // INSERT with unique payloadHash; on conflict → replay → ack 200 no-op.
    try {
      await this.prisma.shipmentEvent.create({
        data: {
          shipmentId,
          waybillNumber: waybill ?? '',
          payloadHash,
          eventType,
          rawStatus,
          payload: payload as unknown as Prisma.InputJsonValue,
          sourceIp: args.sourceIp ?? null,
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintViolation(err)) {
        return 'duplicate';
      }
      throw err;
    }

    // Side effects — only for tracking events that match a known shipment +
    // produce a non-null status mapping. Everything else is audit-only.
    if (
      eventType === ShipmentEventType.TRACKING_EVENT &&
      shipmentId &&
      rawStatus
    ) {
      await this.applyTrackingEvent(shipmentId, payload, rawStatus, payloadHash);
    } else {
      // Mark processed even for audit-only events so we don't keep retrying.
      await this.markProcessed(payloadHash, null);
    }

    return 'accepted';
  }

  // ─── State application ──────────────────────────────────────────────────────

  private async applyTrackingEvent(
    shipmentId: string,
    payload: Record<string, unknown>,
    rawStatus: string,
    payloadHash: string,
  ): Promise<void> {
    const mapping = mapShipLogicStatus(rawStatus);
    const eventTime = this.extractEventTime(payload);
    const hub = this.extractHub(payload);

    // Set inside the TX only when the Order actually transitions (CAS matched);
    // fired AFTER commit so a no-op (delayed/out-of-order event) doesn't notify.
    let notify: { orderId: string; stage: 'shipped' | 'delivered' } | null = null;

    try {
      notify = await this.prisma.$transaction(async (tx) => {
        let transitioned: { orderId: string; stage: 'shipped' | 'delivered' } | null =
          null;
        const shipment = await tx.shipment.findUnique({
          where: { id: shipmentId },
          select: { id: true, orderId: true, status: true, shiplogicStatus: true },
        });
        if (!shipment) {
          this.logger.warn(
            `Shipment ${shipmentId} disappeared between event INSERT and apply — skipping`,
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
              description: this.extractMessage(payload),
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

        await tx.shipmentEvent.update({
          where: { payloadHash },
          data: { processed: true, processError: null },
        });

        return transitioned;
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      this.logger.error(
        `Failed to apply tracking event (payloadHash=${payloadHash}): ${msg}`,
      );
      await this.markProcessed(payloadHash, msg).catch(() => undefined);
      throw err;
    }

    // Best-effort, post-commit (the catch above rethrows, so we only reach here
    // on a successful apply).
    if (notify) {
      await this.notifications.orderStatusChanged(notify.orderId, notify.stage);
    }
  }

  private async markProcessed(
    payloadHash: string,
    error: string | null,
  ): Promise<void> {
    await this.prisma.shipmentEvent.update({
      where: { payloadHash },
      data: { processed: error === null, processError: error },
    });
  }

  // ─── Source validators ─────────────────────────────────────────────────────

  private checkSecret(received: string | undefined | null): boolean {
    const expected = this.config.webhookSecret;
    if (!expected) return false; // webhook disabled when secret unset
    if (!received) return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  private checkIp(sourceIp: string | undefined | null): boolean {
    const allow = this.config.webhookIpAllowlist;
    if (!allow || allow.length === 0) return true; // no list = no IP gate
    if (!sourceIp) return false;
    // Strip IPv4-mapped IPv6 prefix.
    const ip = sourceIp.replace(/^::ffff:/, '');
    return allow.includes(ip);
  }

  // ─── Payload helpers ───────────────────────────────────────────────────────

  private detectEventType(payload: unknown): ShipmentEventType {
    // Array form (currently only Parcel dimension changes per the Postman docs)
    if (Array.isArray(payload)) {
      return ShipmentEventType.DIMENSION_CHANGE;
    }
    const obj = payload as Record<string, unknown>;
    if (obj && typeof obj === 'object') {
      if ('new_delivery_address' in obj) return ShipmentEventType.ADDRESS_CHANGE;
      if ('tracking_events' in obj || 'update_type' in obj)
        return ShipmentEventType.TRACKING_EVENT;
      if ('message' in obj && 'shipment_id' in obj)
        return ShipmentEventType.SHIPMENT_NOTE;
    }
    // Default to TRACKING_EVENT for forward compatibility — if a new tracking
    // payload shape arrives we'd rather treat it as a tracking event and
    // discover the shape than swallow it.
    return ShipmentEventType.TRACKING_EVENT;
  }

  private extractWaybill(payload: unknown): string | null {
    if (Array.isArray(payload) && payload[0] && typeof payload[0] === 'object') {
      const first = payload[0] as Record<string, unknown>;
      if (typeof first['shipment_tracking_reference'] === 'string') {
        return first['shipment_tracking_reference'] as string;
      }
    }
    const obj = payload as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj['short_tracking_reference'] === 'string')
      return obj['short_tracking_reference'] as string;
    if (typeof obj['shipment_short_tracking_reference'] === 'string')
      return obj['shipment_short_tracking_reference'] as string;
    if (typeof obj['shipment_tracking_reference'] === 'string')
      return obj['shipment_tracking_reference'] as string;
    return null;
  }

  private extractEventTime(payload: Record<string, unknown>): Date | null {
    const v = payload['event_time'] ?? payload['time_created'];
    if (typeof v !== 'string') return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private extractHub(payload: Record<string, unknown>): string | null {
    const v =
      payload['collection_hub'] ??
      payload['delivery_hub'] ??
      payload['hub'];
    return typeof v === 'string' ? v : null;
  }

  private extractMessage(payload: Record<string, unknown>): string | null {
    const v = payload['message'];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /**
   * Which Order.status values are valid predecessors for the target. Prevents
   * out-of-order webhooks from regressing the state machine (e.g. a delayed
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

  private isUniqueConstraintViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    );
  }
}
