import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PayfastConfig } from './payfast/payfast-config';
import { PayfastSignatureService } from './payfast/payfast-signature.service';
import { PayfastClient } from './payfast/payfast-client.service';
import { PaymentInitRequest } from '../order/contracts/payment-contract';

const mockClient = {
  createRefund: jest.fn(),
  verifyItnPostback: jest.fn(),
};

const baseEnv = {
  PAYFAST_MERCHANT_ID: '10000100',
  PAYFAST_MERCHANT_KEY: '46f0cd694581a',
  PAYFAST_PASSPHRASE: 'jt7NOE43FZPn',
  PAYFAST_SANDBOX: 'true',
  PAYFAST_RETURN_URL: 'https://yiiva.co.za/checkout/success',
  PAYFAST_CANCEL_URL: 'https://yiiva.co.za/checkout/cancel',
  PAYFAST_NOTIFY_URL: 'https://api.yiiva.co.za/payments/notify',
};

const baseRequest: PaymentInitRequest = {
  orderIds: ['ord-1'],
  mPaymentId: 'm-uuid-123',
  totalAmountInCents: 55000, // R550.00
  buyerEmail: 'buyer@example.com',
  buyerFirstName: 'Jane',
  buyerLastName: 'Doe',
  itemName: 'YIIVA Order YV-2026-001234',
};

