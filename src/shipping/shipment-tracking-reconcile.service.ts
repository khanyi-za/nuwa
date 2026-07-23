import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicClient } from './shiplogic/shiplogic-client.service';
import { ShipmentStatusApplyService } from './shipment-status-apply.service';

// Only poll rows webhooks haven't touched recently — when delivery works,
// this job does (nearly) nothing; when it doesn't, drift is bounded to ~45min.
const STALE_AFTER_MS = 45 * 60 * 1000;
const BATCH_SIZE = 50;

/** In-flight shipment states worth polling. DELIVERED/RETURNED are terminal. */
const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.PENDING,
  ShipmentStatus.COLLECTED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.FAILED_DELIVERY, // re-attempts can still progress to delivered
];

/** Orders already terminal don't need tracking updates. */
const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

export interface TrackingReconcileSummary {
  candidates: number;
  updated: number;
  unchanged: number;
  failed: number;
}

/* Shape of a shipment as returned by GET /shipments (only what we read). */
interface ShipLogicShipmentView {
  short_tracking_reference?: string;
  status?: string;
  latest_tracking_event_time?: string | null;
  collected_date?: string | null;
  delivered_date?: string | null;
  tracking_events?:
    | { status?: string; message?: string; location?: string; date?: string }[]
    | null;
}

/**
 * ShipmentTrackingReconcileService — the polling safety net for tracking
 * webhooks (the missed-webhook lesson: ShipLogic sandbox delivered ZERO
 * webhooks in testing, and production delivery is unproven — without this,
 * missed webhooks freeze orders at CONFIRMED forever).
 *
 * Every 30 min: find in-flight shipments whose row hasn't moved in 45+ min,
 * fetch current state via `GET /shipments?tracking_reference=` (the
 * documented polling fallback), and apply any status change through the SAME
 * ShipmentStatusApplyService the webhook uses — same mapping, same CAS
 * guards, same notifications. Webhooks remain the fast path; this bounds
 * drift when they don't arrive.
 *
 * Per-shipment failures are isolated. Also manually triggerable via
 * POST /admin/shipping/reconcile-tracking (production smoke tool).
 */
@Injectable()
export class ShipmentTrackingReconcileService {
  private readonly logger = new Logger(ShipmentTrackingReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShipLogicClient,
    private readonly statusApply: ShipmentStatusApplyService,
  ) {}

  // Off the hour/half-hour marks to stay clear of the other crons' boundaries.
  @Cron('10,40 * * * *')
  async reconcileTracking(): Promise<TrackingReconcileSummary> {
    const staleCutoff = new Date(Date.now() - STALE_AFTER_MS);
    const candidates = await this.prisma.shipment.findMany({
      where: {
        waybillNumber: { not: null },
        status: { in: ACTIVE_SHIPMENT_STATUSES },
        updatedAt: { lt: staleCutoff },
        order: { status: { notIn: TERMINAL_ORDER_STATUSES } },
      },
      orderBy: { updatedAt: 'asc' }, // longest-unrefreshed first
      take: BATCH_SIZE,
      select: {
        id: true,
        waybillNumber: true,
        shiplogicStatus: true,
      },
    });

    const summary: TrackingReconcileSummary = {
      candidates: candidates.length,
      updated: 0,
      unchanged: 0,
      failed: 0,
    };
    if (candidates.length === 0) return summary;

    for (const shipment of candidates) {
      try {
        const view = await this.fetchShipment(shipment.waybillNumber!);
        const rawStatus = view?.status?.trim();
        if (!view || !rawStatus) {
          // Unknown at ShipLogic (or shape we don't recognise) — ops signal,
          // not something to guess at.
          this.logger.warn(
            `Reconcile: no trackable state for waybill ${shipment.waybillNumber} (shipment ${shipment.id})`,
          );
          summary.failed++;
          continue;
        }

        if (rawStatus === shipment.shiplogicStatus) {
          // No drift — touch updatedAt so the stale filter skips this row for
          // the next 45 min instead of re-polling it every run.
          await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: { shiplogicStatus: rawStatus },
          });
          summary.unchanged++;
          continue;
        }

        const latest = this.latestTrackingEvent(view, rawStatus);
        await this.statusApply.apply({
          shipmentId: shipment.id,
          rawStatus,
          eventTime: this.parseTime(
            latest?.date ??
              view.latest_tracking_event_time ??
              view.delivered_date ??
              view.collected_date,
          ),
          hub: latest?.location ?? null,
          message: latest?.message || null,
        });
        summary.updated++;
        this.logger.log(
          `Reconcile: ${shipment.waybillNumber} ${shipment.shiplogicStatus ?? '∅'} → ${rawStatus} (missed webhook recovered)`,
        );
      } catch (err) {
        summary.failed++;
        this.logger.error(
          `Reconcile failed for waybill ${shipment.waybillNumber}: ${(err as Error).message} — continuing with the rest`,
        );
      }
    }

    this.logger.log(
      `Tracking reconcile: ${summary.candidates} checked, ${summary.updated} updated, ${summary.unchanged} unchanged, ${summary.failed} failed`,
    );
    return summary;
  }

  /**
   * GET /shipments?tracking_reference= — documented to return "a list of
   * shipments or a specific shipment"; handle every plausible envelope.
   */
  private async fetchShipment(
    waybill: string,
  ): Promise<ShipLogicShipmentView | null> {
    const data = await this.client.getJson<unknown>(
      `/shipments?tracking_reference=${encodeURIComponent(waybill)}`,
    );
    return this.pickShipment(data, waybill);
  }

  private pickShipment(
    data: unknown,
    waybill: string,
  ): ShipLogicShipmentView | null {
    if (!data) return null;
    if (Array.isArray(data)) {
      const list = data as ShipLogicShipmentView[];
      return (
        list.find((s) => s.short_tracking_reference === waybill) ??
        list[0] ??
        null
      );
    }
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj['shipments'])) {
      return this.pickShipment(obj['shipments'], waybill);
    }
    if (typeof obj['status'] === 'string') {
      return obj as ShipLogicShipmentView;
    }
    return null;
  }

  /** The tracking_events entry matching the current status, if present. */
  private latestTrackingEvent(
    view: ShipLogicShipmentView,
    rawStatus: string,
  ): { message?: string; location?: string; date?: string } | null {
    const events = view.tracking_events;
    if (!Array.isArray(events)) return null;
    return events.find((e) => e.status === rawStatus) ?? events[0] ?? null;
  }

  private parseTime(value: string | null | undefined): Date | null {
    if (typeof value !== 'string') return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
