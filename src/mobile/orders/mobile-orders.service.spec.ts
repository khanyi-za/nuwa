import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutService } from '../../order/checkout/checkout.service';
import { BuyerOrdersService } from '../../order/buyer-orders/buyer-orders.service';
import { MobileOrdersService } from './mobile-orders.service';
import { mapMobileOrderStatus } from './mobile-order-status';

const commitResult = {
  orderNumbers: ['YV-2026-000142'],
  paymentGroupId: 'pg1',
  mPaymentId: 'm1',
  payfast: { actionUrl: 'https://sandbox.payfast.co.za/eng/process', fields: { merchant_id: '1' } },
};

const groupRow = {
  id: 'pg1',
  status: PaymentStatus.COMPLETED,
  amountGrossInCents: 226400,
  createdAt: new Date('2026-06-05T14:23:00.000Z'),
  payments: [
    {
      order: {
        id: 'o1',
        orderNumber: 'YV-2026-000142',
        userId: 'u1',
        status: OrderStatus.CONFIRMED,
        subtotalInCents: 219900,
        shippingInCents: 6500,
        discountInCents: 0,
        placedAt: new Date('2026-06-05T14:23:00.000Z'),
        confirmedAt: new Date('2026-06-05T14:23:14.000Z'),
        dispatchedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        shippingName: 'Jane Doe',
        shippingPhone: '+27821234567',
        shippingAddress1: '123 Long Street',
        shippingAddress2: null,
        shippingCity: 'Cape Town',
        shippingProvince: 'Western Cape',
        shippingPostalCode: '8001',
        store: { id: 's1', slug: 'tol_thema', displayName: "Tol'thema" },
        shipment: null,
        items: [
          {
            id: 'oi1',
            productId: 'p1',
            variantId: 'v1',
            quantity: 1,
            unitPriceInCents: 89900,
            totalInCents: 89900,
            productTitle: 'Mosadi Kimono',
            variantName: 'M',
            productImageUrl: 'https://cdn.yiiva.co.za/1.jpg',
          },
        ],
      },
    },
  ],
};

const mockPrisma = { paymentGroup: { findUnique: jest.fn() } };
const mockCheckout = { commit: jest.fn() };
const mockBuyerOrders = { cancelOrder: jest.fn() };

