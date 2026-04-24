import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminCancelReason } from '../dto/admin-cancel-order.dto';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const ORDER_ID = 'order-1';

const baseOrderRow = {
  id: ORDER_ID,
  orderNumber: 'YV-2026-ABC123',
  storeId: 'store-1',
  status: OrderStatus.CONFIRMED,
  subtotalInCents: 90_000,
  shippingInCents: 0,
  discountInCents: 0,
  totalInCents: 90_000,
  notes: null,
  cancelReason: null,
  placedAt: new Date('2026-04-20'),
  confirmedAt: new Date('2026-04-20'),
  dispatchedAt: null,
  deliveredAt: null,
  cancelledAt: null,
  shippingName: 'Thandi Dlamini',
  shippingPhone: '+27821234567',
  shippingAddress1: '10 Baker St',
  shippingAddress2: null,
  shippingCity: 'Durban',
  shippingProvince: 'KwaZulu-Natal',
  shippingPostalCode: '4001',
  shippingCountry: 'South Africa',
  store: {
    id: 'store-1',
    displayName: 'Jacaranda Studio',
    slug: 'jacaranda-studio',
  },
  user: {
    id: 'buyer-1',
    firstName: 'Thandi',
    lastName: 'Dlamini',
    email: 'thandi@example.com',
    phone: '+27821234567',
    isGuestAccount: false,
  },
  items: [
    {
      id: 'item-1',
      productId: 'prod-1',
      variantId: null,
      productTitle: 'Jacaranda Throw',
      variantName: null,
      productImageUrl: 'https://cdn.example/thumb.jpg',
      quantity: 2,
      unitPriceInCents: 45_000,
      totalInCents: 90_000,
    },
  ],
  payment: {
    status: 'PENDING',
    amountGrossInCents: 90_000,
    amountFeeInCents: 0,
    amountNetInCents: 90_000,
    platformCommissionInCents: 4_950,
    merchantPayoutInCents: 85_050,
  },
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma = {
  order: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('AdminOrdersService', () => {
  let service: AdminOrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminOrdersService>(AdminOrdersService);
    jest.clearAllMocks();
  });

  // ─── listOrders ─────────────────────────────────────────────────────────

  describe('listOrders', () => {
    it('returns paginated cross-store order summaries', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        {
          id: ORDER_ID,
          orderNumber: 'YV-2026-ABC123',
          status: OrderStatus.CONFIRMED,
          subtotalInCents: 90_000,
          totalInCents: 90_000,
          placedAt: new Date('2026-04-20'),
          store: { displayName: 'Jacaranda Studio' },
          user: {
            firstName: 'Thandi',
            lastName: 'Dlamini',
            email: 'thandi@example.com',
          },
          _count: { items: 2 },
        },
      ]);

      const result = await service.listOrders({});

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0]).toMatchObject({
        id: ORDER_ID,
        storeName: 'Jacaranda Studio',
        buyerName: 'Thandi Dlamini',
        buyerEmail: 'thandi@example.com',
        itemCount: 2,
      });
      expect(result.nextCursor).toBeNull();
    });

    it('filters by storeId', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders({ storeId: 'store-1' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ storeId: 'store-1' }),
        }),
      );
    });

    it('filters by status', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders({ status: OrderStatus.PROCESSING });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: OrderStatus.PROCESSING }),
        }),
      );
    });

    it('filters by buyer email', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders({ buyerEmail: 'Thandi@Example.com' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              email: { contains: 'thandi@example.com', mode: 'insensitive' },
            },
          }),
        }),
      );
    });

    it('filters by order number search', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders({ search: 'ABC' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderNumber: { contains: 'ABC', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('returns nextCursor when there are more pages', async () => {
      const orders = Array.from({ length: 21 }, (_, i) => ({
        id: `order-${i}`,
        orderNumber: `YV-2026-${i}`,
        status: OrderStatus.CONFIRMED,
        subtotalInCents: 10_000,
        totalInCents: 10_000,
        placedAt: new Date('2026-04-20'),
        store: { displayName: 'Store' },
        user: { firstName: 'Test', lastName: 'User', email: 'test@test.com' },
        _count: { items: 1 },
      }));
      mockPrisma.order.findMany.mockResolvedValue(orders);

      const result = await service.listOrders({});

      expect(result.orders).toHaveLength(20);
      expect(result.nextCursor).toBe('order-19');
    });
  });

  // ─── getOrderDetail ─────────────────────────────────────────────────────

  describe('getOrderDetail', () => {
    it('returns full detail with payment internals and buyer info', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(baseOrderRow);

      const result = await service.getOrderDetail(ORDER_ID);

      expect(result.orderNumber).toBe('YV-2026-ABC123');
      expect(result.store.displayName).toBe('Jacaranda Studio');
      expect(result.buyer).toMatchObject({
        id: 'buyer-1',
        email: 'thandi@example.com',
        isGuestAccount: false,
      });
      expect(result.payment).toMatchObject({
        platformCommissionInCents: 4_950,
        merchantPayoutInCents: 85_050,
        amountFeeInCents: 0,
      });
      expect(result.timeline.confirmedAt).toEqual(new Date('2026-04-20'));
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.getOrderDetail('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── forceConfirm ───────────────────────────────────────────────────────

  describe('forceConfirm', () => {
    it('confirms a PENDING order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PENDING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      const result = await service.forceConfirm(ORDER_ID);

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.CONFIRMED,
            confirmedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects force-confirm on non-PENDING order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      await expect(service.forceConfirm(ORDER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.forceConfirm('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── cancelOrder ────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels a CONFIRMED order with admin reason', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(ORDER_ID, {
        reason: AdminCancelReason.FRAUD,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'ADMIN:FRAUD',
          }),
        }),
      );
    });

    it('cancels from READY_FOR_DISPATCH (admin override)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.READY_FOR_DISPATCH,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(ORDER_ID, {
        reason: AdminCancelReason.CUSTOMER_REQUEST,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('cancels from DISPATCHED (admin override)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.DISPATCHED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(ORDER_ID, {
        reason: AdminCancelReason.POLICY_VIOLATION,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('includes notes when reason is OTHER', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      await service.cancelOrder(ORDER_ID, {
        reason: AdminCancelReason.OTHER,
        notes: 'Duplicate order flagged by ops',
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'ADMIN:OTHER: Duplicate order flagged by ops',
          }),
        }),
      );
    });

    it('rejects cancellation of DELIVERED orders', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.DELIVERED,
      });

      await expect(
        service.cancelOrder(ORDER_ID, {
          reason: AdminCancelReason.FRAUD,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancellation of already cancelled orders', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      await expect(
        service.cancelOrder(ORDER_ID, {
          reason: AdminCancelReason.FRAUD,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancellation of REFUNDED orders', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUNDED,
      });

      await expect(
        service.cancelOrder(ORDER_ID, {
          reason: AdminCancelReason.FRAUD,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── editOrder ──────────────────────────────────────────────────────────

  describe('editOrder', () => {
    it('updates shipping address fields', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      await service.editOrder(ORDER_ID, {
        shippingCity: 'Cape Town',
        shippingProvince: 'Western Cape',
        shippingPostalCode: '8001',
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            shippingCity: 'Cape Town',
            shippingProvince: 'Western Cape',
            shippingPostalCode: '8001',
          },
        }),
      );
    });

    it('updates notes', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      await service.editOrder(ORDER_ID, { notes: 'Updated by admin' });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { notes: 'Updated by admin' },
        }),
      );
    });

    it('throws 400 when no fields provided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      await expect(service.editOrder(ORDER_ID, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.editOrder('nonexistent', { notes: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── requestRefund ──────────────────────────────────────────────────────

  describe('requestRefund', () => {
    it('sets status to REFUND_REQUESTED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUND_REQUESTED,
      });

      const result = await service.requestRefund(ORDER_ID);

      expect(result.status).toBe(OrderStatus.REFUND_REQUESTED);
    });

    it('rejects refund on PENDING order (cancel instead)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PENDING,
      });

      await expect(service.requestRefund(ORDER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects refund on already refunded order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUNDED,
      });

      await expect(service.requestRefund(ORDER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects duplicate refund request', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUND_REQUESTED,
      });

      await expect(service.requestRefund(ORDER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.requestRefund('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows refund on CANCELLED order (not explicitly rejected)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUND_REQUESTED,
      });

      const result = await service.requestRefund(ORDER_ID);

      expect(result.status).toBe(OrderStatus.REFUND_REQUESTED);
    });

    it('allows refund on DISPATCHED order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.DISPATCHED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.REFUND_REQUESTED,
      });

      const result = await service.requestRefund(ORDER_ID);

      expect(result.status).toBe(OrderStatus.REFUND_REQUESTED);
    });
  });

  // ─── Phase 10 gap tests ────────────────────────────────────────────────

  describe('editOrder — edge cases', () => {
    it('accepts empty string values (clears the field)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
      });

      await service.editOrder(ORDER_ID, { shippingName: '' });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { shippingName: '' },
        }),
      );
    });
  });
});
