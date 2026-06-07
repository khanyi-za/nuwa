import { mapShipLogicStatus } from './shipping-status-map';
import { OrderStatus, ShipmentStatus } from '@prisma/client';

describe('mapShipLogicStatus', () => {
  it('returns no-op projection for null/empty input', () => {
    expect(mapShipLogicStatus(null)).toEqual({
      orderStatus: null,
      shipmentStatus: null,
      cancelReason: null,
    });
    expect(mapShipLogicStatus(undefined)).toEqual({
      orderStatus: null,
      shipmentStatus: null,
      cancelReason: null,
    });
    expect(mapShipLogicStatus('')).toEqual({
      orderStatus: null,
      shipmentStatus: null,
      cancelReason: null,
    });
  });

  it('maps collected → DISPATCHED', () => {
    expect(mapShipLogicStatus('collected')).toEqual({
      orderStatus: OrderStatus.DISPATCHED,
      shipmentStatus: ShipmentStatus.COLLECTED,
      cancelReason: null,
    });
  });

  it.each([
    'at-hub',
    'at-destination-hub',
    'manifested',
    'ready-for-dispatch',
    'in-transit',
  ])('maps %s → IN_TRANSIT (Shipment.IN_TRANSIT)', (raw) => {
    expect(mapShipLogicStatus(raw)).toEqual({
      orderStatus: OrderStatus.IN_TRANSIT,
      shipmentStatus: ShipmentStatus.IN_TRANSIT,
      cancelReason: null,
    });
  });

  it('maps out-for-delivery → IN_TRANSIT (Shipment.OUT_FOR_DELIVERY)', () => {
    expect(mapShipLogicStatus('out-for-delivery')).toEqual({
      orderStatus: OrderStatus.IN_TRANSIT,
      shipmentStatus: ShipmentStatus.OUT_FOR_DELIVERY,
      cancelReason: null,
    });
  });

  it('maps delivered → DELIVERED', () => {
    expect(mapShipLogicStatus('delivered')).toEqual({
      orderStatus: OrderStatus.DELIVERED,
      shipmentStatus: ShipmentStatus.DELIVERED,
      cancelReason: null,
    });
  });

  it('maps cancelled → CANCELLED with SYSTEM:SHIPPING_CANCELLED reason', () => {
    expect(mapShipLogicStatus('cancelled')).toEqual({
      orderStatus: OrderStatus.CANCELLED,
      shipmentStatus: null,
      cancelReason: 'SYSTEM:SHIPPING_CANCELLED',
    });
  });

  it('maps delivery-failed-attempt → Shipment.FAILED_DELIVERY but does NOT transition Order', () => {
    expect(mapShipLogicStatus('delivery-failed-attempt')).toEqual({
      orderStatus: null,
      shipmentStatus: ShipmentStatus.FAILED_DELIVERY,
      cancelReason: null,
    });
  });

  it('maps returned-to-hub → Shipment.FAILED_DELIVERY but does NOT transition Order', () => {
    expect(mapShipLogicStatus('returned-to-hub')).toEqual({
      orderStatus: null,
      shipmentStatus: ShipmentStatus.FAILED_DELIVERY,
      cancelReason: null,
    });
  });

  it.each([
    'submitted',
    'collection-assigned',
    'collection-unassigned',
    'collection-rejected',
    'collection-exception',
    'collection-failed-attempt',
    'awaiting-dropoff',
    'on-hold',
    'on-hold-internal',
    'delivery-assigned',
    'delivery-unassigned',
    'delivery-rejected',
    'delivery-exception',
    'ready-for-pickup',
  ])('does NOT propagate non-mapped status %s (ops-triage only)', (raw) => {
    expect(mapShipLogicStatus(raw)).toEqual({
      orderStatus: null,
      shipmentStatus: null,
      cancelReason: null,
    });
  });

  it('is case-insensitive on the raw input', () => {
    expect(mapShipLogicStatus('DELIVERED')).toEqual({
      orderStatus: OrderStatus.DELIVERED,
      shipmentStatus: ShipmentStatus.DELIVERED,
      cancelReason: null,
    });
    expect(mapShipLogicStatus('  Collected  ')).toEqual({
      orderStatus: OrderStatus.DISPATCHED,
      shipmentStatus: ShipmentStatus.COLLECTED,
      cancelReason: null,
    });
  });

  it('returns no-op for unknown statuses (forward-compatible)', () => {
    expect(mapShipLogicStatus('some-new-state-from-shiplogic')).toEqual({
      orderStatus: null,
      shipmentStatus: null,
      cancelReason: null,
    });
  });
});
