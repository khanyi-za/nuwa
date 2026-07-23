import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ShipmentTrackingReconcileService } from './shipment-tracking-reconcile.service';
import { ShipmentStatusApplyService } from './shipment-status-apply.service';
import { ShipLogicClient } from './shiplogic/shiplogic-client.service';

const WAYBILL = 'VD3GLQ';

const mockPrisma = {
  shipment: { findMany: jest.fn(), update: jest.fn() },
};
const mockClient = { getJson: jest.fn() };
const mockApply = { apply: jest.fn() };

const candidate = {
  id: 'shp-1',
  waybillNumber: WAYBILL,
  shiplogicStatus: 'collected',
};

describe('ShipmentTrackingReconcileService', () => {
  let service: ShipmentTrackingReconcileService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShipmentTrackingReconcileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShipLogicClient, useValue: mockClient },
        { provide: ShipmentStatusApplyService, useValue: mockApply },
      ],
    }).compile();
    service = module.get(ShipmentTrackingReconcileService);
    jest.clearAllMocks();
    mockPrisma.shipment.findMany.mockResolvedValue([candidate]);
    mockPrisma.shipment.update.mockResolvedValue({});
    mockApply.apply.mockResolvedValue(true);
  });

  it('polls only stale, in-flight shipments of non-terminal orders', async () => {
    mockPrisma.shipment.findMany.mockResolvedValue([]);

    await service.reconcileTracking();

    const where = mockPrisma.shipment.findMany.mock.calls[0][0].where;
    expect(where.waybillNumber).toEqual({ not: null });
    expect(where.status.in).toEqual([
      'PENDING',
      'COLLECTED',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'FAILED_DELIVERY',
    ]);
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
    expect(where.order.status.notIn).toEqual([
      'DELIVERED',
      'CANCELLED',
      'REFUNDED',
    ]);
    expect(mockClient.getJson).not.toHaveBeenCalled();
  });

  it('applies a drifted status through the shared apply pipeline', async () => {
    mockClient.getJson.mockResolvedValue({
      short_tracking_reference: WAYBILL,
      status: 'delivered',
      delivered_date: '2026-07-23T10:00:00Z',
      tracking_events: [
        {
          status: 'delivered',
          message: 'Delivered to reception',
          location: 'CPT',
          date: '2026-07-23T10:00:00Z',
        },
      ],
    });

    const summary = await service.reconcileTracking();

    expect(mockClient.getJson).toHaveBeenCalledWith(
      `/shipments?tracking_reference=${WAYBILL}`,
    );
    expect(mockApply.apply).toHaveBeenCalledWith({
      shipmentId: 'shp-1',
      rawStatus: 'delivered',
      eventTime: new Date('2026-07-23T10:00:00Z'),
      hub: 'CPT',
      message: 'Delivered to reception',
    });
    expect(summary).toEqual({
      candidates: 1,
      updated: 1,
      unchanged: 0,
      failed: 0,
    });
  });

  it('skips apply when the status has not drifted, but touches the row', async () => {
    mockClient.getJson.mockResolvedValue({ status: 'collected' });

    const summary = await service.reconcileTracking();

    expect(mockApply.apply).not.toHaveBeenCalled();
    // updatedAt touch → the 45-min stale filter skips it next run.
    expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'shp-1' },
      data: { shiplogicStatus: 'collected' },
    });
    expect(summary.unchanged).toBe(1);
  });

  it.each([
    ['bare array', [{ short_tracking_reference: WAYBILL, status: 'at-hub' }]],
    [
      'shipments envelope',
      { shipments: [{ short_tracking_reference: WAYBILL, status: 'at-hub' }] },
    ],
    ['single object', { status: 'at-hub' }],
  ])('handles the %s response shape', async (_label, response) => {
    mockClient.getJson.mockResolvedValue(response);

    await service.reconcileTracking();

    expect(mockApply.apply).toHaveBeenCalledWith(
      expect.objectContaining({ rawStatus: 'at-hub' }),
    );
  });

  it('counts an unknown/empty response as failed without applying', async () => {
    mockClient.getJson.mockResolvedValue({ unexpected: true });

    const summary = await service.reconcileTracking();

    expect(mockApply.apply).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });

  it('isolates per-shipment failures and continues with the rest', async () => {
    mockPrisma.shipment.findMany.mockResolvedValue([
      candidate,
      { id: 'shp-2', waybillNumber: 'AB12CD', shiplogicStatus: null },
    ]);
    mockClient.getJson
      .mockRejectedValueOnce(new Error('ShipLogic unreachable'))
      .mockResolvedValueOnce({ status: 'in-transit' });

    const summary = await service.reconcileTracking();

    expect(summary).toEqual({
      candidates: 2,
      updated: 1,
      unchanged: 0,
      failed: 1,
    });
    expect(mockApply.apply).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: 'shp-2', rawStatus: 'in-transit' }),
    );
  });

  it('no-ops entirely when there are no candidates', async () => {
    mockPrisma.shipment.findMany.mockResolvedValue([]);
    const summary = await service.reconcileTracking();
    expect(summary).toEqual({
      candidates: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    });
  });
});
