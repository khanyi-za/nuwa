import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { BuyerOrdersService } from './buyer-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShipmentCancellationService } from '../../shipping/shipment-cancellation.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { BuyerCancelReason } from '../dto/buyer-cancel-order.dto';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'buyer-1';
const ORDER_ID = 'order-1';

const baseOrderRow = {
  id: ORDER_ID,
  orderNumber: 'YV-2026-ABC123',
  userId: USER_ID,
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
    displayName: 'Jacaranda Studio',
    slug: 'jacaranda-studio',
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
  payment: { status: 'PENDING' },
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

describe('BuyerOrdersService', () => {
  let service: BuyerOrdersService;

  const mockShipmentCancellation = {
    cancelShipmentForOrder: jest.fn().mockResolvedValue(false),
  };
  const mockNotifications = { orderCancelled: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyerOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ShipmentCancellationService,
          useValue: mockShipmentCancellation,
        },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<BuyerOrdersService>(BuyerOrdersService);
    jest.clearAllMocks();
  });

  // ─── listOrders ─────────────────────────────────────────────────────────

  describe('listOrders', () => {
    it('returns paginated order summaries with store name', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        {
          id: ORDER_ID,
          orderNumber: 'YV-2026-ABC123',
          status: OrderStatus.CONFIRMED,
          subtotalInCents: 90_000,
          totalInCents: 90_000,
          placedAt: new Date('2026-04-20'),
          store: { displayName: 'Jacaranda Studio' },
          _count: { items: 2 },
        },
      ]);

      const result = await service.listOrders(USER_ID, {});

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0]).toMatchObject({
        id: ORDER_ID,
        storeName: 'Jacaranda Studio',
        itemCount: 2,
      });
      expect(result.nextCursor).toBeNull();
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
        _count: { items: 1 },
      }));
      mockPrisma.order.findMany.mockResolvedValue(orders);

      const result = await service.listOrders(USER_ID, {});

      expect(result.orders).toHaveLength(20);
      expect(result.nextCursor).toBe('order-19');
    });

    it('filters by status', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(USER_ID, { status: OrderStatus.DELIVERED });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: OrderStatus.DELIVERED,
          }),
        }),
      );
    });

    it('filters by order number search', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(USER_ID, { search: 'ABC' });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderNumber: { contains: 'ABC', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  // ─── getOrderDetail ─────────────────────────────────────────────────────

  describe('getOrderDetail', () => {
    it('returns full order detail with timeline and no commission info', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(baseOrderRow);

      const result = await service.getOrderDetail(USER_ID, ORDER_ID);

      expect(result.orderNumber).toBe('YV-2026-ABC123');
      expect(result.storeName).toBe('Jacaranda Studio');
      expect(result.timeline.placedAt).toEqual(new Date('2026-04-20'));
      expect(result.timeline.confirmedAt).toEqual(new Date('2026-04-20'));
      expect(result.timeline.deliveredAt).toBeNull();
      expect(result.shippingAddress.city).toBe('Durban');
      expect(result.items).toHaveLength(1);
      expect(result.paymentStatus).toBe('PENDING');
      // No commission/payout fields exposed.
      expect((result as any).platformCommissionInCents).toBeUndefined();
      expect((result as any).merchantPayoutInCents).toBeUndefined();
    });

    it('throws 404 when order belongs to another user', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...baseOrderRow,
        userId: 'other-user',
      });

      await expect(
        service.getOrderDetail(USER_ID, ORDER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.getOrderDetail(USER_ID, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── cancelOrder ────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels a PENDING order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.PENDING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(USER_ID, ORDER_ID, {
        reason: BuyerCancelReason.CHANGED_MIND,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'CHANGED_MIND',
          }),
        }),
      );
    });

    it('cancels a CONFIRMED order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(USER_ID, ORDER_ID, {
        reason: BuyerCancelReason.ORDERED_BY_MISTAKE,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('includes notes when reason is OTHER', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.PENDING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      await service.cancelOrder(USER_ID, ORDER_ID, {
        reason: BuyerCancelReason.OTHER,
        notes: 'Wrong delivery address',
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'OTHER: Wrong delivery address',
          }),
        }),
      );
    });

    it('rejects cancellation from PROCESSING', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.PROCESSING,
      });

      await expect(
        service.cancelOrder(USER_ID, ORDER_ID, {
          reason: BuyerCancelReason.CHANGED_MIND,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancellation from DELIVERED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.DELIVERED,
      });

      await expect(
        service.cancelOrder(USER_ID, ORDER_ID, {
          reason: BuyerCancelReason.FOUND_CHEAPER,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when order belongs to another user', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: 'other-user',
        status: OrderStatus.PENDING,
      });

      await expect(
        service.cancelOrder(USER_ID, ORDER_ID, {
          reason: BuyerCancelReason.CHANGED_MIND,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Phase 10 gap tests ────────────────────────────────────────────────

  describe('getOrderDetail — payment edge cases', () => {
    it('returns null paymentStatus when payment relation is null', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...baseOrderRow,
        payment: null,
      });

      const result = await service.getOrderDetail(USER_ID, ORDER_ID);

      expect(result.paymentStatus).toBeNull();
    });
  });

  describe('cancelOrder — notes formatting', () => {
    it('stores reason without notes when notes are undefined', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        userId: USER_ID,
        status: OrderStatus.PENDING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      await service.cancelOrder(USER_ID, ORDER_ID, {
        reason: BuyerCancelReason.OTHER,
      });

      // When notes is undefined, only the reason is stored (no trailing ": undefined").
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'OTHER',
          }),
        }),
      );
    });
  });
});
