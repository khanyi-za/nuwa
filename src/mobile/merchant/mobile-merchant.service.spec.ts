import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, StoreStatus } from '@prisma/client';
import { MobileMerchantService } from './mobile-merchant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantOrdersService } from '../../order/merchant-orders/merchant-orders.service';
import { StoreAnalyticsService } from '../../store/analytics/store-analytics.service';
import { InventoryService } from '../../product/inventory/inventory.service';
import { CancelReason } from '../../order/dto/cancel-order.dto';

const USER_ID = 'user-1';

const storeRow = {
  id: 'store-1',
  displayName: 'Tol’thema',
  slug: 'tolthema',
  status: StoreStatus.ACTIVE,
  logoUrl: 'https://res.cloudinary.com/yiiva-dev/image/upload/logo.png',
};

const analyticsResponse = {
  window: { days: 14, from: '2026-08-17', to: '2026-08-30' },
  revenue: {
    valueInCents: 254_600,
    trendPct: 12.4,
    series: [{ date: '2026-08-17', valueInCents: 12_000 }],
  },
  orders: { count: 8, trendPct: 5.1, spark: [1, 0, 2, 1] },
  followers: { count: 1933, trendPct: 0, spark: [1933, 1933] },
  activeProducts: { count: 40, trendPct: 0, spark: [40, 40] },
  rating: { value: 4.7, trendPct: 0, spark: [47, 47] },
};

const saleSummary = {
  id: 'order-1',
  orderNumber: 'YV-2026-D00142',
  status: OrderStatus.CONFIRMED,
  subtotalInCents: 89_900,
  totalInCents: 100_900,
  itemCount: 2,
  buyerName: 'Naledi Dlamini',
  placedAt: new Date('2026-08-28T09:00:00Z'),
};

const mockPrisma = {
  store: { findUnique: jest.fn() },
  storeEmployee: { findFirst: jest.fn() },
  order: { groupBy: jest.fn() },
};

const mockMerchantOrders = {
  listOrders: jest.fn(),
  getOrderDetail: jest.fn(),
  updateStatus: jest.fn(),
  cancelOrder: jest.fn(),
};

const mockAnalytics = { getAnalytics: jest.fn() };
const mockInventory = { getLowStock: jest.fn() };

