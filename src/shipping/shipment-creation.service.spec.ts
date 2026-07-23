import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import {
  ShipLogicApiError,
  ShipLogicClient,
} from './shiplogic/shiplogic-client.service';
import { ShipmentCreationService } from './shipment-creation.service';

const ORDER_ID = 'order-1';

const orderRow = {
  id: ORDER_ID,
  orderNumber: 'YV-2026-ABC123',
  status: 'CONFIRMED',
  subtotalInCents: 50_000,
  shippingInCents: 11_000,
  shippingQuoteId: 'quote-1',
  shippingServiceTier: 'ECO',
  notes: 'Leave at security',
  shippingName: 'Test Buyer',
  shippingPhone: '+27821234567',
  shippingAddress1: '10 Midas Avenue',
  shippingAddress2: 'Apt 2',
  shippingSuburb: 'Olympus AH',
  shippingCity: 'Pretoria',
  shippingProvince: 'Gauteng',
  shippingPostalCode: '0081',
  shippingCountry: 'South Africa',
  dispatchAddress: {
    id: 'disp-1',
    contactName: 'Khanyi',
    contactPhone: '+27820000000',
    addressLine1: '194 Bancor Avenue',
    addressLine2: null,
    suburb: 'Menlyn',
    city: 'Pretoria',
    province: 'Gauteng',
    postalCode: '0181',
    country: 'South Africa',
    latitude: null,
    longitude: null,
  },
  items: [
    { productId: 'prod-1', variantId: null, quantity: 2 },
  ],
  user: { email: 'buyer@example.com', firstName: 'Test', lastName: 'Buyer' },
};

const shipLogicResponse = {
  id: 115738667,
  short_tracking_reference: 'VD3GLQ',
  status: 'collection-assigned',
  service_level_code: 'ECO',
  rate: 95,
  parcels: [{ id: 132904070, tracking_reference: 'VD3GLQ/1' }],
  estimated_collection: '2026-06-04T08:00:00Z',
  estimated_delivery_to: '2026-06-08T15:00:00Z',
  proof_of_delivery_pin: '427',
};

function makeConfig(): ShipLogicConfig {
  return {
    baseUrl: 'https://api.shiplogic.com',
    apiKey: 'k',
    defaultServiceLevel: 'ECO',
    defaultWeightGrams: 500,
    defaultLengthCm: 20,
    defaultWidthCm: 20,
    defaultHeightCm: 10,
    fallbackRateInCents: 11_000,
    webhookSecret: null,
    webhookIpAllowlist: [],
  } as unknown as ShipLogicConfig;
}

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    shipment: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    order: { findUnique: jest.fn() },
    product: { findMany: jest.fn().mockResolvedValue([
      { id: 'prod-1', weightInGrams: 750 },
    ]) },
    ...over,
  };
}

function makeClient(post: jest.Mock): ShipLogicClient {
  return { postJson: post, getJson: jest.fn(), getBinary: jest.fn() } as unknown as ShipLogicClient;
}

describe('ShipmentCreationService', () => {
  it('books a shipment, returns the created row with ShipLogic IDs persisted', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue(orderRow);
    prisma.shipment.findUnique.mockResolvedValue(null);
    prisma.shipment.create.mockResolvedValue({
      id: 'shp-1',
      orderId: ORDER_ID,
      shiplogicShipmentId: '115738667',
      waybillNumber: 'VD3GLQ',
      status: ShipmentStatus.PENDING,
    });
    const post = jest.fn().mockResolvedValue(shipLogicResponse);
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(post),
    );

    const result = await service.createShipmentForOrder(ORDER_ID);

    expect(result.waybillNumber).toBe('VD3GLQ');
    expect(post).toHaveBeenCalledWith('/shipments', expect.objectContaining({
      service_level_code: 'ECO',
      special_instructions_delivery: 'Leave at security',
      declared_value: 500, // 50000 cents → R500
    }));

    // Parcel weight = 2 (qty) × 0.75kg = 1.5kg
    const sentBody = post.mock.calls[0][1];
    expect(sentBody.parcels[0].submitted_weight_kg).toBe(1.5);
    expect(sentBody.delivery_address.street_address).toBe(
      '10 Midas Avenue, Apt 2',
    );
    // Suburb snapshot → ShipLogic's geocoding anchor.
    expect(sentBody.delivery_address.local_area).toBe('Olympus AH');

    expect(prisma.shipment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: ORDER_ID,
        shiplogicShipmentId: '115738667',
        waybillNumber: 'VD3GLQ',
        serviceType: 'ECO',
        shiplogicStatus: 'collection-assigned',
        rateInCents: 9_500, // 95 * 100
        deliveryOtp: '427',
      }),
    }));
  });

  it('is idempotent — returns existing Shipment without calling ShipLogic', async () => {
    const prisma = makePrisma();
    const existing = {
      id: 'shp-existing',
      orderId: ORDER_ID,
      waybillNumber: 'OLD',
    };
    prisma.shipment.findUnique.mockResolvedValue(existing);
    const post = jest.fn();
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(post),
    );

    const result = await service.createShipmentForOrder(ORDER_ID);

    expect(result).toBe(existing);
    expect(post).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the order does not exist', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue(null);
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(jest.fn()),
    );
    await expect(
      service.createShipmentForOrder(ORDER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequestException when the order has no dispatch address', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue({ ...orderRow, dispatchAddress: null });
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(jest.fn()),
    );
    await expect(
      service.createShipmentForOrder(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when the order is CANCELLED', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue({ ...orderRow, status: 'CANCELLED' });
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(jest.fn()),
    );
    await expect(
      service.createShipmentForOrder(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('converts ShipLogic 4xx into BadRequestException (do not write a Shipment row)', async () => {
    const prisma = makePrisma();
    prisma.order.findUnique.mockResolvedValue(orderRow);
    prisma.shipment.findUnique.mockResolvedValue(null);
    const post = jest.fn().mockRejectedValue(
      new ShipLogicApiError(400, 'invalid postal code', 'POST', '/shipments'),
    );
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(post),
    );

    await expect(
      service.createShipmentForOrder(ORDER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });

  it('falls back to default weight when no items match in product table', async () => {
    const prisma = makePrisma({
      shipment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      order: { findUnique: jest.fn().mockResolvedValue({ ...orderRow, items: [] }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const post = jest.fn().mockResolvedValue(shipLogicResponse);
    const service = new ShipmentCreationService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(post),
    );

    await service.createShipmentForOrder(ORDER_ID);
    expect(post.mock.calls[0][1].parcels[0].submitted_weight_kg).toBe(0.5);
  });
});
