import { PrismaService } from '../prisma/prisma.service';
import {
  ShipLogicApiError,
  ShipLogicClient,
} from './shiplogic/shiplogic-client.service';
import { ShipmentCancellationService } from './shipment-cancellation.service';

const ORDER_ID = 'order-1';

function makeService(opts: {
  shipment?: unknown;
  postReject?: Error | null;
}) {
  const prisma = {
    shipment: {
      findUnique: jest.fn().mockResolvedValue(opts.shipment ?? null),
    },
  };
  const post = jest.fn();
  if (opts.postReject) post.mockRejectedValue(opts.postReject);
  else post.mockResolvedValue({});
  const client = {
    postJson: post,
    getJson: jest.fn(),
    getBinary: jest.fn(),
  } as unknown as ShipLogicClient;
  return {
    service: new ShipmentCancellationService(prisma as unknown as PrismaService, client),
    post,
    prisma,
  };
}

describe('ShipmentCancellationService', () => {
  it('returns false when no Shipment exists for the order (PENDING cancellation path)', async () => {
    const { service, post } = makeService({ shipment: null });
    const result = await service.cancelShipmentForOrder(ORDER_ID);
    expect(result).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns false when shipment has no waybillNumber', async () => {
    const { service, post } = makeService({
      shipment: { id: 'shp-1', orderId: ORDER_ID, waybillNumber: null },
    });
    const result = await service.cancelShipmentForOrder(ORDER_ID);
    expect(result).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('calls ShipLogic /shipments/cancel with the waybill and returns true on success', async () => {
    const { service, post } = makeService({
      shipment: { id: 'shp-1', orderId: ORDER_ID, waybillNumber: 'VD3GLQ' },
    });
    const result = await service.cancelShipmentForOrder(ORDER_ID);
    expect(result).toBe(true);
    expect(post).toHaveBeenCalledWith('/shipments/cancel', {
      tracking_reference: 'VD3GLQ',
    });
  });

  it('swallows ShipLogic 4xx errors (collected/in-transit shipment) and returns false', async () => {
    const { service } = makeService({
      shipment: { id: 'shp-1', orderId: ORDER_ID, waybillNumber: 'VD3GLQ' },
      postReject: new ShipLogicApiError(
        400,
        'cannot cancel collected shipment',
        'POST',
        '/shipments/cancel',
      ),
    });
    const result = await service.cancelShipmentForOrder(ORDER_ID);
    expect(result).toBe(false);
  });

  it('swallows network errors and returns false (local Order cancel is authoritative)', async () => {
    const { service } = makeService({
      shipment: { id: 'shp-1', orderId: ORDER_ID, waybillNumber: 'VD3GLQ' },
      postReject: new Error('ECONNREFUSED'),
    });
    const result = await service.cancelShipmentForOrder(ORDER_ID);
    expect(result).toBe(false);
  });
});
