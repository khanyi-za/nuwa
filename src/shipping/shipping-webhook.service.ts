import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Prisma, ShipmentEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import { ShipmentStatusApplyService } from './shipment-status-apply.service';

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
 *   - Delegate to ShipmentStatusApplyService (shared with the tracking
 *     reconcile poller): status map, Shipment update, tracking-event row,
 *     Order CAS transition, notifications.
 */
@Injectable()
export class ShippingWebhookService {
  private readonly logger = new Logger(ShippingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShipLogicConfig,
    private readonly statusApply: ShipmentStatusApplyService,
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
      await this.applyTrackingEvent(
        shipmentId,
        payload,
        rawStatus,
        payloadHash,
      );
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
    try {
      const latest = this.latestTrackingEvent(payload, rawStatus);
      await this.statusApply.apply({
        shipmentId,
        rawStatus,
        eventTime: this.extractEventTime(payload),
        hub: latest?.location?.trim() || this.extractHub(payload),
        message: latest?.message?.trim() || this.extractMessage(payload),
        markEventPayloadHash: payloadHash,
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      this.logger.error(
        `Failed to apply tracking event (payloadHash=${payloadHash}): ${msg}`,
      );
      await this.markProcessed(payloadHash, msg).catch(() => undefined);
      throw err;
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

  /**
   * The tracking_events entry for the current status (first match = newest;
   * real payloads sort the array newest-first). Real TCG deliveries carry
   * the useful location ("JNB", "RUS") and buyer-facing message ("PIN
   * entered successfully") HERE — the top-level collection_hub/delivery_hub
   * are empty strings and there is no top-level message (verified against
   * production samples in docs/thecourierguy/TCGTrack_Webhook.txt).
   */
  private latestTrackingEvent(
    payload: Record<string, unknown>,
    rawStatus: string,
  ): { location?: string; message?: string } | null {
    const events = payload['tracking_events'];
    if (!Array.isArray(events)) return null;
    const typed = events as { status?: string; location?: string; message?: string }[];
    return typed.find((e) => e.status === rawStatus) ?? typed[0] ?? null;
  }

  private extractHub(payload: Record<string, unknown>): string | null {
    const v =
      payload['collection_hub'] ??
      payload['delivery_hub'] ??
      payload['hub'];
    // Production payloads carry "" here — treat as absent.
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

  private extractMessage(payload: Record<string, unknown>): string | null {
    const v = payload['message'];
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    );
  }
}
