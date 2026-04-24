import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { MerchantOrdersService } from './merchant-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CancelReason } from '../dto/cancel-order.dto';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'merchant-1';
const STORE_ID = 'store-1';
const ORDER_ID = 'order-1';

const baseOrderRow = {
  id: ORDER_ID,
  orderNumber: 'YV-2026-ABC123',
  storeId: STORE_ID,
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
  user: {
    firstName: 'Thandi',
    lastName: 'Dlamini',
    email: 'thandi@example.com',
    phone: '+27821234567',
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

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('MerchantOrdersService', () => {
  let service: MerchantOrdersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get<MerchantOrdersService>(MerchantOrdersService);
    jest.clearAllMocks();

    // Default: user can manage the store.
    mockStoreService.canManageStore.mockResolvedValue(true);
  });

  // ─── Authorization ──────────────────────────────────────────────────────

  describe('authorization', () => {
    it('throws 403 when user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.listOrders(USER_ID, STORE_ID, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('calls canManageStore with correct args', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(USER_ID, STORE_ID, {});

      expect(mockStoreService.canManageStore).toHaveBeenCalledWith(
        USER_ID,
        STORE_ID,
      );
    });
  });

  // ─── listOrders ─────────────────────────────────────────────────────────

  describe('listOrders', () => {
    it('returns paginated order summaries', async () => {
      mockPrisma.order.findMany.mockResolvedValue([
        {
          id: ORDER_ID,
          orderNumber: 'YV-2026-ABC123',
          status: OrderStatus.CONFIRMED,
          subtotalInCents: 90_000,
          totalInCents: 90_000,
          placedAt: new Date('2026-04-20'),
          user: { firstName: 'Thandi', lastName: 'Dlamini' },
          _count: { items: 2 },
        },
      ]);

      const result = await service.listOrders(USER_ID, STORE_ID, {});

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0]).toMatchObject({
        id: ORDER_ID,
        orderNumber: 'YV-2026-ABC123',
        status: OrderStatus.CONFIRMED,
        itemCount: 2,
        buyerName: 'Thandi Dlamini',
      });
      expect(result.nextCursor).toBeNull();
    });

    it('returns nextCursor when there are more pages', async () => {
      // Default page size is 20; return 21 items to trigger pagination.
      const orders = Array.from({ length: 21 }, (_, i) => ({
        id: `order-${i}`,
        orderNumber: `YV-2026-${i}`,
        status: OrderStatus.CONFIRMED,
        subtotalInCents: 10_000,
        totalInCents: 10_000,
        placedAt: new Date('2026-04-20'),
        user: { firstName: 'Test', lastName: 'User' },
        _count: { items: 1 },
      }));
      mockPrisma.order.findMany.mockResolvedValue(orders);

      const result = await service.listOrders(USER_ID, STORE_ID, {});

      expect(result.orders).toHaveLength(20);
      expect(result.nextCursor).toBe('order-19');
    });

    it('filters by status when provided', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(USER_ID, STORE_ID, {
        status: OrderStatus.PROCESSING,
      });

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            storeId: STORE_ID,
            status: OrderStatus.PROCESSING,
          }),
        }),
      );
    });

    it('filters by order number search', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      await service.listOrders(USER_ID, STORE_ID, { search: 'ABC' });

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
    it('returns full order detail with buyer info and items', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(baseOrderRow);

      const result = await service.getOrderDetail(USER_ID, STORE_ID, ORDER_ID);

      expect(result.orderNumber).toBe('YV-2026-ABC123');
      expect(result.buyer).toEqual({
        name: 'Thandi Dlamini',
        email: 'thandi@example.com',
        phone: '+27821234567',
      });
      expect(result.shippingAddress.city).toBe('Durban');
      expect(result.items).toHaveLength(1);
      expect(result.payment).toMatchObject({
        platformCommissionInCents: 4_950,
        merchantPayoutInCents: 85_050,
      });
    });

    it('throws 404 when order does not belong to the store', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...baseOrderRow,
        storeId: 'other-store',
      });

      await expect(
        service.getOrderDetail(USER_ID, STORE_ID, ORDER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.getOrderDetail(USER_ID, STORE_ID, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateStatus ───────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('transitions CONFIRMED → PROCESSING', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.PROCESSING,
      });

      const result = await service.updateStatus(
        USER_ID,
        STORE_ID,
        ORDER_ID,
        OrderStatus.PROCESSING,
      );

      expect(result.status).toBe(OrderStatus.PROCESSING);
    });

    it('transitions PROCESSING → READY_FOR_DISPATCH', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.PROCESSING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.READY_FOR_DISPATCH,
      });

      const result = await service.updateStatus(
        USER_ID,
        STORE_ID,
        ORDER_ID,
        OrderStatus.READY_FOR_DISPATCH,
      );

      expect(result.status).toBe(OrderStatus.READY_FOR_DISPATCH);
    });

    it('rejects invalid transition CONFIRMED → READY_FOR_DISPATCH', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.READY_FOR_DISPATCH,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transition from PENDING (not merchant-driven)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.PENDING,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.CONFIRMED,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when order belongs to another store', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: 'other-store',
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.PROCESSING,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── cancelOrder ────────────────────────────────────────────────────────

  describe('cancelOrder', () => {
    it('cancels a CONFIRMED order with reason', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
        reason: CancelReason.OUT_OF_STOCK,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.CANCELLED,
            cancelReason: 'OUT_OF_STOCK',
          }),
        }),
      );
    });

    it('cancels a PROCESSING order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.PROCESSING,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      const result = await service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
        reason: CancelReason.CANNOT_FULFILL,
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('includes notes when reason is OTHER', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.CONFIRMED,
      });
      mockPrisma.order.update.mockResolvedValue({
        id: ORDER_ID,
        status: OrderStatus.CANCELLED,
      });

      await service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
        reason: CancelReason.OTHER,
        notes: 'Customer requested via WhatsApp',
      });

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelReason: 'OTHER: Customer requested via WhatsApp',
          }),
        }),
      );
    });

    it('rejects cancellation from READY_FOR_DISPATCH', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.READY_FOR_DISPATCH,
      });

      await expect(
        service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
          reason: CancelReason.OUT_OF_STOCK,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancellation from DELIVERED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.DELIVERED,
      });

      await expect(
        service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
          reason: CancelReason.CANNOT_FULFILL,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when order belongs to another store', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: 'other-store',
        status: OrderStatus.CONFIRMED,
      });

      await expect(
        service.cancelOrder(USER_ID, STORE_ID, ORDER_ID, {
          reason: CancelReason.OUT_OF_STOCK,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Phase 10 gap tests ────────────────────────────────────────────────

  describe('updateStatus — backward transitions', () => {
    it('rejects backward transition READY_FOR_DISPATCH → CONFIRMED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.READY_FOR_DISPATCH,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.CONFIRMED,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transition from DELIVERED (terminal state)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.DELIVERED,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.PROCESSING,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transition from CANCELLED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        storeId: STORE_ID,
        status: OrderStatus.CANCELLED,
      });

      await expect(
        service.updateStatus(
          USER_ID,
          STORE_ID,
          ORDER_ID,
          OrderStatus.PROCESSING,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