describe('MobileOrdersService', () => {
  let service: MobileOrdersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileOrdersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CheckoutService, useValue: mockCheckout },
        { provide: BuyerOrdersService, useValue: mockBuyerOrders },
      ],
    }).compile();
    service = module.get(MobileOrdersService);
    jest.clearAllMocks();
  });

  describe('placeOrder', () => {
    it('commits via CheckoutService and returns the PayFast redirect payload', async () => {
      mockCheckout.commit.mockResolvedValue(commitResult);
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        amountGrossInCents: 226400,
      });

      const result = await service.placeOrder('u1', {
        addressId: 'a1',
        returnUrl: 'yiivaapp://payment-return',
        cancelUrl: 'yiivaapp://payment-cancel',
      });

      expect(mockCheckout.commit).toHaveBeenCalledWith('u1', {
        addressId: 'a1',
        returnUrl: 'yiivaapp://payment-return',
        cancelUrl: 'yiivaapp://payment-cancel',
      });
      expect(result.order).toEqual({
        id: 'pg1',
        status: 'PENDING_PAYMENT',
        total: 226400,
        currency: 'ZAR',
      });
      expect(result.payment).toMatchObject({
        type: 'redirect',
        actionUrl: commitResult.payfast.actionUrl,
        fields: commitResult.payfast.fields,
        returnUrl: 'yiivaapp://payment-return',
      });
    });

    it('maps a stock conflict to STOCK_DRIFT', async () => {
      mockCheckout.commit.mockRejectedValue(new ConflictException('unavailable'));
      await expect(
        service.placeOrder('u1', {
          addressId: 'a1',
          returnUrl: 'r',
          cancelUrl: 'c',
        }),
      ).rejects.toMatchObject({ response: { code: 'STOCK_DRIFT' } });
    });

    it('maps an empty cart to CART_EMPTY', async () => {
      mockCheckout.commit.mockRejectedValue(
        new BadRequestException('Cart is empty'),
      );
      await expect(
        service.placeOrder('u1', {
          addressId: 'a1',
          returnUrl: 'r',
          cancelUrl: 'c',
        }),
      ).rejects.toMatchObject({ response: { code: 'CART_EMPTY' } });
    });
  });

  describe('getOrder', () => {
    it('aggregates the PaymentGroup + child orders into one maya order', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(groupRow);

      const { order } = await service.getOrder('u1', 'pg1');

      expect(order).toMatchObject({
        id: 'pg1',
        orderNumber: 'YV-2026-000142',
        status: 'CONFIRMED',
        subtotal: 219900,
        shippingFee: 6500,
        tax: 29530,
        discount: 0,
        total: 226400,
        currency: 'ZAR',
      });
      expect(order.items[0]).toMatchObject({
        name: 'Mosadi Kimono',
        size: 'M',
        unitPrice: 89900,
        lineTotal: 89900,
        merchant: { username: 'tol_thema' },
      });
      expect(order.statusHistory).toHaveLength(2); // placed + confirmed
      expect(order.payment.status).toBe('succeeded');
      expect(order.shipping.address.line1).toBe('123 Long Street');
      // CONFIRMED → cancellationEligibleUntil = confirmedAt + 24h
      expect(order.cancellationEligibleUntil?.toISOString()).toBe(
        '2026-06-06T14:23:14.000Z',
      );
    });

    it('throws 404 for an unknown order', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
      await expect(service.getOrder('u1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when the order belongs to another user', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...groupRow,
        payments: [
          { order: { ...groupRow.payments[0].order, userId: 'someone-else' } },
        ],
      });
      await expect(service.getOrder('u1', 'pg1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelOrder', () => {
    it('cancels every cancellable child order and reports CANCELLED', async () => {
      mockPrisma.paymentGroup.findUnique
        .mockResolvedValueOnce({
          id: 'pg1',
          payments: [
            { order: { id: 'o1', userId: 'u1', status: OrderStatus.PENDING } },
          ],
        })
        .mockResolvedValueOnce({
          ...groupRow,
          status: PaymentStatus.PENDING,
          payments: [
            {
              order: { ...groupRow.payments[0].order, status: OrderStatus.CANCELLED },
            },
          ],
        });
      mockBuyerOrders.cancelOrder.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });

      const { order } = await service.cancelOrder('u1', 'pg1');

      expect(mockBuyerOrders.cancelOrder).toHaveBeenCalledTimes(1);
      expect(mockBuyerOrders.cancelOrder).toHaveBeenCalledWith(
        'u1',
        'o1',
        expect.objectContaining({ reason: expect.any(String) }),
      );
      expect(order.status).toBe('CANCELLED');
      expect(order.refund).toBeNull();
    });

    it('throws 409 ORDER_NOT_CANCELLABLE when nothing is cancellable', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        id: 'pg1',
        payments: [
          { order: { id: 'o1', userId: 'u1', status: OrderStatus.DELIVERED } },
        ],
      });

      await expect(service.cancelOrder('u1', 'pg1')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_CANCELLABLE' },
      });
      expect(mockBuyerOrders.cancelOrder).not.toHaveBeenCalled();
    });

    it('throws 404 for an unknown order', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
      await expect(service.cancelOrder('u1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOrderPreview', () => {
    it('returns a lightweight summary for the chat context banner', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(groupRow);

      const { preview } = await service.getOrderPreview('u1', 'pg1');

      expect(preview).toEqual({
        orderNumber: 'YV-2026-000142',
        total: 226400,
        currency: 'ZAR',
        firstItem: {
          name: 'Mosadi Kimono',
          image: 'https://cdn.yiiva.co.za/1.jpg',
          price: 89900,
        },
      });
    });

    it('404s another user', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...groupRow,
        payments: [
          { order: { ...groupRow.payments[0].order, userId: 'other' } },
        ],
      });
      await expect(service.getOrderPreview('u1', 'pg1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getTracking', () => {
    const trackingGroup = {
      payments: [
        {
          order: {
            userId: 'u1',
            shipment: {
              waybillNumber: 'VD3GLQ',
              trackingUrl: 'https://tracking.shiplogic.com/VD3GLQ',
              status: ShipmentStatus.IN_TRANSIT,
              estimatedDelivery: new Date('2026-06-12'),
              updatedAt: new Date('2026-06-06T11:30:00.000Z'),
              trackingEvents: [
                {
                  status: 'in-transit',
                  description: 'Scanned at sorting facility',
                  location: 'Cape Town hub',
                  timestamp: new Date('2026-06-06T11:00:00.000Z'),
                },
                {
                  status: 'collected',
                  description: 'Collected by courier',
                  location: 'Studio',
                  timestamp: new Date('2026-06-06T08:30:00.000Z'),
                },
              ],
            },
          },
        },
      ],
    };

    it('serves local shipment tracking, newest event first', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(trackingGroup);

      const { tracking } = await service.getTracking('u1', 'pg1');

      expect(tracking).toMatchObject({
        trackingNumber: 'VD3GLQ',
        courier: 'The Courier Guy',
        currentStatus: 'in_transit',
      });
      expect(tracking.events).toHaveLength(2);
      expect(tracking.lastEvent.location).toBe('Cape Town hub');
    });

    it('throws 404 TRACKING_NOT_AVAILABLE before any shipment exists', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        payments: [{ order: { userId: 'u1', shipment: null } }],
      });
      await expect(service.getTracking('u1', 'pg1')).rejects.toMatchObject({
        response: { code: 'TRACKING_NOT_AVAILABLE' },
      });
    });

    it('throws 404 for another user', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        payments: [{ order: { userId: 'other', shipment: null } }],
      });
      await expect(service.getTracking('u1', 'pg1')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_FOUND' },
      });
    });
  });

  describe('mapMobileOrderStatus', () => {
    it('PENDING payment → PENDING_PAYMENT', () => {
      expect(mapMobileOrderStatus(PaymentStatus.PENDING, [])).toBe(
        'PENDING_PAYMENT',
      );
    });

    it('SHIPPED when ANY child ships, DELIVERED only when ALL deliver', () => {
      expect(
        mapMobileOrderStatus(PaymentStatus.COMPLETED, [
          OrderStatus.DISPATCHED,
          OrderStatus.CONFIRMED,
        ]),
      ).toBe('SHIPPED');
      expect(
        mapMobileOrderStatus(PaymentStatus.COMPLETED, [
          OrderStatus.DELIVERED,
          OrderStatus.DELIVERED,
        ]),
      ).toBe('DELIVERED');
      expect(
        mapMobileOrderStatus(PaymentStatus.COMPLETED, [
          OrderStatus.DELIVERED,
          OrderStatus.IN_TRANSIT,
        ]),
      ).toBe('SHIPPED');
    });
  });
});
