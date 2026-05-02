import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';
import { OrderCleanupService } from './order-cleanup.service';
import { PrismaService } from '../../prisma/prisma.service';
import * as stock from '../cart/stock';

// ─── Mock stock module ──────────────────────────────────────────────────────

jest.mock('../cart/stock', () => ({
  reserveStock: jest.fn(),
  releaseStock: jest.fn(),
}));

const releaseStockMock = stock.releaseStock as jest.Mock;

// ─── Prisma mock ────────────────────────────────────────────────────────────

const mockPrisma: any = {
  cart: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  order: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  paymentGroup: {
    count: jest.fn().mockResolvedValue(0),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('OrderCleanupService', () => {
  let service: OrderCleanupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderCleanupService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrderCleanupService>(OrderCleanupService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  });

  // ─── releaseStaleCartReservations ─────────────────────────────────────

  describe('releaseStaleCartReservations', () => {
    it('releases stock for stale cart items and touches cart updatedAt', async () => {
      mockPrisma.cart.findMany.mockResolvedValueOnce([
        {
          id: 'cart-1',
          items: [
            { id: 'item-1', productId: 'prod-1', variantId: null, quantity: 3 },
            { id: 'item-2', productId: 'prod-2', variantId: 'var-1', quantity: 1 },
          ],
        },
      ]).mockResolvedValueOnce([]); // second call: no more stale carts

      const released = await service.releaseStaleCartReservations();

      expect(released).toBe(2);

      // Stock released for both items.
      expect(releaseStockMock).toHaveBeenCalledTimes(2);
      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma, 'prod-1', null, 3,
      );
      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma, 'prod-2', 'var-1', 1,
      );

      // Cart updatedAt touched.
      expect(mockPrisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cart-1' },
          data: { updatedAt: expect.any(Date) },
        }),
      );
    });

    it('returns 0 when no stale carts exist', async () => {
      mockPrisma.cart.findMany.mockResolvedValue([]);

      const released = await service.releaseStaleCartReservations();

      expect(released).toBe(0);
      expect(releaseStockMock).not.toHaveBeenCalled();
    });

    it('processes multiple batches', async () => {
      // First batch: 100 carts (full batch).
      const batch1 = Array.from({ length: 100 }, (_, i) => ({
        id: `cart-${i}`,
        items: [{ id: `item-${i}`, productId: `prod-${i}`, variantId: null, quantity: 1 }],
      }));
      // Second batch: 10 carts (partial, signals end).
      const batch2 = Array.from({ length: 10 }, (_, i) => ({
        id: `cart-${100 + i}`,
        items: [{ id: `item-${100 + i}`, productId: `prod-${100 + i}`, variantId: null, quantity: 1 }],
      }));

      mockPrisma.cart.findMany
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2);

      const released = await service.releaseStaleCartReservations();

      expect(released).toBe(110);
      expect(mockPrisma.cart.findMany).toHaveBeenCalledTimes(2);
    });

    it('continues processing when one cart fails and bumps updatedAt on failure', async () => {
      mockPrisma.cart.findMany.mockResolvedValueOnce([
        {
          id: 'cart-bad',
          items: [{ id: 'item-bad', productId: 'prod-bad', variantId: null, quantity: 1 }],
        },
        {
          id: 'cart-good',
          items: [{ id: 'item-good', productId: 'prod-good', variantId: null, quantity: 2 }],
        },
      ]).mockResolvedValueOnce([]);

      // First cart's transaction fails.
      mockPrisma.$transaction
        .mockRejectedValueOnce(new Error('DB error'))
        .mockImplementation((fn) => fn(mockPrisma));

      const released = await service.releaseStaleCartReservations();

      // Only the second cart succeeded.
      expect(released).toBe(1);

      // Failed cart's updatedAt was bumped to prevent infinite re-processing.
      expect(mockPrisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cart-bad' },
          data: { updatedAt: expect.any(Date) },
        }),
      );
    });
  });

  // ─── expirePendingOrders ──────────────────────────────────────────────

  describe('expirePendingOrders', () => {
    it('cancels pending orders and releases stock', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([
        {
          id: 'order-1',
          items: [
            { productId: 'prod-1', variantId: null, quantity: 2 },
            { productId: 'prod-2', variantId: 'var-1', quantity: 1 },
          ],
        },
      ]).mockResolvedValueOnce([]);

      const expired = await service.expirePendingOrders();

      expect(expired).toBe(1);

      // Stock released for both items.
      expect(releaseStockMock).toHaveBeenCalledTimes(2);
      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma, 'prod-1', null, 2,
      );
      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma, 'prod-2', 'var-1', 1,
      );

      // Order cancelled with system reason.
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1' },
          data: expect.objectContaining({
            status: OrderStatus.CANCELLED,
            cancelReason: 'SYSTEM:PAYMENT_TIMEOUT',
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('returns 0 when no pending orders are expired', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      const expired = await service.expirePendingOrders();

      expect(expired).toBe(0);
      expect(releaseStockMock).not.toHaveBeenCalled();
    });

    it('processes multiple batches', async () => {
      const batch1 = Array.from({ length: 100 }, (_, i) => ({
        id: `order-${i}`,
        items: [{ productId: `prod-${i}`, variantId: null, quantity: 1 }],
      }));
      const batch2 = Array.from({ length: 5 }, (_, i) => ({
        id: `order-${100 + i}`,
        items: [{ productId: `prod-${100 + i}`, variantId: null, quantity: 1 }],
      }));

      mockPrisma.order.findMany
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2);

      const expired = await service.expirePendingOrders();

      expect(expired).toBe(105);
      expect(mockPrisma.order.findMany).toHaveBeenCalledTimes(2);
    });

    it('continues processing when one order fails', async () => {
      mockPrisma.order.findMany.mockResolvedValueOnce([
        {
          id: 'order-bad',
          items: [{ productId: 'prod-bad', variantId: null, quantity: 1 }],
        },
        {
          id: 'order-good',
          items: [{ productId: 'prod-good', variantId: null, quantity: 1 }],
        },
      ]).mockResolvedValueOnce([]);

      mockPrisma.$transaction
        .mockRejectedValueOnce(new Error('DB error'))
        .mockImplementation((fn) => fn(mockPrisma));

      const expired = await service.expirePendingOrders();

      expect(expired).toBe(1);
    });

    it('only picks up PENDING orders, not other statuses', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.expirePendingOrders();

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: OrderStatus.PENDING,
          }),
        }),
      );
    });

    it('terminates loop when batch is exactly BATCH_SIZE followed by empty batch', async () => {
      // Full batch of 100, then 0 — must not loop forever.
      const fullBatch = Array.from({ length: 100 }, (_, i) => ({
        id: `order-${i}`,
        items: [{ productId: `prod-${i}`, variantId: null, quantity: 1 }],
      }));
      mockPrisma.order.findMany
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce([]);

      const expired = await service.expirePendingOrders();

      expect(expired).toBe(100);
      expect(mockPrisma.order.findMany).toHaveBeenCalledTimes(2);
    });
  });

  // ─── handleCleanup ────────────────────────────────────────────────────

  describe('handleCleanup', () => {
    it('runs both cleanup tasks', async () => {
      mockPrisma.cart.findMany.mockResolvedValue([]);
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.handleCleanup();

      // Both methods called.
      expect(mockPrisma.cart.findMany).toHaveBeenCalled();
      expect(mockPrisma.order.findMany).toHaveBeenCalled();
    });

    it('emits a structured payment_cleanup_summary log line each cycle', async () => {
      mockPrisma.cart.findMany.mockResolvedValue([]);
      mockPrisma.order.findMany.mockResolvedValue([]);
      mockPrisma.paymentGroup.count
        .mockResolvedValueOnce(7) // pendingCount
        .mockResolvedValueOnce(2) // reconcileRequiredCount
        .mockResolvedValueOnce(3); // olderThan30Min

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.handleCleanup();

      const summaryCall = logSpy.mock.calls.find((c) =>
        String(c[0]).includes('payment_cleanup_summary'),
      );
      expect(summaryCall).toBeDefined();
      const payload = JSON.parse(summaryCall![0] as string);
      expect(payload).toMatchObject({
        event: 'payment_cleanup_summary',
        pendingCount: 7,
        reconcileRequiredCount: 2,
        cancelledThisCycle: 0,
        olderThan30Min: 3,
      });
    });
  });
});
