import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { MerchantOrderQueryDto } from '../dto/merchant-order-query.dto';
import { CancelOrderDto, CancelReason } from '../dto/cancel-order.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Allowed merchant-driven forward transitions. */
const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING],
  [OrderStatus.PROCESSING]: [OrderStatus.READY_FOR_DISPATCH],
};

/** States from which a merchant can cancel. */
const CANCELLABLE_STATES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
];

// ─── Response shapes ───────────────────────────────────────────────────────

export interface MerchantOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotalInCents: number;
  totalInCents: number;
  itemCount: number;
  buyerName: string;
  placedAt: Date;
}

export interface MerchantOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotalInCents: number;
  shippingInCents: number;
  discountInCents: number;
  totalInCents: number;
  notes: string | null;
  cancelReason: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  buyer: {
    name: string;
    email: string;
    phone: string | null;
  };
  shippingAddress: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    productTitle: string;
    variantName: string | null;
    productImageUrl: string | null;
    quantity: number;
    unitPriceInCents: number;
    totalInCents: number;
  }[];
  payment: {
    status: string;
    amountGrossInCents: number;
    platformCommissionInCents: number;
    merchantPayoutInCents: number;
  } | null;
}

export interface PaginatedOrders {
  orders: MerchantOrderSummary[];
  nextCursor: string | null;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class MerchantOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  /**
   * List orders for a store with optional status filter, order number search,
   * and cursor-based pagination. Sorted newest first.
   */
  async listOrders(
    userId: string,
    storeId: string,
    query: MerchantOrderQueryDto,
  ): Promise<PaginatedOrders> {
    await this.assertCanManageStore(userId, storeId);

    const take = Math.min(
      parseInt(query.take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const where: any = { storeId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.orderNumber = { contains: query.search, mode: 'insensitive' };
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      take: take + 1, // fetch one extra to determine if there's a next page
      ...(query.cursor && {
        cursor: { id: query.cursor },
        skip: 1, // skip the cursor itself
      }),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        subtotalInCents: true,
        totalInCents: true,
        placedAt: true,
        user: {
          select: { firstName: true, lastName: true },
        },
        _count: { select: { items: true } },
      },
    });

    const hasMore = orders.length > take;
    const page = hasMore ? orders.slice(0, take) : orders;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return {
      orders: page.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        subtotalInCents: o.subtotalInCents,
        totalInCents: o.totalInCents,
        itemCount: o._count.items,
        buyerName: `${o.user.firstName} ${o.user.lastName}`,
        placedAt: o.placedAt,
      })),
      nextCursor,
    };
  }

  /**
   * Full order detail including items, buyer info, shipping address, and payment.
   */
  async getOrderDetail(
    userId: string,
    storeId: string,
    orderId: string,
  ): Promise<MerchantOrderDetail> {
    await this.assertCanManageStore(userId, storeId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true, phone: true },
        },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            productTitle: true,
            variantName: true,
            productImageUrl: true,
            quantity: true,
            unitPriceInCents: true,
            totalInCents: true,
          },
        },
        payment: {
          select: {
            status: true,
            amountGrossInCents: true,
            platformCommissionInCents: true,
            merchantPayoutInCents: true,
          },
        },
      },
    });

    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('Order not found');
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotalInCents: order.subtotalInCents,
      shippingInCents: order.shippingInCents,
      discountInCents: order.discountInCents,
      totalInCents: order.totalInCents,
      notes: order.notes,
      cancelReason: order.cancelReason,
      placedAt: order.placedAt,
      confirmedAt: order.confirmedAt,
      dispatchedAt: order.dispatchedAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      buyer: {
        name: `${order.user.firstName} ${order.user.lastName}`,
        email: order.user.email,
        phone: order.user.phone,
      },
      shippingAddress: {
        recipientName: order.shippingName,
        phone: order.shippingPhone,
        addressLine1: order.shippingAddress1,
        addressLine2: order.shippingAddress2,
        city: order.shippingCity,
        province: order.shippingProvince,
        postalCode: order.shippingPostalCode,
        country: order.shippingCountry,
      },
      items: order.items,
      payment: order.payment,
    };
  }

  /**
   * Advance order status: CONFIRMED → PROCESSING → READY_FOR_DISPATCH.
   */
  async updateStatus(
    userId: string,
    storeId: string,
    orderId: string,
    targetStatus: OrderStatus,
  ): Promise<{ id: string; status: OrderStatus }> {
    await this.assertCanManageStore(userId, storeId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, storeId: true, status: true },
    });

    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('Order not found');
    }

    const allowed = ALLOWED_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${order.status} to ${targetStatus}`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: targetStatus,
        ...(targetStatus === OrderStatus.READY_FOR_DISPATCH && {
          // No dispatch timestamp yet — that's set when courier picks up (Shipping module).
        }),
      },
      select: { id: true, status: true },
    });

    return updated;
  }

  /**
   * Merchant cancels an order from CONFIRMED or PROCESSING.
   */
  async cancelOrder(
    userId: string,
    storeId: string,
    orderId: string,
    dto: CancelOrderDto,
  ): Promise<{ id: string; status: OrderStatus }> {
    await this.assertCanManageStore(userId, storeId);

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, storeId: true, status: true },
    });

    if (!order || order.storeId !== storeId) {
      throw new NotFoundException('Order not found');
    }

    if (!CANCELLABLE_STATES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel an order in ${order.status} status`,
      );
    }

    const cancelReasonText =
      dto.reason === CancelReason.OTHER && dto.notes
        ? `${dto.reason}: ${dto.notes}`
        : dto.reason;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelReason: cancelReasonText,
        cancelledAt: new Date(),
      },
      select: { id: true, status: true },
    });

    return updated;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async assertCanManageStore(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }
  }
}
