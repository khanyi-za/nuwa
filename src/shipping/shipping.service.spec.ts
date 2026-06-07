import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import {
  ShipLogicApiError,
  ShipLogicClient,
} from './shiplogic/shiplogic-client.service';
import { ShipLogicRateResponse } from './shiplogic/shiplogic-types';
import { ShippingService } from './shipping.service';
import type { ShippingRateRequest } from '../order/contracts/shipping-contract';

const DISPATCH_ROW = {
  id: 'disp-1',
  storeId: 'store-1',
  addressLine1: '194 Bancor Avenue',
  addressLine2: null,
  suburb: 'Menlyn',
  city: 'Pretoria',
  province: 'Gauteng',
  postalCode: '0181',
  country: 'South Africa',
  latitude: null,
  longitude: null,
  isPrimary: true,
  deletedAt: null,
};

const baseReq: ShippingRateRequest = {
  dispatchAddressId: 'disp-1',
  delivery: {
    streetAddress: '10 Midas Avenue',
    suburb: 'Olympus AH',
    city: 'Pretoria',
    province: 'Gauteng',
    postalCode: '0081',
    country: 'South Africa',
  },
  // Legacy fields — kept for stub path; ignored by real impl.
  destinationProvince: 'Gauteng',
  destinationPostalCode: '0081',
  destinationCity: 'Pretoria',
  destinationCountry: 'South Africa',
  totalWeightInGrams: 2000,
  parcelCount: 1,
  serviceTier: 'ECO',
  declaredValueInCents: 50_000,
};

function makeConfig(over: Partial<ShipLogicConfig> = {}): ShipLogicConfig {
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
    ...over,
  } as unknown as ShipLogicConfig;
}

function makeClient(over: Partial<ShipLogicClient> = {}): ShipLogicClient {
  return {
    postJson: jest.fn(),
    getJson: jest.fn(),
    ...over,
  } as unknown as ShipLogicClient;
}

const okResponse = (overrides: Partial<ShipLogicRateResponse> = {}): ShipLogicRateResponse => ({
  rates: [
    {
      rate: 95,
      rate_excluding_vat: 82.61,
      service_level: {
        id: 1,
        code: 'ECO',
        name: 'Economy',
        delivery_date_to: '2026-06-08T15:00:00Z',
      },
    },
    {
      rate: 250,
      rate_excluding_vat: 217.39,
      service_level: { id: 2, code: 'LOX', name: 'Local Overnight Express' },
    },
  ],
  ...overrides,
});

describe('ShippingService.getRate', () => {
  let prisma: { storeDispatchAddress: { findFirst: jest.Mock } };

  beforeEach(() => {
    prisma = { storeDispatchAddress: { findFirst: jest.fn() } };
  });

  it('selects the rate matching the requested service tier and converts to cents', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const client = makeClient({
      postJson: jest.fn().mockResolvedValue(okResponse()),
    });
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      client,
    );

    const out = await service.getRate(baseReq);

    expect(out.rateInCents).toBe(9_500); // 95 * 100
    expect(out.rateExVatInCents).toBe(8_261); // 82.61 → 8261
    expect(out.serviceTier).toBe('ECO');
    expect(out.estimatedDeliveryDate).toBeInstanceOf(Date);
    expect(out.quoteId).toBeTruthy();
  });

  it('sends the wire-shape ShipLogic expects (lat/lng omitted when null)', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const postJson = jest.fn().mockResolvedValue(okResponse());
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient({ postJson }),
    );

    await service.getRate(baseReq);

    const [path, body] = postJson.mock.calls[0];
    expect(path).toBe('/rates');
    expect(body).toEqual(
      expect.objectContaining({
        collection_address: expect.objectContaining({
          type: 'business',
          street_address: '194 Bancor Avenue',
          local_area: 'Menlyn',
          city: 'Pretoria',
          zone: 'Gauteng',
          country: 'ZA',
          code: '0181',
        }),
        delivery_address: expect.objectContaining({
          type: 'residential',
          street_address: '10 Midas Avenue',
          local_area: 'Olympus AH',
          city: 'Pretoria',
          zone: 'Gauteng',
          country: 'ZA',
          code: '0081',
        }),
        parcels: [
          expect.objectContaining({
            submitted_length_cm: 20,
            submitted_width_cm: 20,
            submitted_height_cm: 10,
            submitted_weight_kg: 2,
          }),
        ],
        declared_value: 500, // 50000 cents → R500
      }),
    );
  });

  it('falls back to config default weight when totalWeightInGrams is 0', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const postJson = jest.fn().mockResolvedValue(okResponse());
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig({ defaultWeightGrams: 750 } as Partial<ShipLogicConfig>),
      makeClient({ postJson }),
    );

    await service.getRate({ ...baseReq, totalWeightInGrams: 0 });

    expect(postJson.mock.calls[0][1].parcels[0].submitted_weight_kg).toBe(0.75);
  });

  it('falls back to the configured flat rate on network/5xx errors', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig({ fallbackRateInCents: 12_000 } as Partial<ShipLogicConfig>),
      makeClient({
        postJson: jest.fn().mockRejectedValue(
          new ShipLogicApiError(503, 'Service Unavailable', 'POST', '/rates'),
        ),
      }),
    );

    const out = await service.getRate(baseReq);
    expect(out.rateInCents).toBe(12_000);
    expect(out.quoteId).toMatch(/^fallback-/);
  });

  it('falls back on plain network error too (no ShipLogicApiError)', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient({
        postJson: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      }),
    );

    const out = await service.getRate(baseReq);
    expect(out.rateInCents).toBe(11_000);
  });

  it('throws BadRequestException on ShipLogic 4xx (bad input — surface to buyer, do NOT fall back)', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient({
        postJson: jest.fn().mockRejectedValue(
          new ShipLogicApiError(400, 'invalid postal code', 'POST', '/rates'),
        ),
      }),
    );

    await expect(service.getRate(baseReq)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequestException when dispatch address is missing or soft-deleted', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(null);
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(),
    );

    await expect(service.getRate(baseReq)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws InternalServerErrorException when no rate matches the requested service tier', async () => {
    prisma.storeDispatchAddress.findFirst.mockResolvedValue(DISPATCH_ROW);
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient({
        postJson: jest.fn().mockResolvedValue({
          rates: [
            { rate: 100, rate_excluding_vat: 87, service_level: { id: 5, code: 'LOX', name: 'X' } },
          ],
        }),
      }),
    );

    await expect(service.getRate({ ...baseReq, serviceTier: 'ECO' })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('throws BadRequestException when delivery is missing from the request', async () => {
    const service = new ShippingService(
      prisma as unknown as PrismaService,
      makeConfig(),
      makeClient(),
    );

    await expect(
      service.getRate({ ...baseReq, delivery: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
