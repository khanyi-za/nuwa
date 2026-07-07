import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StoreEarningsService } from './store-earnings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const STORE_ID = 'store-1';

const emptyAggregate = {
  _sum: {
    amountGrossInCents: null,
    platformCommissionInCents: null,
    merchantPayoutInCents: null,
    refundedAmountInCents: null,
  },
  _count: 0,
};

const basePaymentRow = {
  id: 'pay-1',
  amountGrossInCents: 100_000,
  platformCommissionInCents: 5_500,
  merchantPayoutInCents: 94_500,
  refundedAmountInCents: 0,
  order: {
    id: 'order-1',
    orderNumber: 'YV-2026-AAAAAA',
    status: 'CONFIRMED',
    confirmedAt: new Date('2026-07-01T10:00:00Z'),
  },
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  payment: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('StoreEarningsService', () => {
  let service: StoreEarningsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreEarningsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(StoreEarningsService);
    jest.clearAllMocks();

    mockStoreService.canManageStore.mockResolvedValue(true);
    mockPrisma.payment.aggregate.mockResolvedValue(emptyAggregate);
    mockPrisma.payment.findMany.mockResolvedValue([]);
  });

  describe('getEarnings', () => {
    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(service.getEarnings(USER_ID, STORE_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.payment.aggregate).not.toHaveBeenCalled();
    });

    it('rejects malformed month values', async () => {
      await expect(
        service.getEarnings(USER_ID, STORE_ID, { month: '2026-13' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getEarnings(USER_ID, STORE_ID, { month: 'July' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns zeroed totals for a store with no completed payments', async () => {
      const result = await service.getEarnings(USER_ID, STORE_ID, {
        month: '2026-07',
      });

      expect(result.summary.lifetime).toEqual({
        grossInCents: 0,
        commissionInCents: 0,
        payoutInCents: 0,
        refundedInCents: 0,
        orderCount: 0,
      });
      expect(result.summary.period.month).toBe('2026-07');
      expect(result.ledger.rows).toEqual([]);
      expect(result.ledger.nextCursor).toBeNull();
    });

    it('sums aggregates and maps ledger rows from Payment records', async () => {
      mockPrisma.payment.aggregate
        .mockResolvedValueOnce({
          _sum: {
            amountGrossInCents: 300_000,
            platformCommissionInCents: 16_500,
            merchantPayoutInCents: 283_500,
            refundedAmountInCents: 10_000,
          },
          _count: 3,
        })
        .mockResolvedValueOnce({
          _sum: {
            amountGrossInCents: 100_000,
            platformCommissionInCents: 5_500,
            merchantPayoutInCents: 94_500,
            refundedAmountInCents: 0,
          },
          _count: 1,
        });
      mockPrisma.payment.findMany.mockResolvedValue([basePaymentRow]);

      const result = await service.getEarnings(USER_ID, STORE_ID, {
        month: '2026-07',
      });

      expect(result.summary.lifetime.payoutInCents).toBe(283_500);
      expect(result.summary.lifetime.orderCount).toBe(3);
      expect(result.summary.period.grossInCents).toBe(100_000);
      expect(result.ledger.rows).toEqual([
        {
          orderId: 'order-1',
          orderNumber: 'YV-2026-AAAAAA',
          orderStatus: 'CONFIRMED',
          confirmedAt: basePaymentRow.order.confirmedAt,
          grossInCents: 100_000,
          commissionInCents: 5_500,
          payoutInCents: 94_500,
          refundedInCents: 0,
        },
      ]);
    });

    it('filters on COMPLETED payments scoped to the store', async () => {
      await service.getEarnings(USER_ID, STORE_ID, { month: '2026-07' });

      // Lifetime aggregate: store-scoped, COMPLETED only, no date bounds.
      expect(mockPrisma.payment.aggregate.mock.calls[0][0].where).toEqual({
        status: 'COMPLETED',
        order: { storeId: STORE_ID },
      });
      // Period aggregate: bounded to the calendar month (UTC).
      const periodWhere = mockPrisma.payment.aggregate.mock.calls[1][0].where;
      expect(periodWhere.order.confirmedAt.gte).toEqual(
        new Date(Date.UTC(2026, 6, 1)),
      );
      expect(periodWhere.order.confirmedAt.lt).toEqual(
        new Date(Date.UTC(2026, 7, 1)),
      );
    });

    it('paginates the ledger with take+1 and returns nextCursor', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        ...basePaymentRow,
        id: `pay-${i}`,
      }));
      mockPrisma.payment.findMany.mockResolvedValue(rows);

      const result = await service.getEarnings(USER_ID, STORE_ID, {
        month: '2026-07',
        take: '2',
      });

      expect(result.ledger.rows).toHaveLength(2);
      expect(result.ledger.nextCursor).toBe('pay-1');
    });
  });
});
