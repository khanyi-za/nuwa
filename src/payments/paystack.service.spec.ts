import { Test } from '@nestjs/testing';
import { PaystackService } from './paystack.service';
import { PaystackConfig } from './paystack/paystack-config';
import { PaystackClient } from './paystack/paystack-client.service';

const mockConfig = {
  callbackUrl: 'https://yiiva.co.za/payment-return',
  testMode: true,
};

const mockClient = {
  initializeTransaction: jest.fn(),
  createRefund: jest.fn(),
  createSplit: jest.fn(),
};

describe('PaystackService', () => {
  let service: PaystackService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaystackService,
        { provide: PaystackConfig, useValue: mockConfig },
        { provide: PaystackClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(PaystackService);
    jest.clearAllMocks();
  });

  describe('initializePayment (contract v3)', () => {
    const initReq = {
      orderIds: ['o1', 'o2'],
      reference: 'm-uuid-1',
      totalAmountInCents: 279500,
      buyerEmail: 'buyer@yiiva.co.za',
      buyerFirstName: 'Naledi',
      buyerLastName: 'Demo',
      itemName: 'YIIVA Order (2 stores)',
    };

    it('returns a GET redirect to the authorization_url', async () => {
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'https://checkout.paystack.com/xyz',
        access_code: 'xyz',
        reference: 'm-uuid-1',
      });

      const res = await service.initializePayment(initReq);

      expect(res).toEqual({
        redirect: { url: 'https://checkout.paystack.com/xyz', method: 'GET' },
        providerRef: 'xyz',
      });
    });

    it('passes integer cents, OUR reference, and the default callback', async () => {
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'm-uuid-1',
      });

      await service.initializePayment(initReq);

      const arg = mockClient.initializeTransaction.mock.calls[0][0];
      expect(arg.amount).toBe(279500); // cents, NOT rands
      expect(arg.currency).toBe('ZAR');
      expect(arg.reference).toBe('m-uuid-1');
      expect(arg.email).toBe('buyer@yiiva.co.za');
      expect(arg.callback_url).toBe('https://yiiva.co.za/payment-return');
      expect(arg.metadata.order_ids).toEqual(['o1', 'o2']);
    });

    it('passes a channel restriction through; omits the key when unset', async () => {
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'r',
      });

      await service.initializePayment({ ...initReq, channels: ['eft'] });
      expect(mockClient.initializeTransaction.mock.calls[0][0].channels).toEqual(['eft']);

      await service.initializePayment(initReq);
      expect(
        'channels' in mockClient.initializeTransaction.mock.calls[1][0],
      ).toBe(false);
    });

    it('creates a flat all-proportional split and attaches its code', async () => {
      mockClient.createSplit.mockResolvedValue({ split_code: 'SPL_xyz' });
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'm-uuid-1',
      });

      await service.initializePayment({
        ...initReq,
        splits: [
          { subaccountCode: 'ACCT_fields', amountInCents: 97500 },
          { subaccountCode: 'ACCT_koikoi', amountInCents: 48750 },
        ],
      });

      const splitReq = mockClient.createSplit.mock.calls[0][0];
      expect(splitReq.type).toBe('flat');
      expect(splitReq.bearer_type).toBe('all-proportional'); // PS-8
      expect(splitReq.subaccounts).toEqual([
        { subaccount: 'ACCT_fields', share: 97500 },
        { subaccount: 'ACCT_koikoi', share: 48750 },
      ]);
      expect(
        mockClient.initializeTransaction.mock.calls[0][0].split_code,
      ).toBe('SPL_xyz');
    });

    it('no splits → no split call and no split_code key', async () => {
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'r',
      });

      await service.initializePayment(initReq);

      expect(mockClient.createSplit).not.toHaveBeenCalled();
      expect(
        'split_code' in mockClient.initializeTransaction.mock.calls[0][0],
      ).toBe(false);
    });

    it('split-creation failure degrades gracefully — checkout proceeds unsplit', async () => {
      mockClient.createSplit.mockRejectedValue(new Error('Paystack 500'));
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'r',
      });

      const res = await service.initializePayment({
        ...initReq,
        splits: [{ subaccountCode: 'ACCT_x', amountInCents: 100 }],
      });

      expect(res.redirect.url).toBe('u'); // buyer checkout unharmed
      expect(
        'split_code' in mockClient.initializeTransaction.mock.calls[0][0],
      ).toBe(false);
    });

    it('a per-checkout returnUrl overrides the configured callback', async () => {
      mockClient.initializeTransaction.mockResolvedValue({
        authorization_url: 'u',
        access_code: 'a',
        reference: 'r',
      });

      await service.initializePayment({
        ...initReq,
        returnUrl: 'https://yiiva.co.za/custom-return',
      });

      expect(
        mockClient.initializeTransaction.mock.calls[0][0].callback_url,
      ).toBe('https://yiiva.co.za/custom-return');
    });
  });

  describe('refundPayment (contract v3)', () => {
    it('refunds by provider transaction id and maps statuses', async () => {
      mockClient.createRefund.mockResolvedValue({
        id: 987,
        status: 'pending',
        transaction: 12345,
        amount: 50000,
        currency: 'ZAR',
        refunded_at: null,
      });

      const res = await service.refundPayment({
        providerPaymentId: '12345',
        amountInCents: 50000,
        reason: 'Damaged item',
      });

      expect(res.refundId).toBe('987');
      expect(res.status).toBe('PENDING');
      const arg = mockClient.createRefund.mock.calls[0][0];
      expect(arg.transaction).toBe('12345');
      expect(arg.amount).toBe(50000);
      expect(arg.merchant_note).toBe('Damaged item');
    });

    it.each([
      ['processing', 'PROCESSING'],
      ['processed', 'COMPLETED'],
      ['failed', 'FAILED'],
    ] as const)('maps provider status %s → %s', async (provider, ours) => {
      mockClient.createRefund.mockResolvedValue({
        id: 1,
        status: provider,
        transaction: 1,
        amount: 1,
        currency: 'ZAR',
        refunded_at: null,
      });

      const res = await service.refundPayment({
        providerPaymentId: '1',
        amountInCents: 1,
        reason: 'r',
      });
      expect(res.status).toBe(ours);
    });

  });
});
