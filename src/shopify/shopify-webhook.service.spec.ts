import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyWebhookService } from './shopify-webhook.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifySyncService } from './shopify-sync.service';
import { encryptToken } from './token-crypto';

const KEY = randomBytes(32);
const SECRET = 'path-secret-1';
const API_SECRET = 'shopify-api-secret-key-abc123';

const mockPrisma = {
  shopifyConnection: { findFirst: jest.fn() },
  shopifyWebhookEvent: { create: jest.fn(), update: jest.fn() },
};
const mockSync = { apply: jest.fn() };

const connection = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  apiSecretEncrypted: null as string | null,
  status: 'ACTIVE',
};

const payload = { id: 632910392, title: 'Updated Product' };
const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

function headers(overrides: Record<string, string | undefined> = {}) {
  return {
    topic: 'products/update',
    shopDomain: 'fieldsstore.myshopify.com',
    hmac: undefined,
    webhookId: 'wh-1',
    ...overrides,
  };
}

function signWith(secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

describe('ShopifyWebhookService', () => {
  let service: ShopifyWebhookService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: { tokenKey: KEY } },
        { provide: ShopifySyncService, useValue: mockSync },
      ],
    }).compile();
    service = module.get(ShopifyWebhookService);
    jest.clearAllMocks();
    mockPrisma.shopifyConnection.findFirst.mockResolvedValue({ ...connection });
    mockPrisma.shopifyWebhookEvent.create.mockResolvedValue({ id: 'evt-1' });
    mockPrisma.shopifyWebhookEvent.update.mockResolvedValue({});
    mockSync.apply.mockResolvedValue('APPLIED');
  });

  it('404s (stealth) on an unknown path secret', async () => {
    mockPrisma.shopifyConnection.findFirst.mockResolvedValue(null);
    await expect(
      service.ingest('wrong', rawBody, headers(), '1.2.3.4'),
    ).rejects.toThrow(NotFoundException);
  });

  it('400s on a missing body', async () => {
    await expect(
      service.ingest(SECRET, undefined, headers(), '1.2.3.4'),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores the event, applies the topic, marks processed', async () => {
    const res = await service.ingest(SECRET, rawBody, headers(), '1.2.3.4');

    expect(res).toEqual({ received: true });
    const created = mockPrisma.shopifyWebhookEvent.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      connectionId: 'conn-1',
      topic: 'products/update',
      shopDomain: 'fieldsstore.myshopify.com',
      webhookId: 'wh-1',
      sourceIp: '1.2.3.4',
    });
    expect(created.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSync.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1' }),
      'products/update',
      payload,
    );
    expect(mockPrisma.shopifyWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { processed: true, processError: null },
    });
  });

  it('acks replays as no-ops via the payloadHash unique constraint', async () => {
    mockPrisma.shopifyWebhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const res = await service.ingest(SECRET, rawBody, headers(), '1.2.3.4');

    expect(res).toEqual({ received: true });
    expect(mockSync.apply).not.toHaveBeenCalled();
  });

  it('records applier failures on the event and STILL acks 200', async () => {
    mockSync.apply.mockRejectedValue(new Error('applier exploded'));

    const res = await service.ingest(SECRET, rawBody, headers(), '1.2.3.4');

    expect(res).toEqual({ received: true });
    expect(mockPrisma.shopifyWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { processError: 'applier exploded' },
    });
  });

  describe('HMAC (only when the merchant supplied their API secret)', () => {
    beforeEach(() => {
      mockPrisma.shopifyConnection.findFirst.mockResolvedValue({
        ...connection,
        apiSecretEncrypted: encryptToken(API_SECRET, KEY),
      });
    });

    it('accepts a valid signature', async () => {
      const res = await service.ingest(
        SECRET,
        rawBody,
        headers({ hmac: signWith(API_SECRET) }),
        '1.2.3.4',
      );
      expect(res).toEqual({ received: true });
      expect(mockSync.apply).toHaveBeenCalled();
    });

    it('401s a bad signature', async () => {
      await expect(
        service.ingest(
          SECRET,
          rawBody,
          headers({ hmac: signWith('some-other-secret') }),
          '1.2.3.4',
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.shopifyWebhookEvent.create).not.toHaveBeenCalled();
    });

    it('401s a missing signature header', async () => {
      await expect(
        service.ingest(SECRET, rawBody, headers(), '1.2.3.4'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it('skips HMAC entirely when no API secret is stored (path secret is the boundary)', async () => {
    const res = await service.ingest(
      SECRET,
      rawBody,
      headers({ hmac: 'garbage-signature' }),
      '1.2.3.4',
    );
    expect(res).toEqual({ received: true });
  });
});