async function buildService(
  env: Record<string, string | undefined> = baseEnv,
): Promise<{
  service: PaymentsService;
  config: PayfastConfig;
  signature: PayfastSignatureService;
}> {
  const module = await Test.createTestingModule({
    providers: [
      PaymentsService,
      PayfastConfig,
      PayfastSignatureService,
      { provide: PayfastClient, useValue: mockClient },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return {
    service: module.get(PaymentsService),
    config: module.get(PayfastConfig),
    signature: module.get(PayfastSignatureService),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PaymentsService', () => {
  describe('initializePayment', () => {
    it('returns actionUrl pointing at sandbox /eng/process when sandbox=true', async () => {
      const { service } = await buildService();
      const result = await service.initializePayment(baseRequest);
      expect(result.actionUrl).toBe('https://sandbox.payfast.co.za/eng/process');
    });

    it('returns actionUrl pointing at production /eng/process when sandbox=false', async () => {
      const { service } = await buildService({
        ...baseEnv,
        PAYFAST_SANDBOX: 'false',
      });
      const result = await service.initializePayment(baseRequest);
      expect(result.actionUrl).toBe('https://www.payfast.co.za/eng/process');
    });

    it('populates required fields from config + request', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);

      expect(fields.merchant_id).toBe('10000100');
      expect(fields.merchant_key).toBe('46f0cd694581a');
      expect(fields.return_url).toBe('https://yiiva.co.za/checkout/success');
      expect(fields.cancel_url).toBe('https://yiiva.co.za/checkout/cancel');
      expect(fields.notify_url).toBe('https://api.yiiva.co.za/payments/notify');
      expect(fields.m_payment_id).toBe('m-uuid-123');
      expect(fields.name_first).toBe('Jane');
      expect(fields.name_last).toBe('Doe');
      expect(fields.email_address).toBe('buyer@example.com');
      expect(fields.item_name).toBe('YIIVA Order YV-2026-001234');
    });

    it('formats amount as cents/100 .toFixed(2)', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);
      expect(fields.amount).toBe('550.00');
    });

    it('formats sub-rand and rounds correctly', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        totalAmountInCents: 99,
      });
      expect(fields.amount).toBe('0.99');
    });

    it('formats single rand', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        totalAmountInCents: 100,
      });
      expect(fields.amount).toBe('1.00');
    });

    it('omits cell_number when not provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);
      expect(fields.cell_number).toBeUndefined();
    });

    it('includes cell_number when provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        buyerCellNumber: '+27821234567',
      });
      expect(fields.cell_number).toBe('+27821234567');
    });

    it('omits item_description when not provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);
      expect(fields.item_description).toBeUndefined();
    });

    it('includes item_description when provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        itemDescription: 'Multi-store order from YIIVA',
      });
      expect(fields.item_description).toBe('Multi-store order from YIIVA');
    });

    it('uses request override for returnUrl when provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        returnUrl: 'https://yiiva.co.za/special-thanks',
      });
      expect(fields.return_url).toBe('https://yiiva.co.za/special-thanks');
    });

    it('uses request override for cancelUrl when provided', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment({
        ...baseRequest,
        cancelUrl: 'https://yiiva.co.za/checkout/abandoned',
      });
      expect(fields.cancel_url).toBe('https://yiiva.co.za/checkout/abandoned');
    });

    it('attaches a signature in the returned fields', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);
      expect(fields.signature).toBeDefined();
      expect(fields.signature).toMatch(/^[a-f0-9]{32}$/);
    });

    it('signature matches PayfastSignatureService.signFormPayload over the rest of the fields', async () => {
      const { service, signature, config } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);

      const { signature: included, ...rest } = fields;
      const expected = signature.signFormPayload(rest, config.passphrase);
      expect(included).toBe(expected);
    });

    it('signature changes when amount changes (tamper-detection roundtrip)', async () => {
      const { service } = await buildService();
      const a = await service.initializePayment(baseRequest);
      const b = await service.initializePayment({
        ...baseRequest,
        totalAmountInCents: 60000,
      });
      expect(a.fields.signature).not.toBe(b.fields.signature);
    });

    it('signature changes when m_payment_id changes', async () => {
      const { service } = await buildService();
      const a = await service.initializePayment(baseRequest);
      const b = await service.initializePayment({
        ...baseRequest,
        mPaymentId: 'm-different-id',
      });
      expect(a.fields.signature).not.toBe(b.fields.signature);
    });

    it('does not include unknown fields not in PayFast spec', async () => {
      const { service } = await buildService();
      const { fields } = await service.initializePayment(baseRequest);
      // The contract only emits known PayFast fields. orderIds is internal.
      expect(fields.orderIds).toBeUndefined();
      expect(fields.totalAmountInCents).toBeUndefined();
    });
  });

  describe('refundPayment', () => {
    const refundReq = {
      pfPaymentId: 'pf-uuid-456',
      amountInCents: 5000,
      reason: 'Buyer changed mind',
      accType: 'savings' as const,
    };

    it('delegates to PayfastClient.createRefund with the request fields', async () => {
      mockClient.createRefund.mockResolvedValue({
        code: 200,
        status: 'ok',
        data: { response: true },
      });
      const { service } = await buildService();
      await service.refundPayment(refundReq);
      expect(mockClient.createRefund).toHaveBeenCalledWith({
        pfPaymentId: 'pf-uuid-456',
        amountInCents: 5000,
        reason: 'Buyer changed mind',
        accType: 'savings',
        notifyBuyer: undefined,
      });
    });

    it('returns RefundResponse with status PROCESSING (PayFast confirms via ITN)', async () => {
      mockClient.createRefund.mockResolvedValue({
        code: 200,
        status: 'ok',
      });
      const { service } = await buildService();
      const result = await service.refundPayment(refundReq);
      expect(result.status).toBe('PROCESSING');
    });

    it('returns refundId set to the original pfPaymentId (PayFast keys refunds by it)', async () => {
      mockClient.createRefund.mockResolvedValue({ code: 200, status: 'ok' });
      const { service } = await buildService();
      const result = await service.refundPayment(refundReq);
      expect(result.refundId).toBe('pf-uuid-456');
    });

    it('passes through raw PayFast response on the result', async () => {
      const apiBody = {
        code: 200,
        status: 'ok',
        data: { response: true, message: 'Refund accepted' },
      };
      mockClient.createRefund.mockResolvedValue(apiBody);
      const { service } = await buildService();
      const result = await service.refundPayment(refundReq);
      expect(result.raw).toEqual(apiBody);
    });

    it('propagates errors from PayfastClient (e.g., refund denied)', async () => {
      mockClient.createRefund.mockRejectedValue(new Error('PayFast 400: refund denied'));
      const { service } = await buildService();
      await expect(service.refundPayment(refundReq)).rejects.toThrow(
        /refund denied/,
      );
    });
  });
});
