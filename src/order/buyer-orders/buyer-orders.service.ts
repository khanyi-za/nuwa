import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BuyerOrderQueryDto } from '../dto/buyer-order-query.dto';
import { BuyerCancelOrderDto, BuyerCancelReason } from '../dto/buyer-cancel-order.dto';
import { ShipmentCancellationService } from '../../shipping/shipment-cancellation.service';
import { NotificationsService } from '../../notifications/notifications.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** States from which a buyer can cancel. */
const BUYER_CANCELLABLE_STATES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
];

// ─── Response shapes ───────────────────────────────────────────────────────

export interface BuyerOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  storeName: string;
  subtotalInCents: number;
  totalInCents: number;
  itemCount: number;
  placedAt: Date;
}

export interface BuyerOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  storeName: string;
  storeSlug: string;
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
  paymentStatus: string | null;
}

export interface PaginatedBuyerOrders {
  orders: BuyerOrderSummary[];
  nextCursor: string | null;
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class BuyerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipmentCancellation: ShipmentCancellationService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * List the authenticated buyer's orders with optional status filter,
   * order number search, and cursor-based pagination. Newest first.
   */
  async listOrders(
    userId: string,
    query: BuyerOrderQueryDto,
  ): Promise<PaginatedBuyerOrders> {
    const take = Math.min(
      parseInt(query.take ?? '', 10) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const where: any = { userId };

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.orderNumber = { contains: query.search, mode: 'insensitive' };
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
        placedAt: o.placedAt,
      })),
      nextCursor,
    };
  }

  /**
   * Full order detail for the buyer. No commission/payout info — those
   * are merchant-only fields.
   */
  async getOrderDetail(
    userId: string,
    orderId: string,
  ): Promise<BuyerOrderDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: {
          select: { displayName: true, slug: true },
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
          select: { status: true },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      storeName: order.store.displayName,
      storeSlug: order.store.slug,
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
      paymentStatus: order.payment?.status ?? null,
    };
  }

  /**
   * Buyer cancels their own order from PENDING or CONFIRMED.
   */
  async cancelOrder(
    userId: string,
    orderId: string,
    dto: BuyerCancelOrderDto,
  ): Promise<{ id: string; status: OrderStatus }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }

    if (!BUYER_CANCELLABLE_STATES.includes(order.status)) {
      throw new BadRequestException(
        `Cannot cancel an order in ${order.status} status. Please contact the merchant.`,
      );
    }

    const cancelReasonText =
      dto.reason === BuyerCancelReason.OTHER && dto.notes
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

    // Best-effort propagation to ShipLogic. Returns false when no shipment
    // exists yet (Order was still PENDING). Logged failures are NOT bubbled
    // — the local cancel is authoritative; ShipLogic-side errors become an
    // ops reconciliation surface, not a buyer-facing failure.
    await this.shipmentCancellation.cancelShipmentForOrder(orderId);

    // Best-effort buyer notification (inbox + email + push).
    await this.notifications.orderCancelled(orderId);

    return updated;
  }
}
