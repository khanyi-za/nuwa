import { InternalServerErrorException } from '@nestjs/common';
import { ShipLogicConfig } from './shiplogic-config';
import { ShipLogicApiError, ShipLogicClient } from './shiplogic-client.service';

// Build a partial config stub — only the fields the client reads.
function makeConfig(overrides: Partial<ShipLogicConfig> = {}): ShipLogicConfig {
  return {
    baseUrl: 'https://api.shiplogic.com',
    apiKey: 'test-key-abc',
    ...overrides,
  } as ShipLogicConfig;
}

// Build a `Response`-shaped object that `fetch` mocks return.
function mockResponse({
  ok = true,
  status = 200,
  body = '',
}: {
  ok?: boolean;
  status?: number;
  body?: string;
} = {}): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('ShipLogicClient', () => {
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getJson', () => {
    it('attaches Bearer auth + accept header and parses the JSON response', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ body: JSON.stringify({ data: 42 }) }),
      );
      const client = new ShipLogicClient(makeConfig());

      const result = await client.getJson('/shipments?tracking_reference=ABC');

      expect(result).toEqual({ data: 42 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.shiplogic.com/shipments?tracking_reference=ABC',
      );
      expect(init.method).toBe('GET');
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key-abc',
        Accept: 'application/json',
      });
      expect(init.body).toBeUndefined();
    });

    it('normalises the path / baseUrl join (no double slashes, leading slash optional)', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ body: '{}' }));
      const client = new ShipLogicClient(
        makeConfig({ baseUrl: 'https://api.shiplogic.com/' }),
      );

      await client.getJson('rates');

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.shiplogic.com/rates');
    });

    it('throws ShipLogicApiError on non-2xx with status + body preserved', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          body: '{"error":"bad address"}',
        }),
      );
      const client = new ShipLogicClient(makeConfig());

      let caught: unknown;
      try {
        await client.getJson('/rates');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ShipLogicApiError);
      const err = caught as ShipLogicApiError;
      expect(err.status).toBe(400);
      expect(err.responseBody).toBe('{"error":"bad address"}');
      expect(err.method).toBe('GET');
      expect(err.path).toBe('/rates');
    });

    it('throws InternalServerErrorException on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new ShipLogicClient(makeConfig());

      await expect(client.getJson('/rates')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('throws when response body is not valid JSON', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ body: 'not-json' }));
      const client = new ShipLogicClient(makeConfig());

      await expect(client.getJson('/rates')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('returns undefined for an empty 2xx response body', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ body: '' }));
      const client = new ShipLogicClient(makeConfig());

      const result = await client.getJson('/some/endpoint');
      expect(result).toBeUndefined();
    });
  });

  describe('postJson', () => {
    it('JSON-stringifies the body and sets Content-Type', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ body: JSON.stringify({ id: 'shp-1' }) }),
      );
      const client = new ShipLogicClient(makeConfig());

      const result = await client.postJson('/shipments', {
        tracking_reference: 'ABC',
        weight_kg: 2,
      });

      expect(result).toEqual({ id: 'shp-1' });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: 'Bearer test-key-abc',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
      expect(init.body).toBe('{"tracking_reference":"ABC","weight_kg":2}');
    });

    it('propagates ShipLogicApiError on POST 4xx', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 422,
          body: 'validation failed',
        }),
      );
      const client = new ShipLogicClient(makeConfig());

      let caught: unknown;
      try {
        await client.postJson('/shipments', { foo: 'bar' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ShipLogicApiError);
      expect((caught as ShipLogicApiError).status).toBe(422);
    });
  });
});
