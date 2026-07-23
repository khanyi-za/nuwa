import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import { ShippingWebhookService } from './shipping-webhook.service';
import { ShipmentStatusApplyService } from './shipment-status-apply.service';
import { NotificationsService } from '../notifications/notifications.service';

const WAYBILL = 'VD3GLQ';
const SHIPMENT_ID = 'shp-1';
const SECRET = 'super-secret-token-xyz';

const notifications = {
  orderStatusChanged: jest.fn(),
} as unknown as NotificationsService;

function makeConfig(over: Partial<ShipLogicConfig> = {}): ShipLogicConfig {
  return {
    webhookSecret: SECRET,
    webhookIpAllowlist: [],
    ...over,
  } as unknown as ShipLogicConfig;
}

function makePrisma() {
  return {
    shipment: {
      findUnique: jest.fn().mockResolvedValue({
        id: SHIPMENT_ID,
        orderId: 'order-1',
        status: 'PENDING',
        shiplogicStatus: 'collection-assigned',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    shipmentEvent: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    shipmentTrackingEvent: {
      create: jest.fn().mockResolvedValue({}),
    },
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (fn: any) => fn(this)),
  } as any;
}

function trackingPayload(status: string, ref: string = WAYBILL) {
  return JSON.stringify({
    short_tracking_reference: ref,
    update_type: 'shipment',
    status,
    event_time: '2026-06-03T12:23:30.493Z',
    collection_hub: 'JHB',
    tracking_events: [{ status, id: 1, parcel_id: 0, message: 'At JHB' }],
  });
}

describe('ShippingWebhookService', () => {
  let service: ShippingWebhookService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    // Bind $transaction to use prisma itself as the tx client.
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    // The REAL apply service runs against the same prisma mock, so all the
    // state-application assertions below keep exercising the shared pipeline.
    service = new ShippingWebhookService(
      prisma as unknown as PrismaService,
      makeConfig(),
      new ShipmentStatusApplyService(
        prisma as unknown as PrismaService,
        notifications,
      ),
    );
  });

  // ─── Security ─────────────────────────────────────────────────────────────

  it('rejects with `unauthenticated` when secret is wrong', async () => {
    const out = await service.ingest({
      secret: 'wrong',
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered'),
    });
    expect(out).toBe('unauthenticated');
    expect(prisma.shipmentEvent.create).not.toHaveBeenCalled();
  });

  function makeService(configOver: Partial<ShipLogicConfig>) {
    return new ShippingWebhookService(
      prisma as unknown as PrismaService,
      makeConfig(configOver),
      new ShipmentStatusApplyService(
        prisma as unknown as PrismaService,
        notifications,
      ),
    );
  }

  it('rejects with `unauthenticated` when no secret is configured (webhook disabled)', async () => {
    service = makeService({ webhookSecret: null } as Partial<ShipLogicConfig>);
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered'),
    });
    expect(out).toBe('unauthenticated');
  });

  it('rejects with `ip_rejected` when sourceIp not in non-empty allowlist', async () => {
    service = makeService({
      webhookIpAllowlist: ['10.0.0.1'],
    } as Partial<ShipLogicConfig>);
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered'),
    });
    expect(out).toBe('ip_rejected');
  });

  it('allows the request when sourceIp matches the allowlist (handles IPv4-mapped IPv6)', async () => {
    service = makeService({
      webhookIpAllowlist: ['10.0.0.1'],
    } as Partial<ShipLogicConfig>);
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '::ffff:10.0.0.1',
      rawBody: trackingPayload('collected'),
    });
    expect(out).toBe('accepted');
  });

  // ─── Payload validation ──────────────────────────────────────────────────

  it('returns `malformed` on invalid JSON body', async () => {
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: 'not-json',
    });
    expect(out).toBe('malformed');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('accepts a tracking event and projects collected → DISPATCHED on Order', async () => {
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('collected'),
    });

    expect(out).toBe('accepted');

    // Stored audit row
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentId: SHIPMENT_ID,
          waybillNumber: WAYBILL,
          rawStatus: 'collected',
          eventType: 'TRACKING_EVENT',
        }),
      }),
    );

    // Shipment.status flipped to COLLECTED, collectedAt set
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiplogicStatus: 'collected',
          status: 'COLLECTED',
          collectedAt: expect.any(Date),
        }),
      }),
    );

    // Order CAS update with dispatchedAt
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'order-1',
          status: { in: ['CONFIRMED', 'PROCESSING', 'READY_FOR_DISPATCH'] },
        }),
        data: expect.objectContaining({
          status: 'DISPATCHED',
          dispatchedAt: expect.any(Date),
        }),
      }),
    );

    // Buyer-visible tracking row written
    expect(prisma.shipmentTrackingEvent.create).toHaveBeenCalled();
  });

  it('accepts a delivered event and projects → DELIVERED with deliveredAt set on Order + Shipment', async () => {
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered'),
    });

    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DELIVERED',
          deliveredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('stores raw status on Shipment but does NOT touch Order for non-mapped statuses', async () => {
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('collection-assigned'),
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalled();
    // Shipment.shiplogicStatus is updated for admin visibility; nothing
    // else (no status enum flip, no collectedAt/deliveredAt, no Order touch).
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: SHIPMENT_ID },
      data: { shiplogicStatus: 'collection-assigned' },
    });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.shipmentTrackingEvent.create).not.toHaveBeenCalled();
  });

  // ─── Idempotency ─────────────────────────────────────────────────────────

  it('returns `duplicate` when the unique constraint on payloadHash fires (replay)', async () => {
    const dupErr = new Prisma.PrismaClientKnownRequestError('dup', {
      clientVersion: 'x',
      code: 'P2002',
    });
    prisma.shipmentEvent.create.mockRejectedValueOnce(dupErr);

    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered'),
    });
    expect(out).toBe('duplicate');
    expect(prisma.shipment.update).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  // ─── Orphan events ───────────────────────────────────────────────────────

  it('still records audit row when waybill matches no known Shipment (orphaned event)', async () => {
    prisma.shipment.findUnique.mockResolvedValue(null); // no match
    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: trackingPayload('delivered', 'UNKNOWN'),
    });
    expect(out).toBe('accepted');
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shipmentId: null,
          waybillNumber: 'UNKNOWN',
        }),
      }),
    );
    // No side effects because we can't reach the Order
    expect(prisma.shipment.update).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  // ─── Event-type detection ────────────────────────────────────────────────

  it('detects DIMENSION_CHANGE from an array payload', async () => {
    const arr = JSON.stringify([
      {
        shipment_tracking_reference: WAYBILL,
        parcel_reference: 'VD3GLQ/1',
        length_cm: 10,
        width_cm: 10,
        height_cm: 10,
        weight_kg: 5,
      },
    ]);
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: arr,
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'DIMENSION_CHANGE' }),
      }),
    );
  });

  it('detects SHIPMENT_NOTE when message + shipment_id are present (no tracking_events)', async () => {
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: JSON.stringify({
        shipment_short_tracking_reference: WAYBILL,
        shipment_id: 1,
        message: 'Note from courier',
        type: 'external',
      }),
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'SHIPMENT_NOTE' }),
      }),
    );
  });

  it('detects ADDRESS_CHANGE when new_delivery_address is in the payload', async () => {
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: JSON.stringify({
        shipment_tracking_reference: WAYBILL,
        new_delivery_address: { city: 'Cape Town', code: '7441' },
      }),
    });
    expect(prisma.shipmentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'ADDRESS_CHANGE' }),
      }),
    );
  });

  // ─── Real-payload regression guard ─────────────────────────────────────────

  it('parses a VERBATIM production TCG delivered payload (docs/thecourierguy/TCGTrack_Webhook.txt)', async () => {
    // Abridged tracking_events (2 of 10) but every field shape is verbatim,
    // including the production quirks this guards: empty-string hubs at the
    // top level, no top-level message, location+message inside the events.
    const realPayload = {
      provider_id: 7,
      shipment_id: 26064099,
      short_tracking_reference: WAYBILL,
      status: 'delivered',
      shipment_time_created: '2023-08-23T20:31:00.804538Z',
      shipment_collected_date: '2023-08-25T16:25:48.392463Z',
      shipment_delivered_date: '2023-08-30T09:06:25.746161945+02:00',
      collection_from: '',
      delivery_to: '',
      collection_hub: '',
      delivery_hub: '',
      service_level_code: 'ECO',
      service_level_name: '',
      event_time: '2023-08-30T07:06:23.518Z',
      update_type: 'shipment',
      tracking_events: [
        {
          id: 628658099,
          parcel_id: 0,
          date: '2023-08-30T07:06:23.518Z',
          status: 'delivered',
          source: 'rus5',
          lat: -25.7443016,
          lng: 27.2728775,
          message: 'PIN entered successfully',
        },
        {
          id: 628449337,
          parcel_id: 0,
          date: '2023-08-30T05:06:11.076197Z',
          status: 'out-for-delivery',
          source: 'rus5',
          location: 'RUS',
          message: '',
          data: { hub_scanner_driver: 'rus5' },
        },
      ],
      has_ready_for_pickup_status: false,
    };

    const out = await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: JSON.stringify(realPayload),
    });

    expect(out).toBe('accepted');
    // Detected as a tracking event, matched by waybill, status applied.
    expect(prisma.shipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shiplogicStatus: 'delivered',
          status: 'DELIVERED',
          deliveredAt: new Date('2023-08-30T07:06:23.518Z'),
        }),
      }),
    );
    // Buyer-visible row uses the EVENT's message (no top-level message
    // exists in production) and no empty-string location.
    expect(prisma.shipmentTrackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'delivered',
          description: 'PIN entered successfully',
          location: null,
        }),
      }),
    );
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERED' }),
      }),
    );
  });

  it('surfaces the newest event location for hub scans (real in-transit shape)', async () => {
    await service.ingest({
      secret: SECRET,
      sourceIp: '1.2.3.4',
      rawBody: JSON.stringify({
        short_tracking_reference: WAYBILL,
        status: 'at-hub',
        collection_hub: '',
        delivery_hub: '',
        event_time: '2023-08-30T07:18:12.347606877+02:00',
        update_type: 'shipment',
        tracking_events: [
          {
            date: '2023-08-30T07:18:12.347606Z',
            status: 'at-hub',
            location: 'SCT Depot ',
            message: 'At SCT Depot  hub',
          },
        ],
      }),
    });

    expect(prisma.shipmentTrackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          location: 'SCT Depot', // trimmed from the event, not the empty top-level hub
          description: 'At SCT Depot  hub',
        }),
      }),
    );
  });
});
