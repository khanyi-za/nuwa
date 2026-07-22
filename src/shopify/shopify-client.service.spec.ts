import { Test } from '@nestjs/testing';
import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConfig } from './shopify-config';

const mockConfig = {
  apiVersion: '2026-07',
  graphqlUrl: (d: string) => `https://${d}/admin/api/2026-07/graphql.json`,
};

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('ShopifyClient', () => {
  let client: ShopifyClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyClient,
        { provide: ShopifyConfig, useValue: mockConfig },
      ],
    }).compile();
    client = module.get(ShopifyClient);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('POSTs with the access-token header and returns data', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, { data: { shop: { name: 'FIELDS' } } }),
    );

    const data = await client.graphql<{ shop: { name: string } }>(
      'fields.myshopify.com',
      'shpat_token',
      'query { shop { name } }',
    );

    expect(data.shop.name).toBe('FIELDS');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://fields.myshopify.com/admin/api/2026-07/graphql.json',
    );
    expect(init.headers['x-shopify-access-token']).toBe('shpat_token');
  });

  it('maps 401 to SHOPIFY_TOKEN_INVALID', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, {}));
    await expect(
      client.graphql('s.myshopify.com', 'bad', 'query {}'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('retries THROTTLED using the cost extension, then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(200, {
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 100,
              throttleStatus: { currentlyAvailable: 90, restoreRate: 100 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));

    const data = await client.graphql<{ ok: boolean }>(
      's.myshopify.com',
      't',
      'query {}',
    );

    expect(data.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('surfaces non-throttle GraphQL errors as 500', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        errors: [{ message: 'Field does not exist' }],
      }),
    );
    await expect(
      client.graphql('s.myshopify.com', 't', 'query {}'),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('fetchShopInfo maps the shop + productsCount payload', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(200, {
        data: {
          shop: {
            name: 'FIELDS',
            email: 'owner@fields.co.za',
            currencyCode: 'ZAR',
            myshopifyDomain: 'fieldsstore.myshopify.com',
            primaryDomain: { host: 'fieldsstore.co.za' },
          },
          productsCount: { count: 52 },
        },
      }),
    );

    const info = await client.fetchShopInfo('fieldsstore.myshopify.com', 't');
    expect(info).toEqual({
      name: 'FIELDS',
      email: 'owner@fields.co.za',
      currencyCode: 'ZAR',
      myshopifyDomain: 'fieldsstore.myshopify.com',
      primaryDomain: 'fieldsstore.co.za',
      productsCount: 52,
    });
  });
});
