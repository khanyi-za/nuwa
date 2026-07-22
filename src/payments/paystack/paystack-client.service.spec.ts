import { Test } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { PaystackClient } from './paystack-client.service';
import { PaystackConfig } from './paystack-config';

const mockConfig = {
  secretKey: 'sk_test_abc123',
  apiBaseUrl: 'https://api.paystack.co',
  testMode: true,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('PaystackClient', () => {
  let client: PaystackClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaystackClient,
        { provide: PaystackConfig, useValue: mockConfig },
      ],
    }).compile();
    client = module.get(PaystackClient);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('initializeTransaction', () => {
    it('POSTs with Bearer auth and returns the data payload', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/abc',
            access_code: 'abc',
            reference: 'YV-REF-1',
          },
        }),
      );

      const data = await client.initializeTransaction({
        amount: 279500,
        email: 'buyer@yiiva.co.za',
        currency: 'ZAR',
        reference: 'YV-REF-1',
      });

      expect(data.authorization_url).toBe('https://checkout.paystack.com/abc');
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe('Bearer sk_test_abc123');
      expect(JSON.parse(init.body).amount).toBe(279500);
    });

    it('throws 500 when the envelope status is false even on HTTP 200', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, { status: false, message: 'Invalid key', data: null }),
      );

      await expect(
        client.initializeTransaction({
          amount: 100,
          email: 'x@y.z',
          currency: 'ZAR',
          reference: 'r',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('verifyTransaction', () => {
    it('GETs by reference and returns the transaction data', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, {
          status: true,
          message: 'Verification successful',
          data: { id: 12345, status: 'success', reference: 'YV-REF-1', amount: 279500 },
        }),
      );

      const data = await client.verifyTransaction('YV-REF-1');

      expect(data.id).toBe(12345);
      expect(data.status).toBe('success');
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/transaction/verify/YV-REF-1');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });
  });

  describe('createRefund', () => {
    it('POSTs the refund with ZAR default currency', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(200, {
          status: true,
          message: 'Refund has been queued',
          data: { id: 987, status: 'pending', transaction: 12345, amount: 50000, currency: 'ZAR', refunded_at: null },
        }),
      );

      const data = await client.createRefund({
        transaction: 12345,
        amount: 50000,
      });

      expect(data.id).toBe(987);
      expect(data.status).toBe('pending');
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body).toEqual({ currency: 'ZAR', transaction: 12345, amount: 50000 });
    });
  });

  describe('transport failures', () => {
    it('throws 500 on non-JSON responses', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 502,
        text: () => Promise.resolve('<html>Bad Gateway</html>'),
      } as unknown as Response);

      await expect(client.verifyTransaction('r')).rejects.toThrow(
        /not valid JSON/,
      );
    });

    it('throws 500 when the network call rejects', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(client.verifyTransaction('r')).rejects.toThrow(
        /unreachable/,
      );
    });
  });
});
