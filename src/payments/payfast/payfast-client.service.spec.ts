import { Test } from '@nestjs/testing';
import {
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PayfastClient } from './payfast-client.service';
import { PayfastConfig } from './payfast-config';
import { PayfastSignatureService } from './payfast-signature.service';

const mockConfig = {
  formBaseUrl: 'https://sandbox.payfast.co.za',
  apiBaseUrl: 'https://api.payfast.co.za',
  apiTestingQuery: '?testing=true',
  sandbox: true,
  merchantId: '10000100',
  apiVersion: 'v1',
  passphrase: 'jt7NOE43FZPn',
} as unknown as PayfastConfig;

describe('PayfastClient', () => {
  let client: PayfastClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayfastClient,
        PayfastSignatureService,
        { provide: PayfastConfig, useValue: mockConfig },
      ],
    }).compile();
    client = module.get(PayfastClient);

    fetchSpy = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('verifyItnPostback', () => {
    it('POSTs to {formBaseUrl}/eng/query/validate with the param string body', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'VALID',
      } as Response);

      await client.verifyItnPostback('m_payment_id=abc&payment_status=COMPLETE');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://sandbox.payfast.co.za/eng/query/validate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'm_payment_id=abc&payment_status=COMPLETE',
        }),
      );
    });

    it('returns true when response body is exactly "VALID"', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'VALID',
      } as Response);
      expect(await client.verifyItnPostback('x=1')).toBe(true);
    });

    it('returns true when response body is "VALID" with surrounding whitespace', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '  VALID\n',
      } as Response);
      expect(await client.verifyItnPostback('x=1')).toBe(true);
    });

    it('returns false on "INVALID" response', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'INVALID',
      } as Response);
      expect(await client.verifyItnPostback('x=1')).toBe(false);
    });

    it('returns false on non-2xx status', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'VALID', // body says VALID but status is not OK
      } as Response);
      expect(await client.verifyItnPostback('x=1')).toBe(false);
    });

    it('returns false on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await client.verifyItnPostback('x=1')).toBe(false);
    });

    it('returns false on AbortError (timeout)', async () => {
      fetchSpy.mockRejectedValue(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );
      expect(await client.verifyItnPostback('x=1')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // createRefund — REST API flow with ksort signing
  // ───────────────────────────────────────────────────────────────────────

  describe('createRefund', () => {
    const refundReq = {
      pfPaymentId: 'pf-uuid-456',
      amountInCents: 5000,
      reason: 'Buyer changed mind',
      accType: 'savings' as const,
    };

    function mockJsonResponse(body: unknown, status = 200) {
      fetchSpy.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      } as Response);
    }

    it('POSTs to {apiBaseUrl}/refunds/{pfPaymentId}?testing=true (sandbox)', async () => {
      mockJsonResponse({ code: 200, status: 'ok', data: { response: true } });
      await client.createRefund(refundReq);

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.payfast.co.za/refunds/pf-uuid-456?testing=true',
      );
    });

    it('sends merchant-id, version, timestamp, and signature headers', async () => {
      mockJsonResponse({ code: 200, status: 'ok' });
      await client.createRefund(refundReq);

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['merchant-id']).toBe('10000100');
      expect(init.headers['version']).toBe('v1');
      expect(init.headers['timestamp']).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{4}$/,
      );
      expect(init.headers['signature']).toMatch(/^[a-f0-9]{32}$/);
      expect(init.headers['content-type']).toBe('application/json');
    });

    it('sends JSON body with amount, reason, acc_type, notify_buyer', async () => {
      mockJsonResponse({ code: 200, status: 'ok' });
      await client.createRefund(refundReq);

      const [, init] = fetchSpy.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        amount: 5000,
        reason: 'Buyer changed mind',
        acc_type: 'savings',
        notify_buyer: 1,
      });
    });

    it('sets notify_buyer=0 when notifyBuyer is explicitly false', async () => {
      mockJsonResponse({ code: 200, status: 'ok' });
      await client.createRefund({ ...refundReq, notifyBuyer: false });

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.notify_buyer).toBe(0);
    });

    it('sets notify_buyer=1 by default (matches PayFast SDK default)', async () => {
      mockJsonResponse({ code: 200, status: 'ok' });
      await client.createRefund(refundReq);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(body.notify_buyer).toBe(1);
    });

    it('returns parsed JSON response on success', async () => {
      const apiBody = { code: 200, status: 'ok', data: { response: true } };
      mockJsonResponse(apiBody);
      const result = await client.createRefund(refundReq);
      expect(result).toEqual(apiBody);
    });

    it('throws InternalServerErrorException on non-2xx response', async () => {
      mockJsonResponse(
        { code: 400, status: 'error', data: { message: 'Refund denied' } },
        400,
      );
      await expect(client.createRefund(refundReq)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when response body is not JSON', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<html>Server error</html>',
      } as Response);
      await expect(client.createRefund(refundReq)).rejects.toThrow(
        /not valid JSON/,
      );
    });

    it('throws InternalServerErrorException on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.createRefund(refundReq)).rejects.toThrow(
        /unreachable/,
      );
    });

    it('encodes the pfPaymentId path segment safely', async () => {
      mockJsonResponse({ code: 200, status: 'ok' });
      await client.createRefund({
        ...refundReq,
        pfPaymentId: 'with spaces',
      });
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe(
        'https://api.payfast.co.za/refunds/with%20spaces?testing=true',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // fetchTransactionHistory — used by reconciliation tooling
  // ───────────────────────────────────────────────────────────────────────

  describe('fetchTransactionHistory', () => {
    function mockJsonResponse(body: unknown, status = 200) {
      fetchSpy.mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      } as Response);
    }

    it('GETs {apiBaseUrl}/transactions/history with from/to + testing in sandbox', async () => {
      mockJsonResponse({ data: { response: [] } });
      await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('https://api.payfast.co.za/transactions/history?');
      expect(url).toContain('testing=true');
      expect(url).toContain('from=2026-04-23');
      expect(url).toContain('to=2026-05-07');
      expect(init.method).toBe('GET');
    });

    it('signs the request via API-flow ksort (signature header set)', async () => {
      mockJsonResponse({ data: { response: [] } });
      await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
      });

      const [, init] = fetchSpy.mock.calls[0];
      expect(init.headers['merchant-id']).toBe('10000100');
      expect(init.headers['version']).toBe('v1');
      expect(init.headers['signature']).toMatch(/^[a-f0-9]{32}$/);
    });

    it('extracts transactions from data.response envelope', async () => {
      const tx = { m_payment_id: 'm-1', payment_status: 'COMPLETE' };
      mockJsonResponse({ data: { response: [tx] } });
      const result = await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
      });
      expect(result.transactions).toEqual([tx]);
      expect(result.raw).toEqual({ data: { response: [tx] } });
    });

    it('extracts transactions from top-level array response', async () => {
      const tx = { m_payment_id: 'm-1' };
      mockJsonResponse([tx]);
      const result = await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
      });
      expect(result.transactions).toEqual([tx]);
    });

    it('returns empty transactions array when shape is unrecognized', async () => {
      mockJsonResponse({ unexpected: 'shape' });
      const result = await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
      });
      expect(result.transactions).toEqual([]);
    });

    it('includes optional offset and limit params when provided', async () => {
      mockJsonResponse({ data: { response: [] } });
      await client.fetchTransactionHistory({
        from: '2026-04-23',
        to: '2026-05-07',
        offset: 100,
        limit: 50,
      });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('offset=100');
      expect(url).toContain('limit=50');
    });

    it('throws on non-2xx response', async () => {
      mockJsonResponse({ error: 'invalid range' }, 400);
      await expect(
        client.fetchTransactionHistory({
          from: '2026-04-23',
          to: '2026-05-07',
        }),
      ).rejects.toThrow(/HTTP 400/);
    });

    it('throws when response body is not JSON', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<html>error</html>',
      } as Response);
      await expect(
        client.fetchTransactionHistory({
          from: '2026-04-23',
          to: '2026-05-07',
        }),
      ).rejects.toThrow(/not valid JSON/);
    });
  });
});
