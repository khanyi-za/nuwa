import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  ShipLogicApiError,
  ShipLogicClient,
} from './shiplogic/shiplogic-client.service';

/**
 * Cancels a previously-booked ShipLogic shipment when the buyer or merchant
 * cancels an order. Called by `BuyerOrdersService.cancelOrder` (and later by
 * admin/merchant cancel flows) after the Order is flipped to CANCELLED.
 *
 * No-op if no Shipment row exists yet (Order was still PENDING — shipment
 * was never booked). Best-effort: a ShipLogic cancel failure does NOT undo
 * the local Order cancellation; that's a ops/reconciliation surface.
 */
@Injectable()
export class ShipmentCancellationService {
  private readonly logger = new Logger(ShipmentCancellationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ShipLogicClient,
  ) {}

  /**
   * Cancel the ShipLogic shipment tied to this order, if any. Returns true
   * if a cancel was attempted (and succeeded), false if there was no
   * shipment to cancel. Throws only on truly unrecoverable internal errors;
   * ShipLogic-side cancel failures are logged + swallowed.
   */
  async cancelShipmentForOrder(orderId: string): Promise<boolean> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { orderId },
    });
    if (!shipment) {
      // No shipment yet — Order was probably still PENDING when cancelled.
      return false;
    }
    if (!shipment.waybillNumber) {
      this.logger.warn(
        `Shipment ${shipment.id} for order ${orderId} has no waybillNumber — skipping ShipLogic cancel`,
      );
      return false;
    }

    try {
      await this.client.postJson('/shipments/cancel', {
        tracking_reference: shipment.waybillNumber,
      });
    } catch (err) {
      // ShipLogic refuses to cancel collected/in-transit shipments — that's
      // expected. Log so ops can intervene; do NOT throw (the Order is
      // already CANCELLED locally; we don't want to roll that back).
      if (err instanceof ShipLogicApiError) {
        this.logger.warn(
          `ShipLogic cancel rejected for waybill ${shipment.waybillNumber}: ${err.status} ${err.responseBody.slice(0, 200)}`,
        );
      } else {
        this.logger.error(
          `ShipLogic cancel failed for waybill ${shipment.waybillNumber}: ${(err as Error).message}`,
        );
      }
      return false;
    }

    return true;
  }
}
