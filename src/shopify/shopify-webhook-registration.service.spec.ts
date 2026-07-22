import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ShopifyWebhookRegistrationService,
  SYNC_TOPICS,
} from './shopify-webhook-registration.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { encryptToken } from './token-crypto';

const KEY = randomBytes(32);
const BASE = 'https://api.yiiva.co.za';

const mockPrisma = {
  shopifyConnection: { findUnique: jest.fn(), update: jest.fn() },
};
const mockClient = { graphql: jest.fn() };

const connection = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  encryptedToken: encryptToken('shpat_abcdef0123456789', KEY),
  webhookSecret: null as string | null,
};

function wireGraphql(existingNodes: unknown[] = []) {
  mockClient.graphql.mockImplementation((_d, _t, query: string) => {
    if (query.includes('webhookSubscriptions(')) {
      return Promise.resolve({
        webhookSubscriptions: { nodes: existingNodes },
      });
    }
    if (query.includes('webhookSubscriptionCreate')) {
      return Promise.resolve({
        webhookSubscriptionCreate: {
          webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' },
          userErrors: [],
        },
      });
    }
    if (query.includes('webhookSubscriptionDelete')) {
      return Promise.resolve({
        webhookSubscriptionDelete: {
          deletedWebhookSubscriptionId: 'x',
          userErrors: [],
        },
      });
    }
    return Promise.reject(new Error('unexpected query'));
  });
}

describe('ShopifyWebhookRegistrationService', () => {
  let service: ShopifyWebhookRegistrationService;
  let config: { tokenKey: Buffer; webhookBaseUrl: string | null };

  beforeEach(async () => {
    config = { tokenKey: KEY, webhookBaseUrl: BASE };
    const module = await Test.createTestingModule({
      providers: [
        ShopifyWebhookRegistrationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: config },
        { provide: ShopifyClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(ShopifyWebhookRegistrationService);
    jest.clearAllMocks();
    mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
      ...connection,
    });
    mockPrisma.shopifyConnection.update.mockResolvedValue({});
    wireGraphql();
  });

  it('skips registration entirely when no public base URL is configured', async () => {
    config.webhookBaseUrl = null;
    const res = await service.registerForConnection('conn-1');
    expect(res).toEqual({ registered: false, created: 0 });
    expect(mockClient.graphql).not.toHaveBeenCalled();
  });

  it('generates + persists a webhook secret and subscribes all sync topics', async () => {
    const res = await service.registerForConnection('conn-1');

    expect(res).toEqual({ registered: true, created: SYNC_TOPICS.length });

    // Secret persisted first…
    const secretUpdate = mockPrisma.shopifyConnection.update.mock.calls[0][0];
    const secret = secretUpdate.data.webhookSecret;
    expect(secret).toMatch(/^[0-9a-f]{48}$/);

    // …and every create used the callback URL built from it.
    const creates = mockClient.graphql.mock.calls.filter(([, , q]) =>
      (q as string).includes('webhookSubscriptionCreate'),
    );
    expect(creates.map(([, , , vars]) => vars.topic)).toEqual([
      ...SYNC_TOPICS,
    ]);
    expect(creates[0][3].webhookSubscription).toEqual({
      callbackUrl: `${BASE}/shopify/webhook/${secret}`,
      format: 'JSON',
    });

    // webhooksRegisteredAt stamped.
    const finalUpdate = mockPrisma.shopifyConnection.update.mock.calls.at(-1);
    expect(finalUpdate?.[0].data.webhooksRegisteredAt).toBeInstanceOf(Date);
  });

  it('is idempotent — topics already subscribed on our URL are skipped', async () => {
    const secret = 'a'.repeat(48);
    mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
      ...connection,
      webhookSecret: secret,
    });
    wireGraphql([
      {
        id: 'sub-1',
        topic: 'PRODUCTS_UPDATE',
        endpoint: {
          __typename: 'WebhookHttpEndpoint',
          callbackUrl: `${BASE}/shopify/webhook/${secret}`,
        },
      },
    ]);

    const res = await service.registerForConnection('conn-1');

    expect(res.created).toBe(SYNC_TOPICS.length - 1);
  });

  it('unregister deletes only OUR subscriptions (matched by secret)', async () => {
    const secret = 'b'.repeat(48);
    mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
      ...connection,
      webhookSecret: secret,
    });
    wireGraphql([
      {
        id: 'sub-ours',
        topic: 'PRODUCTS_UPDATE',
        endpoint: {
          __typename: 'WebhookHttpEndpoint',
          callbackUrl: `${BASE}/shopify/webhook/${secret}`,
        },
      },
      {
        id: 'sub-theirs',
        topic: 'ORDERS_CREATE',
        endpoint: {
          __typename: 'WebhookHttpEndpoint',
          callbackUrl: 'https://someone-elses-app.example/hook',
        },
      },
    ]);

    await service.unregisterForConnection('conn-1');

    const deletes = mockClient.graphql.mock.calls.filter(([, , q]) =>
      (q as string).includes('webhookSubscriptionDelete'),
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][3]).toEqual({ id: 'sub-ours' });
  });

  it('unregister swallows API failures (best-effort)', async () => {
    mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
      ...connection,
      webhookSecret: 'c'.repeat(48),
    });
    mockClient.graphql.mockRejectedValue(new Error('boom'));
    await expect(
      service.unregisterForConnection('conn-1'),
    ).resolves.toBeUndefined();
  });
});
