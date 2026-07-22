import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaystackWebhookService } from './paystack-webhook.service';
import { PaystackConfig } from './paystack/paystack-config';
import { ShipmentCreationService } from '../shipping/shipment-creation.service';
import { ShopifyStockDecrementService } from '../shopify/shopify-stock-decrement.service';
import { NotificationsService } from '../notifications/notifications.service';

const SECRET = 'sk_test_webhook_secret';

const mockPrisma = {
  paymentGroup: { findUnique: jest.fn(), updateMany: jest.fn() },
  payment: { updateMany: jest.fn() },
  order: { updateMany: jest.fn() },
  paymentEvent: { create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};
const mockShipments = { createShipmentForOrder: jest.fn() };
const mockShopifyDecrement = { decrementForOrder: jest.fn() };
const mockNotifications = {
  orderConfirmed: jest.fn(),
  paymentFailed: jest.fn(),
};

/** Sign a JSON event exactly the way Paystack does (HMAC-SHA512, raw bytes). */
function signedBody(event: unknown): { raw: Buffer; sig: string } {
  const raw = Buffer.from(JSON.stringify(event), 'utf8');
  const sig = createHmac('sha512', SECRET).update(raw).digest('hex');
  return { raw, sig };
}

const chargeSuccess = {
  event: 'charge.success',
  data: {
    id: 424242,
    reference: 'm-uuid-1',
    amount: 279500,
    fees: 9105,
    customer: { email: 'buyer@yiiva.co.za' },
  },
};

const baseGroup = {
  id: 'pg1',
  mPaymentId: 'm-uuid-1',
  status: 'PENDING',
  amountGrossInCents: 279500,
  pfPaymentId: null,
  payments: [
    {
      id: 'pay1',
      orderId: 'o1',
      amountGrossInCents: 279500,
      refundedAmountInCents: 0,
      order: { id: 'o1', status: 'PENDING' },
    },
  ],
};

describe('PaystackWebhookService', () => {
  let service: PaystackWebhookService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaystackWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaystackConfig, useValue: { secretKey: SECRET } },
        { provide: ShipmentCreationService, useValue: mockShipments },
        {
          provide: ShopifyStockDecrementService,
          useValue: mockShopifyDecrement,
        },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(PaystackWebhookService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.order.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt1' });
    mockPrisma.paymentEvent.update.mockResolvedValue({});
    mockShipments.createShipmentForOrder.mockResolvedValue(undefined);
    mockShopifyDecrement.decrementForOrder.mockResolvedValue(undefined);
    mockNotifications.orderConfirmed.mockResolvedValue(undefined);
  });

  describe('signature verification', () => {
    it('rejects a missing signature with 400', async () => {
      const { raw } = signedBody(chargeSuccess);
      await expect(service.handle(raw, undefined, '1.2.3.4')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a tampered body with 400', async () => {
      const { sig } = signedBody(chargeSuccess);
      const tampered = Buffer.from(
        JSON.stringify({ ...chargeSuccess, data: { ...chargeSuccess.data, amount: 1 } }),
      );
      await expect(service.handle(tampered, sig, '1.2.3.4')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('rejects an empty body with 400', async () => {
      await expect(
        service.handle(Buffer.alloc(0), 'sig', '1.2.3.4'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('charge.success', () => {
    it('transitions PENDING → COMPLETED with children, fees, and side effects', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(baseGroup);
      const { raw, sig } = signedBody(chargeSuccess);

      await service.handle(raw, sig, '1.2.3.4');

      // PaymentEvent audit row.
      const created = mockPrisma.paymentEvent.create.mock.calls[0][0].data;
      expect(created.paymentGroupId).toBe('pg1');
      expect(created.pfPaymentId).toBe('424242');
      expect(created.transactionType).toBe('PAYMENT');

      // CAS group update with provider id + integer fee/net math.
      const groupUpdate = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(groupUpdate.where).toEqual({ id: 'pg1', status: 'PENDING' });
      expect(groupUpdate.data.status).toBe('COMPLETED');
      expect(groupUpdate.data.pfPaymentId).toBe('424242');
      expect(groupUpdate.data.amountFeeInCents).toBe(9105);
      expect(groupUpdate.data.amountNetInCents).toBe(279500 - 9105);

      // Orders → CONFIRMED with confirmedAt (the regression the ITN had).
      const orderUpdate = mockPrisma.order.updateMany.mock.calls[0][0];
      expect(orderUpdate.where).toEqual({ id: { in: ['o1'] }, status: 'PENDING' });
      expect(orderUpdate.data.status).toBe('CONFIRMED');
      expect(orderUpdate.data.confirmedAt).toBeInstanceOf(Date);

      // Event marked processed; side effects fired outside the TX.
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: { processed: true },
      });
      expect(mockShipments.createShipmentForOrder).toHaveBeenCalledWith('o1');
      expect(mockNotifications.orderConfirmed).toHaveBeenCalledWith('pg1');
    });

    it('rejects an amount mismatch with 400 and no event row', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...baseGroup,
        amountGrossInCents: 999999,
      });
      const { raw, sig } = signedBody(chargeSuccess);

      await expect(service.handle(raw, sig, '1.2.3.4')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('acks an unknown reference (200) without inserting', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
      const { raw, sig } = signedBody(chargeSuccess);

      await expect(service.handle(raw, sig, '1.2.3.4')).resolves.toBeUndefined();
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('acks a replay (duplicate hash) without transitioning', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(baseGroup);
      mockPrisma.paymentEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      const { raw, sig } = signedBody(chargeSuccess);

      await expect(service.handle(raw, sig, '1.2.3.4')).resolves.toBeUndefined();
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
      expect(mockNotifications.orderConfirmed).not.toHaveBeenCalled();
    });

    it('marks INVALID_TRANSITION when the group is already terminal', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...baseGroup,
        status: 'FAILED',
      });
      const { raw, sig } = signedBody(chargeSuccess);

      await service.handle(raw, sig, '1.2.3.4');

      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: {
          processed: false,
          processError: 'INVALID_TRANSITION:FAILED→COMPLETED',
        },
      });
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
    });

    it('CANCELLED-stays-CANCELLED: cancelled child order → RECONCILE_REQUIRED', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...baseGroup,
        payments: [
          {
            ...baseGroup.payments[0],
            order: { id: 'o1', status: 'CANCELLED' },
          },
        ],
      });
      const { raw, sig } = signedBody(chargeSuccess);

      await service.handle(raw, sig, '1.2.3.4');

      const groupUpdate = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(groupUpdate.data.status).toBe('RECONCILE_REQUIRED');
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: { processed: false, processError: 'ORDER_ALREADY_CANCELLED' },
      });
      expect(mockNotifications.orderConfirmed).not.toHaveBeenCalled();
    });

    it('a lost CAS race marks the event and skips side effects', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(baseGroup);
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 0 });
      const { raw, sig } = signedBody(chargeSuccess);

      await service.handle(raw, sig, '1.2.3.4');

      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: { processed: false, processError: 'CAS_LOST_RACE' },
      });
      expect(mockShipments.createShipmentForOrder).not.toHaveBeenCalled();
      expect(mockNotifications.orderConfirmed).not.toHaveBeenCalled();
    });
  });

  describe('refund.* (confirmation-only)', () => {
    const completedGroup = {
      ...baseGroup,
      status: 'COMPLETED',
      pfPaymentId: '424242',
      payments: [
        {
          ...baseGroup.payments[0],
          refundedAmountInCents: 279500, // fully refunded synchronously
          order: { id: 'o1', status: 'REFUNDED' },
        },
      ],
    };

    it('refund.processed CASes the group to REFUNDED (full aggregate)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(completedGroup);
      const { raw, sig } = signedBody({
        event: 'refund.processed',
        data: { transaction_reference: 'm-uuid-1', amount: 279500 },
      });

      await service.handle(raw, sig, '1.2.3.4');

      const groupUpdate = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(groupUpdate.where).toEqual({ id: 'pg1', status: 'COMPLETED' });
      expect(groupUpdate.data.status).toBe('REFUNDED');
      // Orders/Payments untouched — accumulated synchronously at refund time.
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('partial aggregate → PARTIALLY_REFUNDED', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue({
        ...completedGroup,
        payments: [
          { ...completedGroup.payments[0], refundedAmountInCents: 50000 },
        ],
      });
      const { raw, sig } = signedBody({
        event: 'refund.processed',
        data: { transaction_reference: 'm-uuid-1', amount: 50000 },
      });

      await service.handle(raw, sig, '1.2.3.4');

      expect(
        mockPrisma.paymentGroup.updateMany.mock.calls[0][0].data.status,
      ).toBe('PARTIALLY_REFUNDED');
    });

    it('refund.pending records an audit row without transitioning', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(completedGroup);
      const { raw, sig } = signedBody({
        event: 'refund.pending',
        data: { transaction_reference: 'm-uuid-1' },
      });

      await service.handle(raw, sig, '1.2.3.4');

      expect(mockPrisma.paymentEvent.create).toHaveBeenCalled();
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: { processed: true },
      });
    });

    it('refund.failed marks the money-mismatch for manual ops', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(completedGroup);
      const { raw, sig } = signedBody({
        event: 'refund.failed',
        data: { transaction_reference: 'm-uuid-1' },
      });

      await service.handle(raw, sig, '1.2.3.4');

      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt1' },
        data: { processed: false, processError: 'REFUND_FAILED_AT_PROVIDER' },
      });
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
    });
  });

  it('acks unknown event types without touching the DB', async () => {
    const { raw, sig } = signedBody({
      event: 'subscription.create',
      data: {},
    });

    await expect(service.handle(raw, sig, '1.2.3.4')).resolves.toBeUndefined();
    expect(mockPrisma.paymentGroup.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
  });
});
