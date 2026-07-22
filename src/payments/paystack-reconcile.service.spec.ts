import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackReconcileService } from './paystack-reconcile.service';
import { PaystackClient } from './paystack/paystack-client.service';

const mockPrisma = {
  paymentGroup: { findUnique: jest.fn() },
};
const mockClient = {
  tryVerifyTransaction: jest.fn(),
};

const group = {
  id: 'pg1',
  mPaymentId: 'm-uuid-1',
  status: 'COMPLETED',
  amountGrossInCents: 279500,
  createdAt: new Date('2026-07-20T10:00:00Z'),
};

const successTx = {
  id: 424242,
  status: 'success',
  reference: 'm-uuid-1',
  amount: 279500,
  currency: 'ZAR',
  gateway_response: 'Successful',
  paid_at: '2026-07-20T10:05:00Z',
  channel: 'card',
  fees: 9105,
};

describe('PaystackReconcileService', () => {
  let service: PaystackReconcileService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaystackReconcileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaystackClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(PaystackReconcileService);
    jest.clearAllMocks();
  });

  it('404s an unknown payment group', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
    await expect(service.reconcile('nope')).rejects.toThrow(NotFoundException);
  });

  it('MATCH: provider success ↔ our COMPLETED with equal amounts', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(group);
    mockClient.tryVerifyTransaction.mockResolvedValue(successTx);

    const result = await service.reconcile('pg1');

    expect(result.verdict).toBe('MATCH');
    expect(result.paystack).toMatchObject({
      found: true,
      transactionId: 424242,
      amountInCents: 279500,
      channel: 'card',
    });
    expect(mockClient.tryVerifyTransaction).toHaveBeenCalledWith('m-uuid-1');
  });

  it('MATCH: provider success ↔ our REFUNDED (refund family counts)', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue({
      ...group,
      status: 'REFUNDED',
    });
    mockClient.tryVerifyTransaction.mockResolvedValue(successTx);

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('MATCH');
  });

  it('MISMATCH: provider success but we still think PENDING', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue({
      ...group,
      status: 'PENDING',
    });
    mockClient.tryVerifyTransaction.mockResolvedValue(successTx);

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('MISMATCH');
  });

  it('MISMATCH: amounts disagree even when both sides say success', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(group);
    mockClient.tryVerifyTransaction.mockResolvedValue({
      ...successTx,
      amount: 1,
    });

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('MISMATCH');
  });

  it('MATCH_PENDING: both sides in flight', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue({
      ...group,
      status: 'PENDING',
    });
    mockClient.tryVerifyTransaction.mockResolvedValue({
      ...successTx,
      status: 'abandoned',
    });

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('MATCH_PENDING');
  });

  it('MATCH: provider failed ↔ our FAILED', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue({
      ...group,
      status: 'FAILED',
    });
    mockClient.tryVerifyTransaction.mockResolvedValue({
      ...successTx,
      status: 'failed',
    });

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('MATCH');
  });

  it('NOT_FOUND when Paystack has no record of the reference', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(group);
    mockClient.tryVerifyTransaction.mockResolvedValue(null);

    const result = await service.reconcile('pg1');
    expect(result.verdict).toBe('NOT_FOUND');
    expect(result.paystack.found).toBe(false);
  });
});
