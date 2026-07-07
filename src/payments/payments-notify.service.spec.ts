import { Test } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsNotifyService } from './payments-notify.service';
import { PayfastConfig } from './payfast/payfast-config';
import { PayfastSignatureService } from './payfast/payfast-signature.service';
import { PayfastClient } from './payfast/payfast-client.service';
import { PayfastIpAllowlistService } from './payfast/payfast-ip-allowlist.service';
import { ShipmentCreationService } from '../shipping/shipment-creation.service';
import { NotificationsService } from '../notifications/notifications.service';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const M_PAYMENT_ID = 'm-uuid-123';
const PF_PAYMENT_ID = 'pf-uuid-456';
const PAYMENT_GROUP_ID = 'pg-1';
const ORDER_1 = 'ord-1';
const ORDER_2 = 'ord-2';
const SOURCE_IP = '197.97.144.10';

function buildItnBody(
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  return {
    m_payment_id: M_PAYMENT_ID,
    pf_payment_id: PF_PAYMENT_ID,
    payment_status: 'COMPLETE',
    item_name: 'YIIVA Order ord_1',
    amount_gross: '550.00',
    amount_fee: '-12.65',
    amount_net: '537.35',
    name_first: 'Jane',
    name_last: 'Doe',
    email_address: 'buyer@example.com',
    merchant_id: '10000100',
    signature: 'a'.repeat(32),
    ...overrides,
  };
}