describe('MobileMerchantService', () => {
  let service: MobileMerchantService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileMerchantService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MerchantOrdersService, useValue: mockMerchantOrders },
        { provide: StoreAnalyticsService, useValue: mockAnalytics },
        { provide: InventoryService, useValue: mockInventory },
      ],
    }).compile();
    service = module.get(MobileMerchantService);
    jest.clearAllMocks();
  });

  describe('resolveManagedStore', () => {
    it('returns the owned store for an owner', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);

      const result = await service.resolveManagedStore(USER_ID);

      expect(result).toEqual(storeRow);
      expect(mockPrisma.store.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: USER_ID } }),
      );
      expect(mockPrisma.storeEmployee.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to an accepted active employment when the user owns nothing', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);
      mockPrisma.storeEmployee.findFirst.mockResolvedValue({ store: storeRow });

      const result = await service.resolveManagedStore(USER_ID);

      expect(result).toEqual(storeRow);
      // Must mirror canManageStore's membership rule exactly.
      expect(mockPrisma.storeEmployee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, isActive: true, acceptedAt: { not: null } },
        }),
      );
    });

    it('throws 404 NO_STORE when the user manages nothing', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);
      mockPrisma.storeEmployee.findFirst.mockResolvedValue(null);

      await expect(service.resolveManagedStore(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.resolveManagedStore(USER_ID),
      ).rejects.toMatchObject({ response: { code: 'NO_STORE' } });
    });
  });

  describe('getStore', () => {
    it('wraps the resolved store under a named key', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);

      await expect(service.getStore(USER_ID)).resolves.toEqual({
        store: storeRow,
      });
    });
  });

  describe('getOverview', () => {
    it('re-serializes the analytics contract: sparks and activeProducts dropped, values untouched', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockPrisma.order.groupBy.mockResolvedValue([
        { status: OrderStatus.CONFIRMED, _count: { _all: 3 } },
        { status: OrderStatus.PROCESSING, _count: { _all: 1 } },
      ]);
      mockAnalytics.getAnalytics.mockResolvedValue(analyticsResponse);

      const result = await service.getOverview(USER_ID);

      expect(mockAnalytics.getAnalytics).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
      );
      expect(result).toEqual({
        window: analyticsResponse.window,
        revenue: {
          valueInCents: 254_600,
          trendPct: 12.4,
          series: analyticsResponse.revenue.series,
        },
        orders: { count: 8, trendPct: 5.1 },
        followers: { count: 1933, trendPct: 0 },
        rating: { value: 4.7, trendPct: 0 },
        actionable: { newSales: 3, preparing: 1 },
      });
      expect(result).not.toHaveProperty('activeProducts');
      expect((result.orders as any).spark).toBeUndefined();
    });

    it('reports zero actionable counts when the work queue is empty', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockPrisma.order.groupBy.mockResolvedValue([]);
      mockAnalytics.getAnalytics.mockResolvedValue(analyticsResponse);

      const result = await service.getOverview(USER_ID);

      expect(result.actionable).toEqual({ newSales: 0, preparing: 0 });
    });
  });

  describe('listOrders', () => {
    it('forwards a numeric take as the string the web DTO expects and wraps in Paginated', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.listOrders.mockResolvedValue({
        orders: [saleSummary],
        nextCursor: 'order-1',
      });

      const result = await service.listOrders(USER_ID, {
        status: OrderStatus.CONFIRMED,
        take: 10,
      });

      expect(mockMerchantOrders.listOrders).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
        {
          status: OrderStatus.CONFIRMED,
          search: undefined,
          cursor: undefined,
          take: '10',
        },
      );
      expect(result.data).toEqual({ orders: [saleSummary] });
      expect(result.pagination).toEqual({
        limit: 10,
        hasMore: true,
        nextCursor: 'order-1',
      });
    });

    it('defaults take to 20 and reports hasMore=false on a final page', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.listOrders.mockResolvedValue({
        orders: [],
        nextCursor: null,
      });

      const result = await service.listOrders(USER_ID, {});

      expect(mockMerchantOrders.listOrders).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
        expect.objectContaining({ take: '20' }),
      );
      expect(result.pagination).toEqual({
        limit: 20,
        hasMore: false,
        nextCursor: null,
      });
    });
  });

  describe('getOrderDetail', () => {
    it('delegates with the resolved store and wraps under a named key', async () => {
      const detail = { ...saleSummary, items: [] };
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.getOrderDetail.mockResolvedValue(detail);

      await expect(service.getOrderDetail(USER_ID, 'order-1')).resolves.toEqual(
        { order: detail },
      );
      expect(mockMerchantOrders.getOrderDetail).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
        'order-1',
      );
    });

    it('propagates NotFoundException unchanged (404-not-403)', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.getOrderDetail.mockRejectedValue(
        new NotFoundException('Order not found'),
      );

      await expect(
        service.getOrderDetail(USER_ID, 'order-x'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('passes a valid transition through', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.updateStatus.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.PROCESSING,
      });

      await expect(
        service.updateStatus(USER_ID, 'order-1', {
          status: OrderStatus.PROCESSING,
        }),
      ).resolves.toEqual({ id: 'order-1', status: OrderStatus.PROCESSING });
    });

    it('re-tags an invalid transition as INVALID_TRANSITION', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.updateStatus.mockRejectedValue(
        new BadRequestException(
          'Cannot transition from DELIVERED to PROCESSING',
        ),
      );

      await expect(
        service.updateStatus(USER_ID, 'order-1', {
          status: OrderStatus.PROCESSING,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_TRANSITION',
          message: 'Cannot transition from DELIVERED to PROCESSING',
        },
      });
    });

    it('propagates ForbiddenException unchanged', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.updateStatus.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.updateStatus(USER_ID, 'order-1', {
          status: OrderStatus.PROCESSING,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelOrder', () => {
    it('re-tags an uncancellable state as CANNOT_CANCEL', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.cancelOrder.mockRejectedValue(
        new BadRequestException('Order can no longer be cancelled'),
      );

      await expect(
        service.cancelOrder(USER_ID, 'order-1', {
          reason: CancelReason.OUT_OF_STOCK,
        }),
      ).rejects.toMatchObject({ response: { code: 'CANNOT_CANCEL' } });
    });

    it('passes a valid cancel through with the dto intact', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockMerchantOrders.cancelOrder.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CANCELLED,
      });

      const dto = { reason: CancelReason.OTHER, notes: 'Buyer asked us to' };
      await expect(
        service.cancelOrder(USER_ID, 'order-1', dto),
      ).resolves.toEqual({ id: 'order-1', status: OrderStatus.CANCELLED });
      expect(mockMerchantOrders.cancelOrder).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
        'order-1',
        dto,
      );
    });
  });

  describe('getLowStock', () => {
    it('delegates with the resolved store id', async () => {
      const lowStock = { items: [], count: 0 };
      mockPrisma.store.findUnique.mockResolvedValue(storeRow);
      mockInventory.getLowStock.mockResolvedValue(lowStock);

      await expect(service.getLowStock(USER_ID)).resolves.toEqual(lowStock);
      expect(mockInventory.getLowStock).toHaveBeenCalledWith(
        USER_ID,
        storeRow.id,
      );
    });
  });
});
