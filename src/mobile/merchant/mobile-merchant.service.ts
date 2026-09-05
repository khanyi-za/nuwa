import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MerchantOrdersService } from '../../order/merchant-orders/merchant-orders.service';
import { StoreAnalyticsService } from '../../store/analytics/store-analytics.service';
import { InventoryService } from '../../product/inventory/inventory.service';
import { CancelOrderDto } from '../../order/dto/cancel-order.dto';
import { Paginated } from '../common/paginated';
import { MerchantSalesQueryDto } from './dto/merchant-sales-query.dto';
import { UpdateSaleStatusDto } from './dto/update-sale-status.dto';
import {
  toOverviewView,
  toSaleDetailView,
  toSaleSummaryView,
} from './mobile-merchant.serializers';

const DEFAULT_TAKE = 20;

export interface ManagedStoreView {
  id: string;
  displayName: string;
  slug: string;
  status: StoreStatus;
  logoUrl: string | null;
}

const managedStoreSelect = {
  id: true,
  displayName: true,
  slug: true,
  status: true,
  logoUrl: true,
} as const;

/**
 * Mobile merchant surface ("Manage my store" in maya). Thin orchestration over
 * the existing merchant services — every wrapped call re-runs canManageStore
 * internally, kept as defense-in-depth. The store is resolved from the user
 * (no storeId in the mobile routes), covering owners AND accepted active
 * employees, mirroring StoreService.canManageStore's membership rule.
 *
 * Deliberately NOT status-gated: a SUSPENDED/CLOSED store still has in-flight
 * sales to fulfil and buyers to answer. maya renders a banner off store.status.
 */
@Injectable()
export class MobileMerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchantOrders: MerchantOrdersService,
    private readonly analytics: StoreAnalyticsService,
    private readonly inventory: InventoryService,
  ) {}

  async resolveManagedStore(userId: string): Promise<ManagedStoreView> {
    const owned = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      select: managedStoreSelect,
    });
    if (owned) return owned;

    const employment = await this.prisma.storeEmployee.findFirst({
      where: { userId, isActive: true, acceptedAt: { not: null } },
      select: { store: { select: managedStoreSelect } },
    });
    if (employment) return employment.store;

    throw new NotFoundException({
      code: 'NO_STORE',
      message: 'No store is linked to this account.',
    });
  }

  async getStore(userId: string) {
    const store = await this.resolveManagedStore(userId);
    return { store };
  }

  async getOverview(userId: string) {
    const store = await this.resolveManagedStore(userId);
    const [analytics, statusCounts] = await Promise.all([
      this.analytics.getAnalytics(userId, store.id),
      this.prisma.order.groupBy({
        by: ['status'],
        where: {
          storeId: store.id,
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING] },
        },
        _count: { _all: true },
      }),
    ]);
    const countFor = (status: OrderStatus) =>
      statusCounts.find((row) => row.status === status)?._count._all ?? 0;
    return toOverviewView(analytics, {
      newSales: countFor(OrderStatus.CONFIRMED),
      preparing: countFor(OrderStatus.PROCESSING),
    });
  }

  async listOrders(userId: string, query: MerchantSalesQueryDto) {
    const store = await this.resolveManagedStore(userId);
    const result = await this.merchantOrders.listOrders(userId, store.id, {
      status: query.status,
      search: query.search,
      cursor: query.cursor,
      // The web DTO carries take as a string; convert at the boundary.
      take: String(query.take ?? DEFAULT_TAKE),
    });
    return new Paginated(
      { orders: result.orders.map(toSaleSummaryView) },
      {
        limit: query.take ?? DEFAULT_TAKE,
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor,
      },
    );
  }

  async getOrderDetail(userId: string, orderId: string) {
    const store = await this.resolveManagedStore(userId);
    const order = await this.merchantOrders.getOrderDetail(
      userId,
      store.id,
      orderId,
    );
    return { order: toSaleDetailView(order) };
  }

  async updateStatus(userId: string, orderId: string, dto: UpdateSaleStatusDto) {
    const store = await this.resolveManagedStore(userId);
    try {
      return await this.merchantOrders.updateStatus(
        userId,
        store.id,
        orderId,
        dto.status,
      );
    } catch (err) {
      throw this.withCode(err, 'INVALID_TRANSITION');
    }
  }

  async cancelOrder(userId: string, orderId: string, dto: CancelOrderDto) {
    const store = await this.resolveManagedStore(userId);
    try {
      return await this.merchantOrders.cancelOrder(
        userId,
        store.id,
        orderId,
        dto,
      );
    } catch (err) {
      throw this.withCode(err, 'CANNOT_CANCEL');
    }
  }

  async getLowStock(userId: string) {
    const store = await this.resolveManagedStore(userId);
    return this.inventory.getLowStock(userId, store.id);
  }

  /**
   * Re-tag a BadRequestException with a domain code so maya can branch on
   * error.code instead of the generic VALIDATION_ERROR the mobile exception
   * filter assigns to bare 400s. Everything else propagates unchanged.
   */
  private withCode(err: unknown, code: string): unknown {
    if (err instanceof BadRequestException) {
      return new BadRequestException({ code, message: err.message });
    }
    return err;
  }
}