function buildPaymentGroup(
  overrides: Partial<{
    status: string;
    orderStatuses: string[];
    paymentRefundAmounts: number[];
    paymentGrossAmounts: number[];
  }> = {},
) {
  const status = overrides.status ?? 'PENDING';
  const orderStatuses = overrides.orderStatuses ?? ['PENDING', 'PENDING'];
  const paymentRefundAmounts =
    overrides.paymentRefundAmounts ?? orderStatuses.map(() => 0);
  // Default child Payment gross amounts split 55000 evenly across orders so
  // the aggregate matches the test ITN body (amount_gross=550.00).
  const defaultPerPayment = Math.floor(55000 / orderStatuses.length);
  const paymentGrossAmounts =
    overrides.paymentGrossAmounts ??
    orderStatuses.map(() => defaultPerPayment);
  const totalGross = paymentGrossAmounts.reduce((s, v) => s + v, 0);
  return {
    id: PAYMENT_GROUP_ID,
    mPaymentId: M_PAYMENT_ID,
    status,
    amountGrossInCents: totalGross,
    amountFeeInCents: 0,
    amountNetInCents: totalGross,
    payments: orderStatuses.map((s, i) => ({
      id: `pay-${i}`,
      orderId: i === 0 ? ORDER_1 : ORDER_2,
      status: 'COMPLETED',
      amountGrossInCents: paymentGrossAmounts[i],
      refundedAmountInCents: paymentRefundAmounts[i],
      order: { id: i === 0 ? ORDER_1 : ORDER_2, status: s },
    })),
  };
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  paymentGroup: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  paymentEvent: {
    create: jest.fn(),
    update: jest.fn(),
  },
  payment: {
    updateMany: jest.fn(),
  },
  order: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

const mockSignature = {
  verifyItnSignature: jest.fn().mockReturnValue(true),
  buildPostbackBody: jest.fn().mockReturnValue('paramstring'),
};

const mockClient = {
  verifyItnPostback: jest.fn().mockResolvedValue(true),
};

const mockIpAllowlist = {
  isAllowed: jest.fn().mockReturnValue(true),
};

const mockConfig = { passphrase: 'jt7NOE43FZPn' };

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('PaymentsNotifyService', () => {
  let service: PaymentsNotifyService;

  const mockShipmentCreation = {
    createShipmentForOrder: jest.fn().mockResolvedValue({ id: 'shp-mock' }),
  };
  const mockNotifications = {
    orderConfirmed: jest.fn(),
    paymentFailed: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaymentsNotifyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PayfastConfig, useValue: mockConfig },
        { provide: PayfastSignatureService, useValue: mockSignature },
        { provide: PayfastClient, useValue: mockClient },
        { provide: PayfastIpAllowlistService, useValue: mockIpAllowlist },
        {
          provide: ShipmentCreationService,
          useValue: mockShipmentCreation,
        },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(PaymentsNotifyService);

    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    mockSignature.verifyItnSignature.mockReturnValue(true);
    mockSignature.buildPostbackBody.mockReturnValue('paramstring');
    mockClient.verifyItnPostback.mockResolvedValue(true);
    mockIpAllowlist.isAllowed.mockReturnValue(true);

    // Silence expected error/warn logs (some tests assert critical behavior)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  // ── Validation rejections (HTTP 400) ──────────────────────────────────────

  describe('rejects with 400 (PayFast retries)', () => {
    it('on bad signature', async () => {
      mockSignature.verifyItnSignature.mockReturnValue(false);
      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('on source IP not in allowlist', async () => {
      mockIpAllowlist.isAllowed.mockReturnValue(false);
      await expect(
        service.handle(buildItnBody(), '8.8.8.8'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('on missing m_payment_id (signature passed but no group key)', async () => {
      const body = buildItnBody();
      delete body.m_payment_id;
      await expect(service.handle(body, SOURCE_IP)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('on amount mismatch', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      await expect(
        service.handle(buildItnBody({ amount_gross: '999.00' }), SOURCE_IP),
      ).rejects.toThrow(BadRequestException);
    });

    it('on postback returning non-VALID', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockClient.verifyItnPostback.mockResolvedValue(false);
      await expect(service.handle(buildItnBody(), SOURCE_IP)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('runs the four checks in order (signature → IP → group → amount → postback)', async () => {
      // Signature fails first; IP/postback should not be called
      mockSignature.verifyItnSignature.mockReturnValue(false);
      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).rejects.toThrow();
      expect(mockIpAllowlist.isAllowed).not.toHaveBeenCalled();
      expect(mockClient.verifyItnPostback).not.toHaveBeenCalled();
    });
  });

  // ── Soft rejections (HTTP 200, no PayFast retry) ──────────────────────────

  describe('returns 200 without applying state', () => {
    it('on unknown m_payment_id (signature was valid → genuine PayFast → data loss)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(null);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
      );
      expect(mockPrisma.paymentEvent.create).not.toHaveBeenCalled();
    });

    it('on replay (PaymentEvent unique itnHash collision)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['itnHash'] } },
      );
      mockPrisma.paymentEvent.create.mockRejectedValue(p2002);

      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).resolves.toBeUndefined();
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('on terminal-status PaymentGroup receiving another COMPLETED ITN (invalid transition)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({ status: 'COMPLETED' }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });

      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).resolves.toBeUndefined();

      // Event created but marked unprocessed; no apply transition
      expect(mockPrisma.paymentEvent.create).toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-1' },
          data: expect.objectContaining({
            processed: false,
            processError: expect.stringContaining('INVALID_TRANSITION'),
          }),
        }),
      );
      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── Happy paths — full PENDING → terminal transitions ─────────────────────

  describe('PENDING → COMPLETED', () => {
    beforeEach(() => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });
    });

    it('sets PaymentGroup status to COMPLETED with paidAt', async () => {
      await service.handle(buildItnBody(), SOURCE_IP);

      expect(mockPrisma.paymentGroup.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PAYMENT_GROUP_ID, status: 'PENDING' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            pfPaymentId: PF_PAYMENT_ID,
            paidAt: expect.any(Date),
          }),
        }),
      );
    });

    it('sets all child Payments to COMPLETED', async () => {
      await service.handle(buildItnBody(), SOURCE_IP);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { paymentGroupId: PAYMENT_GROUP_ID, status: 'PENDING' },
          data: expect.objectContaining({
            status: 'COMPLETED',
            paidAt: expect.any(Date),
          }),
        }),
      );
    });

    it('transitions all child Orders PENDING → CONFIRMED with confirmedAt', async () => {
      await service.handle(buildItnBody(), SOURCE_IP);
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [ORDER_1, ORDER_2] }, status: 'PENDING' },
          data: {
            status: 'CONFIRMED',
            confirmedAt: expect.any(Date),
          },
        }),
      );
    });

    it('captures fee and net amounts from ITN onto PaymentGroup', async () => {
      await service.handle(buildItnBody(), SOURCE_IP);
      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      // amount_fee=-12.65 → 1265 cents (absolute)
      expect(call.data.amountFeeInCents).toBe(1265);
      // amount_net=537.35 → 53735 cents
      expect(call.data.amountNetInCents).toBe(53735);
    });

    it('marks PaymentEvent as processed=true', async () => {
      await service.handle(buildItnBody(), SOURCE_IP);
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: { processed: true },
      });
    });

    it('persists itnPayload + signature on PaymentGroup for forensics', async () => {
      const body = buildItnBody();
      await service.handle(body, SOURCE_IP);
      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.itnPayload).toBe(body);
      expect(call.data.pfSignature).toBe(body.signature);
    });
  });

  describe('PENDING → FAILED', () => {
    beforeEach(() => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });
    });

    it('sets PaymentGroup status to FAILED with failedAt', async () => {
      await service.handle(
        buildItnBody({ payment_status: 'FAILED' }),
        SOURCE_IP,
      );
      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe('FAILED');
      expect(call.data.failedAt).toBeInstanceOf(Date);
      expect(call.data.paidAt).toBeUndefined();
    });

    it('cancels child Orders with SYSTEM:PAYMENT_FAILED reason', async () => {
      await service.handle(
        buildItnBody({ payment_status: 'FAILED' }),
        SOURCE_IP,
      );
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'CANCELLED',
            cancelReason: 'SYSTEM:PAYMENT_FAILED',
            cancelledAt: expect.any(Date),
          },
        }),
      );
    });
  });

  describe('PENDING → CANCELLED', () => {
    it('cancels child Orders with SYSTEM:PAYMENT_CANCELLED reason', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(
        buildItnBody({ payment_status: 'CANCELLED' }),
        SOURCE_IP,
      );

      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'CANCELLED',
            cancelReason: 'SYSTEM:PAYMENT_CANCELLED',
            cancelledAt: expect.any(Date),
          },
        }),
      );
    });
  });

  // ── The reconciliation gap — the most important integrity rule ────────────

  describe('CANCELLED-stays-CANCELLED rule', () => {
    it('sets PaymentGroup → RECONCILE_REQUIRED if any child Order is already CANCELLED', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({ orderStatuses: ['CANCELLED', 'PENDING'] }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      await service.handle(buildItnBody(), SOURCE_IP);

      expect(mockPrisma.paymentGroup.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RECONCILE_REQUIRED' }),
        }),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('RECONCILE_REQUIRED'),
      );
    });

    it('does NOT touch any Order rows (no resurrection)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({ orderStatuses: ['CANCELLED', 'PENDING'] }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(buildItnBody(), SOURCE_IP);

      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('marks PaymentEvent processed=false with ORDER_ALREADY_CANCELLED reason', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({ orderStatuses: ['CANCELLED'] }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(buildItnBody(), SOURCE_IP);

      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processed: false,
            processError: 'ORDER_ALREADY_CANCELLED',
          }),
        }),
      );
    });

    it('does NOT trigger when target status is FAILED (only COMPLETED)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({ orderStatuses: ['CANCELLED'] }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(
        buildItnBody({ payment_status: 'FAILED' }),
        SOURCE_IP,
      );

      // FAILED applies normal transition path, not RECONCILE
      const updateCall = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(updateCall.data.status).toBe('FAILED');
    });
  });

  // ── Concurrency — CAS race ────────────────────────────────────────────────

  describe('optimistic CAS concurrency', () => {
    it('marks event not processed when CAS guard returns count=0 (lost race)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 0 }); // lost!

      await expect(
        service.handle(buildItnBody(), SOURCE_IP),
      ).resolves.toBeUndefined();

      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processed: false,
            processError: 'CAS_LOST_RACE',
          }),
        }),
      );
      // Side effects (Payment, Order updates) inside the same tx were rolled back
    });
  });

  // ── Refund ITNs (Phase 5) ──────────────────────────────────────────────────

  describe('refund ITN handling (transaction_type=refund)', () => {
    function refundItnBody(): Record<string, string> {
      return buildItnBody({
        transaction_type: 'refund',
        payment_status: 'COMPLETE',
      });
    }

    it('records PaymentEvent with transactionType=REFUND', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUNDED', 'CONFIRMED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      expect(mockPrisma.paymentEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ transactionType: 'REFUND' }),
        }),
      );
    });

    it('transitions COMPLETED → REFUNDED when total refunded equals total gross', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUNDED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500], // = total gross
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe('REFUNDED');
    });

    it('transitions COMPLETED → PARTIALLY_REFUNDED when only some refunded', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUND_REQUESTED', 'CONFIRMED'],
          paymentRefundAmounts: [10000, 0], // total < gross
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe('PARTIALLY_REFUNDED');
    });

    it('PARTIALLY_REFUNDED → REFUNDED on a follow-up refund ITN that completes the total', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'PARTIALLY_REFUNDED',
          orderStatuses: ['REFUNDED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r2' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({
        id: PAYMENT_GROUP_ID,
        status: 'PARTIALLY_REFUNDED',
      });
      expect(call.data.status).toBe('REFUNDED');
    });

    it('does NOT touch Order rows (admin flow already updated them)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUNDED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      expect(mockPrisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('does NOT mutate Payment.refundedAmountInCents (admin flow already accumulated it)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUNDED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('rejects refund ITN when PaymentGroup is still PENDING (invalid transition)', async () => {
      // PENDING → REFUNDED is not allowed
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'PENDING',
          orderStatuses: ['PENDING', 'PENDING'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });

      await expect(
        service.handle(refundItnBody(), SOURCE_IP),
      ).resolves.toBeUndefined();

      expect(mockPrisma.paymentGroup.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.paymentEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            processed: false,
            processError: expect.stringContaining('INVALID_TRANSITION'),
          }),
        }),
      );
    });

    it('CANCELLED-stays-CANCELLED rule does NOT apply to refund ITNs', async () => {
      // Even with a CANCELLED child order, a refund ITN should proceed normally.
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['CANCELLED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(refundItnBody(), SOURCE_IP);

      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.status).toBe('REFUNDED'); // not RECONCILE_REQUIRED
    });

    it('persists the refund ITN payload + signature on PaymentGroup for audit', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(
        buildPaymentGroup({
          status: 'COMPLETED',
          orderStatuses: ['REFUNDED', 'REFUNDED'],
          paymentRefundAmounts: [27500, 27500],
        }),
      );
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-r1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      const body = refundItnBody();
      await service.handle(body, SOURCE_IP);

      const call = mockPrisma.paymentGroup.updateMany.mock.calls[0][0];
      expect(call.data.itnPayload).toBe(body);
      expect(call.data.pfSignature).toBe(body.signature);
    });
  });

  // ── itnHash determinism ───────────────────────────────────────────────────

  describe('itnHash idempotency key', () => {
    it('identical payloads produce identical hashes (replay dedupe)', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      const event = { id: 'evt-1' };
      mockPrisma.paymentEvent.create.mockResolvedValue(event);
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      const body = buildItnBody();
      await service.handle(body, SOURCE_IP);
      const firstHash =
        mockPrisma.paymentEvent.create.mock.calls[0][0].data.itnHash;

      mockPrisma.paymentEvent.create.mockClear();
      await service.handle(body, SOURCE_IP);
      const secondHash =
        mockPrisma.paymentEvent.create.mock.calls[0][0].data.itnHash;

      expect(firstHash).toBe(secondHash);
      expect(firstHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    });

    it('different payloads (e.g., different status) produce different hashes', async () => {
      mockPrisma.paymentGroup.findUnique.mockResolvedValue(buildPaymentGroup());
      mockPrisma.paymentEvent.create.mockResolvedValue({ id: 'evt-1' });
      mockPrisma.paymentGroup.updateMany.mockResolvedValue({ count: 1 });

      await service.handle(buildItnBody(), SOURCE_IP);
      const completeHash =
        mockPrisma.paymentEvent.create.mock.calls[0][0].data.itnHash;

      mockPrisma.paymentEvent.create.mockClear();
      await service.handle(
        buildItnBody({ payment_status: 'FAILED' }),
        SOURCE_IP,
      );
      const failedHash =
        mockPrisma.paymentEvent.create.mock.calls[0][0].data.itnHash;

      expect(completeHash).not.toBe(failedHash);
    });
  });
});
