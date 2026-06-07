import { OrderStatus, ShipmentStatus } from '@prisma/client';

/**
 * Pure function: map a raw ShipLogic shipment status to the YIIVA-internal
 * counterparts. Returns the projection in two parts:
 *   - `orderStatus`: target Order.status, or null if this event does not move
 *     the buyer-facing Order forward (logged on Shipment.shiplogicStatus but
 *     not propagated to Order.status).
 *   - `shipmentStatus`: target Shipment.status (our internal enum, not the
 *     raw ShipLogic string).
 *   - `cancelReason`: prefixed reason if the ShipLogic event implies a
 *     cancellation, otherwise null.
 *
 * Mapping table (per `docs/shipping-module/shipping-module-foundation.md` §11):
 *   collected                                                   → DISPATCHED
 *   at-hub, at-destination-hub, manifested, ready-for-dispatch,
 *     in-transit, out-for-delivery                              → IN_TRANSIT
 *   delivered                                                   → DELIVERED
 *   cancelled                                                   → CANCELLED (SYSTEM:SHIPPING_CANCELLED)
 *   submitted, collection-assigned, collection-unassigned,
 *     awaiting-dropoff, on-hold*, returned-to-hub,
 *     collection-/delivery-rejected/-exception/-failed-attempt, etc.
 *                                                               → null (no Order transition)
 *
 * The full raw status is always preserved on `Shipment.shiplogicStatus` so
 * the admin tool can surface non-mapped states for ops triage.
 */

export interface ShipLogicStatusProjection {
  orderStatus: OrderStatus | null;
  shipmentStatus: ShipmentStatus | null;
  cancelReason: string | null;
}

export function mapShipLogicStatus(
  raw: string | null | undefined,
): ShipLogicStatusProjection {
  const noop: ShipLogicStatusProjection = {
    orderStatus: null,
    shipmentStatus: null,
    cancelReason: null,
  };
  if (!raw) return noop;

  const normalised = raw.trim().toLowerCase();

  switch (normalised) {
    case 'collected':
      return {
        orderStatus: OrderStatus.DISPATCHED,
        shipmentStatus: ShipmentStatus.COLLECTED,
        cancelReason: null,
      };

    case 'at-hub':
    case 'at-destination-hub':
    case 'manifested':
    case 'ready-for-dispatch':
    case 'in-transit':
      return {
        orderStatus: OrderStatus.IN_TRANSIT,
        shipmentStatus: ShipmentStatus.IN_TRANSIT,
        cancelReason: null,
      };

    case 'out-for-delivery':
      return {
        orderStatus: OrderStatus.IN_TRANSIT,
        shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
        cancelReason: null,
      };

    case 'delivered':
      return {
        orderStatus: OrderStatus.DELIVERED,
        shipmentStatus: ShipmentStatus.DELIVERED,
        cancelReason: null,
      };

    case 'cancelled':
      return {
        orderStatus: OrderStatus.CANCELLED,
        shipmentStatus: null, // we keep Shipment.status unchanged (audit), order is canonical
        cancelReason: 'SYSTEM:SHIPPING_CANCELLED',
      };

    case 'delivery-failed-attempt':
    case 'returned-to-hub':
      return {
        orderStatus: null, // ops triage — don't auto-transition Order
        shipmentStatus: ShipmentStatus.FAILED_DELIVERY,
        cancelReason: null,
      };

    default:
      return noop;
  }
}
