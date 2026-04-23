import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrderQueryDto } from '../dto/admin-order-query.dto';
import { AdminCancelOrderDto, AdminCancelReason } from '../dto/admin-cancel-order.dto';
import { AdminEditOrderDto } from '../dto/admin-edit-order.dto';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Terminal states — orders here cannot be modified further.
 * Admin can cancel from any state EXCEPT these.
 */
const TERMINAL_STATES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.REFUNDED,
];

// ─── Response shapes ───────────────────────────────────────────────────────

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  storeName: string;
  subtotalInCents: number;
  totalInCents: number;
  itemCount: number;
  buyerName: string;
  buyerEmail: string;
  placedAt: Date;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotalInCents: number;
  shippingInCents: number;
  discountInCents: number;
  totalInCents: number;
  notes: string | null;
  cancelReason: string | null;
  timeline: {
    placedAt: Date;
    confirmedAt: Date | null;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
    cancelledAt: Date | null;
  };
  store: {
    id: string;
    displayName: string;
    slug: string;
  };
  buyer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    isGuestAccount: boolean;
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
    amountFeeInCents: number;
    amountNetInCents: number;
    platformCommissionInCents: number;
    merchantPayoutInCents: number;
  } | null;
}

export interface PaginatedAdminOrders {
  orders: AdminOrderSummary[];
  nextCursor: string | null;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cross-store order list with store, status, order number, and buyer email filters.
   */
  async listOrders(
    query: AdminOrderQueryDto,
  ): Promise<PaginatedAdminOrders> {
    const take = Math.min(
      parseInt(query.take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const where: any = {};

    if (query.storeId) {
      where.storeId = query.storeId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.orderNumber = { contains: query.search, mode: 'insensitive' };
    }

    if (query.buyerEmail) {
      where.user = {
        email: { contains: query.buyerEmail.toLowerCase(), mode: 'insensitive' },
      };
    }

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      take: take + 1,
      ...(query.cursor && {
        cursor: { id: query.cursor },
        skip: 1,
      }),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        subtotalInCents: true,
        totalInCents: true,
        placedAt: true,
        store: {
          select: { displayName: true },
        },
        user: {
          select: { firstName: true, lastName: true, email: true },
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
        storeName: o.store.displayName,
        subtotalInCents: o.subtotalInCents,
        totalInCents: o.totalInCents,
        itemCount: o._count.items,
        buyerName: `${o.user.firstName} ${o.user.lastName}`,
        buyerEmail: o.user.email,
        placedAt: o.placedAt,
      })),
      nextCursor,
    };
  }

  /**
   * Full order detail — admin sees everything including payment internals,
   * commission, merchant payout, and buyer account type.
   */
  async getOrderDetail(orderId: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: {
          select: { id: true, displayName: true, slug: true },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            isGuestAccount: true,
          },
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
            amountFeeInCents: true,
            amountNetInCents: true,
            platformCommissionInCents: true,
            merchantPayoutInCents: true,
          },
        },
      },
    });

    if (!order) {
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
      timeline: {
        placedAt: order.placedAt,
        confirmedAt: order.confirmedAt,
        dispatchedAt: order.dispatchedAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
      },
      store: order.store,
      buyer: {
        id: order.user.id,
        name: `${order.user.firstName} ${order.user.lastName}`,
        email: order.user.email,
        phone: order.user.phone,
        isGuestAccount: order.user.isGuestAccount,
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
   * Admin forces CONFIRMED status (manual payment verification).
   */
  async forceConfirm(
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.findOrderOrThrow(orderId);

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Can only force-confirm PENDING orders. This order is ${order.status}.`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
      select: { id: true, status: true },
    });

    return updated;
  }

  /**
   * Admin cancels an order from any non-terminal state.
   */
  async cancelOrder(
    orderId: string,
    dto: AdminCancelOrderDto,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.findOrderOrThrow(orderId);

    if (TERMINAL_STATES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel an order in ${order.status} status.`,
      );
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Order is already cancelled.');
    }

    const cancelReasonText =
      dto.reason === AdminCancelReason.OTHER && dto.notes
        ? `ADMIN:${dto.reason}: ${dto.notes}`
        : `ADMIN:${dto.reason}`;

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

  /**
   * Admin edits order details (shipping address, notes).
   */
  async editOrder(
    orderId: string,
    dto: AdminEditOrderDto,
  ): Promise<{ id: string; status: OrderStatus }> {
    await this.findOrderOrThrow(orderId);

    const data: any = {};

    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.shippingName !== undefined) data.shippingName = dto.shippingName;
    if (dto.shippingPhone !== undefined) data.shippingPhone = dto.shippingPhone;
    if (dto.shippingAddress1 !== undefined) data.shippingAddress1 = dto.shippingAddress1;
    if (dto.shippingAddress2 !== undefined) data.shippingAddress2 = dto.shippingAddress2;
    if (dto.shippingCity !== undefined) data.shippingCity = dto.shippingCity;
    if (dto.shippingProvince !== undefined) data.shippingProvince = dto.shippingProvince;
    if (dto.shippingPostalCode !== undefined) data.shippingPostalCode = dto.shippingPostalCode;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update.');
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data,
      select: { id: true, status: true },
    });

    return updated;
  }

  /**
   * Stub: trigger a full refund request. Sets status to REFUND_REQUESTED.
   * Actual refund processing (PayFast API call, Payment updates) deferred
   * to Payments module.
   */
  async requestRefund(
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.findOrderOrThrow(orderId);

    if (order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException('Order is already refunded.');
    }

    if (order.status === OrderStatus.REFUND_REQUESTED) {
      throw new BadRequestException('Refund already requested for this order.');
    }

    if (order.status === OrderStatus.PENDING) {
      throw new BadRequestException(
        'Cannot refund a PENDING order. Cancel it instead.',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.REFUND_REQUESTED,
      },
      select: { id: true, status: true },
    });

    return updated;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async findOrderOrThrow(
    orderId: string,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }
}
