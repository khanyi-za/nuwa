import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutService } from '../../order/checkout/checkout.service';
import { BuyerOrdersService } from '../../order/buyer-orders/buyer-orders.service';
import { BuyerCancelReason } from '../../order/dto/buyer-cancel-order.dto';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Paginated } from '../common/paginated';
import { vatIncludedPortion } from '../common/tax';
import { PlaceOrderDto } from './dto/place-order.dto';
import {
  mapMobileOrderStatus,
  mapPaymentStatusLabel,
} from './mobile-order-status';

const BUYER_CANCELLABLE: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
];

/** nuwa ShipmentStatus → maya courier currentStatus (coarser labels). */
function toCourierStatus(s: ShipmentStatus): string {
  switch (s) {
    case ShipmentStatus.COLLECTED:
    case ShipmentStatus.IN_TRANSIT:
      return 'in_transit';
    case ShipmentStatus.OUT_FOR_DELIVERY:
      return 'out_for_delivery';
    case ShipmentStatus.DELIVERED:
      return 'delivered';
    case ShipmentStatus.FAILED_DELIVERY:
    case ShipmentStatus.RETURNED:
      return 'exception';
    default:
      return 'pre_shipment';
  }
}

@Injectable()
export class MobileOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly buyerOrders: BuyerOrdersService,
  ) {}

  /**
   * GET /api/orders — the buyer's order history (Account → My Orders).
   * Lists consolidated maya orders (= PaymentGroups), newest first,
   * cursor-paginated on the PaymentGroup id so each row's `id` feeds the
   * existing detail/cancel/tracking endpoints. A group belongs to the buyer
   * when any of its child orders does (one buyer per checkout).
   */
  async listOrders(userId: string, opts: { limit: number; cursor?: string }) {
    const groups = await this.prisma.paymentGroup.findMany({
      where: { payments: { some: { order: { userId } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor
        ? { cursor: { id: decodeCursor(opts.cursor) }, skip: 1 }
        : {}),
      select: {
        id: true,
        status: true,
        amountGrossInCents: true,
        createdAt: true,
        payments: {
          select: {
            order: {
              select: {
                orderNumber: true,
                status: true,
                placedAt: true,
                store: { select: { displayName: true } },
                items: {
                  orderBy: { createdAt: 'asc' },
                  select: { quantity: true, productImageUrl: true },
                },
              },
            },
          },
        },
      },
    });

    const hasMore = groups.length > opts.limit;
    const page = hasMore ? groups.slice(0, opts.limit) : groups;
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1].id) : null;

    const orders = page.map((g) => {
      const childOrders = g.payments.map((p) => p.order);
      const rep = childOrders[0];
      const allItems = childOrders.flatMap((o) => o.items);
      const itemCount = allItems.reduce((n, it) => n + it.quantity, 0);
      const storeNames = [...new Set(childOrders.map((o) => o.store.displayName))];
      return {
        id: g.id,
        orderNumber: rep?.orderNumber ?? '',
        status: mapMobileOrderStatus(
          g.status,
          childOrders.map((o) => o.status),
        ),
        itemCount,
        total: g.amountGrossInCents,
        currency: 'ZAR',
        placedAt: rep?.placedAt ?? g.createdAt,
        storeName: storeNames[0] ?? '',
        storeCount: storeNames.length,
        image: allItems.find((it) => it.productImageUrl)?.productImageUrl ?? null,
      };
    });

    return new Paginated(
      { orders },
      { limit: opts.limit, nextCursor, hasMore },
    );
  }

  /**
   * POST /api/orders — auth-required delivery checkout. Reuses the web
   * CheckoutService.commit (TX1 → PayFast → TX2/rollback). The maya "order" is
   * the PaymentGroup (one PayFast transaction across N per-store orders). The
   * mobile WebView auto-submits `payment.fields` to `payment.actionUrl`.
   */
  async placeOrder(userId: string, dto: PlaceOrderDto) {
    let result: Awaited<ReturnType<CheckoutService['commit']>>;
    try {
      // paymentMethod (card | eft | qr) restricts the Paystack hosted page to
      // the method chosen on maya's Payment step; anything else → all channels.
      const channel = ['card', 'eft', 'qr'].includes(dto.paymentMethod ?? '')
        ? dto.paymentMethod!
        : undefined;
      result = await this.checkout.commit(userId, {
        addressId: dto.addressId,
        returnUrl: dto.returnUrl,
        cancelUrl: dto.cancelUrl,
        ...(channel ? { paymentChannels: [channel] } : {}),
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        throw new ConflictException({
          code: 'STOCK_DRIFT',
          message: 'An item in your cart is no longer available. Please review your cart.',
        });
      }
      if (err instanceof BadRequestException && /empty/i.test(err.message)) {
        throw new ConflictException({
          code: 'CART_EMPTY',
          message: 'Your cart is empty.',
        });
      }
      throw err;
    }

    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: result.paymentGroupId },
      select: { amountGrossInCents: true },
    });

    return {
      order: {
        id: result.paymentGroupId,
        status: 'PENDING_PAYMENT',
        total: group?.amountGrossInCents ?? 0,
        currency: 'ZAR',
      },
      payment: {
        type: 'redirect',
        // Provider-neutral shape (maya's payment WebView: GET → load url;
        // a POST provider would render fields as a form and submit).
        redirect: result.payment.redirect,
        returnUrl: dto.returnUrl,
      },
    };
  }

  /**
   * POST /api/orders/:id/cancel — buyer cancels the whole order (PaymentGroup).
   * Cancels every cancellable child order (PENDING/CONFIRMED) via the shared
   * BuyerOrdersService (which also best-effort-cancels any ShipLogic shipment).
   * v1 does NOT auto-refund — paid-order refunds remain an admin/manual flow.
   */
  async cancelOrder(userId: string, orderId: string) {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        payments: {
          select: { order: { select: { id: true, userId: true, status: true } } },
        },
      },
    });

    const orders = group?.payments.map((p) => p.order) ?? [];
    if (!group || orders.length === 0 || orders[0].userId !== userId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const cancellable = orders.filter((o) =>
      BUYER_CANCELLABLE.includes(o.status),
    );
    if (cancellable.length === 0) {
      throw new ConflictException({
        code: 'ORDER_NOT_CANCELLABLE',
        message: 'This order can no longer be cancelled. Contact support.',
      });
    }

    for (const o of cancellable) {
      await this.buyerOrders.cancelOrder(userId, o.id, {
        reason: BuyerCancelReason.CHANGED_MIND,
      });
    }

    const refreshed = await this.getOrder(userId, orderId);
    return {
      order: {
        id: refreshed.order.id,
        status: refreshed.order.status,
        cancelledAt: new Date(),
        // No auto-refund on buyer cancel in v1 (admin/manual). null when nothing
        // was charged (PENDING order); paid-order refunds are out of scope here.
        refund: null,
      },
    };
  }

  /**
   * GET /api/orders/:id — aggregated order detail. `id` is the PaymentGroup id;
   * the response consolidates its child per-store orders into one maya order.
   */
  async getOrder(userId: string, orderId: string) {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        amountGrossInCents: true,
        createdAt: true,
        payments: {
          select: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                userId: true,
                status: true,
                subtotalInCents: true,
                shippingInCents: true,
                discountInCents: true,
                placedAt: true,
                confirmedAt: true,
                dispatchedAt: true,
                deliveredAt: true,
                cancelledAt: true,
                shippingName: true,
                shippingPhone: true,
                shippingAddress1: true,
                shippingAddress2: true,
                shippingCity: true,
                shippingProvince: true,
                shippingPostalCode: true,
                store: { select: { id: true, slug: true, displayName: true } },
                shipment: { select: { estimatedDelivery: true } },
                items: {
                  select: {
                    id: true,
                    productId: true,
                    variantId: true,
                    quantity: true,
                    unitPriceInCents: true,
                    totalInCents: true,
                    productTitle: true,
                    variantName: true,
                    productImageUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const orders = group?.payments.map((p) => p.order) ?? [];
    // 404-not-403 on both missing and cross-user (enumeration-safe).
    if (!group || orders.length === 0 || orders[0].userId !== userId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const rep = orders[0];
    const total = group.amountGrossInCents;

    const items = orders.flatMap((o) =>
      o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        variantId: it.variantId,
        name: it.productTitle,
        image: it.productImageUrl ?? null,
        size: it.variantName ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPriceInCents,
        lineTotal: it.totalInCents,
        merchant: {
          id: o.store.id,
          username: o.store.slug,
          displayName: o.store.displayName,
        },
      })),
    );

    const statusHistory: { status: string; at: Date }[] = [];
    if (rep.placedAt)
      statusHistory.push({ status: 'PENDING_PAYMENT', at: rep.placedAt });
    if (rep.confirmedAt)
      statusHistory.push({ status: 'CONFIRMED', at: rep.confirmedAt });
    if (rep.dispatchedAt)
      statusHistory.push({ status: 'SHIPPED', at: rep.dispatchedAt });
    if (rep.deliveredAt)
      statusHistory.push({ status: 'DELIVERED', at: rep.deliveredAt });
    if (rep.cancelledAt)
      statusHistory.push({ status: 'CANCELLED', at: rep.cancelledAt });

    const estimatedDelivery =
      orders
        .map((o) => o.shipment?.estimatedDelivery)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const status = mapMobileOrderStatus(
      group.status,
      orders.map((o) => o.status),
    );

    // Gates maya's Cancel button (O-3: CONFIRMED + ~24h). nuwa's buyer-cancel
    // has no hard deadline — it accepts PENDING/CONFIRMED regardless — so the
    // backend stays MORE permissive than this UI hint; never less.
    const cancellationEligibleUntil =
      status === 'CONFIRMED' && rep.confirmedAt
        ? new Date(rep.confirmedAt.getTime() + 24 * 60 * 60 * 1000)
        : null;

    return {
      order: {
        id: group.id,
        orderNumber: rep.orderNumber,
        status,
        cancellationEligibleUntil,
        statusHistory,
        items,
        subtotal: orders.reduce((s, o) => s + o.subtotalInCents, 0),
        shippingFee: orders.reduce((s, o) => s + o.shippingInCents, 0),
        tax: vatIncludedPortion(total),
        discount: orders.reduce((s, o) => s + o.discountInCents, 0),
        total,
        currency: 'ZAR',
        shipping: {
          method: 'delivery',
          address: {
            recipientName: rep.shippingName,
            phone: rep.shippingPhone,
            line1: rep.shippingAddress1,
            line2: rep.shippingAddress2 ?? null,
            city: rep.shippingCity,
            province: rep.shippingProvince,
            postalCode: rep.shippingPostalCode,
            country: 'ZA',
          },
          rate: {
            name: 'Standard delivery',
            courier: 'The Courier Guy',
            minDays: null,
            maxDays: null,
          },
          estimatedDelivery,
        },
        payment: {
          method: 'card',
          last4: null,
          status: mapPaymentStatusLabel(group.status),
        },
        createdAt: group.createdAt,
      },
    };
  }

  /**
   * GET /api/orders/:id/preview — lightweight order summary for the chat
   * order-context banner (Screen 12). `id` = paymentGroupId.
   */
  async getOrderPreview(userId: string, orderId: string) {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: orderId },
      select: {
        amountGrossInCents: true,
        payments: {
          select: {
            order: {
              select: {
                userId: true,
                orderNumber: true,
                items: {
                  take: 1,
                  select: {
                    productTitle: true,
                    productImageUrl: true,
                    unitPriceInCents: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const orders = group?.payments.map((p) => p.order) ?? [];
    if (!group || orders.length === 0 || orders[0].userId !== userId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const rep = orders[0];
    const firstItem =
      rep.items[0] ?? orders.flatMap((o) => o.items)[0] ?? null;

    return {
      preview: {
        orderNumber: rep.orderNumber,
        total: group.amountGrossInCents,
        currency: 'ZAR',
        firstItem: firstItem
          ? {
              name: firstItem.productTitle,
              image: firstItem.productImageUrl ?? null,
              price: firstItem.unitPriceInCents,
            }
          : null,
      },
    };
  }

  /**
   * GET /api/orders/:id/tracking — courier tracking from LOCAL data only.
   * Reads the Shipment + ShipmentTrackingEvent rows the ShipLogic webhook
   * already populates (Shipping Phase 6) — no live ShipLogic call, so this
   * respects the Shipping-module hold. Consolidates across the order's child
   * shipments. 404 TRACKING_NOT_AVAILABLE before any shipment exists.
   */
  async getTracking(userId: string, orderId: string) {
    const group = await this.prisma.paymentGroup.findUnique({
      where: { id: orderId },
      select: {
        payments: {
          select: {
            order: {
              select: {
                userId: true,
                shipment: {
                  select: {
                    waybillNumber: true,
                    trackingUrl: true,
                    status: true,
                    estimatedDelivery: true,
                    updatedAt: true,
                    trackingEvents: {
                      orderBy: { timestamp: 'desc' },
                      select: {
                        status: true,
                        description: true,
                        location: true,
                        timestamp: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const orders = group?.payments.map((p) => p.order) ?? [];
    if (!group || orders.length === 0 || orders[0].userId !== userId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const shipments = orders
      .map((o) => o.shipment)
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (shipments.length === 0) {
      throw new NotFoundException({
        code: 'TRACKING_NOT_AVAILABLE',
        message: 'No tracking yet — the courier has not collected this order.',
      });
    }

    // Representative shipment = most recently updated (single-merchant: the only one).
    const rep = [...shipments].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];

    const events = shipments
      .flatMap((s) => s.trackingEvents)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .map((e) => ({
        at: e.timestamp,
        location: e.location,
        description: e.description,
      }));

    return {
      tracking: {
        trackingNumber: rep.waybillNumber,
        courier: 'The Courier Guy',
        courierTrackingUrl: rep.trackingUrl,
        currentStatus: toCourierStatus(rep.status),
        lastEvent: events[0] ?? null,
        estimatedDeliveryFrom: rep.estimatedDelivery,
        estimatedDeliveryTo: rep.estimatedDelivery,
        events,
      },
    };
  }
}
