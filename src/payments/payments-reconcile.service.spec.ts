import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsReconcileService } from './payments-reconcile.service';
import { PayfastClient } from './payfast/payfast-client.service';

const PAYMENT_GROUP_ID = 'pg-1';
const M_PAYMENT_ID = 'm-uuid-123';

const mockPrisma: any = {
  paymentGroup: {
    findUnique: jest.fn(),
  },
};

const mockClient = {
  fetchTransactionHistory: jest.fn(),
};

function buildGroup(overrides: Partial<{
  status: PaymentStatus;
  createdAt: Date;
}> = {}) {
  return {
    id: PAYMENT_GROUP_ID,
    mPaymentId: M_PAYMENT_ID,
    status: overrides.status ?? PaymentStatus.PENDING,
    amountGrossInCents: 55000,
    createdAt: overrides.createdAt ?? new Date('2026-04-30T12:00:00Z'),
  };
}

function buildPayfastTx(
  overrides: Partial<{ payment_status: string; m_payment_id: string }> = {},
): Record<string, string> {
  return {
    m_payment_id: overrides.m_payment_id ?? M_PAYMENT_ID,
    pf_payment_id: 'pf-uuid-456',
    payment_status: overrides.payment_status ?? 'COMPLETE',
    amount_gross: '550.00',
  };
}

describe('PaymentsReconcileService', () => {
  let service: PaymentsReconcileService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaymentsReconcileService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PayfastClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(PaymentsReconcileService);
    jest.clearAllMocks();
  });

  it('throws 404 when PaymentGroup does not exist', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
    await expect(service.reconcile('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('queries PayFast with a 7-day window centered on PaymentGroup.createdAt', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ createdAt: new Date('2026-04-30T12:00:00Z') }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [],
    });

    await service.reconcile(PAYMENT_GROUP_ID);

    expect(mockClient.fetchTransactionHistory).toHaveBeenCalledWith({
      from: '2026-04-23',
      to: '2026-05-07',
    });
  });

  it('returns NOT_FOUND when PayFast has no matching m_payment_id', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildGroup());
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [
        buildPayfastTx({ m_payment_id: 'm-different' }),
      ],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result.verdict).toBe('NOT_FOUND');
    expect(result.payfast.found).toBe(false);
  });

  it('returns MATCH when PayFast COMPLETE corresponds to our COMPLETED', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.COMPLETED }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'COMPLETE' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result.verdict).toBe('MATCH');
    expect(result.payfast.found).toBe(true);
    expect(result.payfast.pfPaymentId).toBe('pf-uuid-456');
  });

  it('returns MATCH_PENDING when both sides are PENDING', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.PENDING }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'PENDING' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result.verdict).toBe('MATCH_PENDING');
  });

  it('returns MISMATCH when PayFast says COMPLETE but our group is CANCELLED', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.CANCELLED }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'COMPLETE' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result.verdict).toBe('MISMATCH');
  });

  it('returns MISMATCH when our group is COMPLETED but PayFast says FAILED', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.COMPLETED }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'FAILED' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result.verdict).toBe('MISMATCH');
  });

  it('handles lowercase payment_status in PayFast response', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.COMPLETED }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'complete' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);
    expect(result.verdict).toBe('MATCH');
  });

  it('returns full structured response payload on every verdict', async () => {
    const createdAt = new Date('2026-04-30T12:00:00Z');
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(
      buildGroup({ status: PaymentStatus.COMPLETED, createdAt }),
    );
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx({ payment_status: 'COMPLETE' })],
    });

    const result = await service.reconcile(PAYMENT_GROUP_ID);

    expect(result).toEqual({
      paymentGroup: {
        id: PAYMENT_GROUP_ID,
        mPaymentId: M_PAYMENT_ID,
        status: PaymentStatus.COMPLETED,
        amountGrossInCents: 55000,
        createdAt,
      },
      payfast: {
        found: true,
        pfPaymentId: 'pf-uuid-456',
        paymentStatus: 'COMPLETE',
        amountGross: '550.00',
        raw: expect.any(Object),
      },
      verdict: 'MATCH',
      window: { from: '2026-04-23', to: '2026-05-07' },
    });
  });

  it('does not mutate any state (read-only)', async () => {
    mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildGroup());
    mockClient.fetchTransactionHistory.mockResolvedValue({
      raw: {},
      transactions: [buildPayfastTx()],
    });

    await service.reconcile(PAYMENT_GROUP_ID);

    // No write methods on the prisma mock
    expect(mockPrisma.paymentGroup.findUnique).toHaveBeenCalled();
    expect(Object.keys(mockPrisma.paymentGroup)).toEqual(['findUnique']);
  });
});
