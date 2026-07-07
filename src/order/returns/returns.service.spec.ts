import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BUYER_ID = 'buyer-1';
const MERCHANT_ID = 'merchant-1';
const STORE_ID = 'store-1';
const GROUP_ID = 'pg-1';
const RETURN_ID = 'ret-1';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const deliveredOrder = {
  id: 'order-1',
  storeId: STORE_ID,
  status: 'DELIVERED',
  deliveredAt: daysAgo(5),
};

const buildGroup = (orders: any[]) => ({
  id: GROUP_ID,
  payments: orders.map((order) => ({ order })),
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  paymentGroup: { findFirst: jest.fn() },
  returnRequest: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops: any) => Promise.all(ops)),
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('ReturnsService', () => {
  let service: ReturnsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(ReturnsService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: any) => Promise.all(ops));

    mockStoreService.canManageStore.mockResolvedValue(true);
    mockPrisma.returnRequest.findMany.mockResolvedValue([]);
    mockPrisma.returnRequest.create.mockResolvedValue({
      id: RETURN_ID,
      orderId: 'order-1',
      status: 'REQUESTED',
      reason: 'WRONG_SIZE',
      createdAt: new Date(),
    });
  });

  describe('requestReturn', () => {
    it('404s when the payment group does not belong to the buyer', async () => {
      mockPrisma.paymentGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.requestReturn(BUYER_ID, GROUP_ID, { reason: 'WRONG_SIZE' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s when no child order is DELIVERED', async () => {
      mockPrisma.paymentGroup.findFirst.mockResolvedValue(
        buildGroup([{ ...deliveredOrder, status: 'IN_TRANSIT' }]),
      );

      await expect(
        service.requestReturn(BUYER_ID, GROUP_ID, { reason: 'WRONG_SIZE' }),
      ).rejects.toThrow(ConflictException);
    });

    it('409s when delivery is outside the 30-day window', async () => {
      mockPrisma.paymentGroup.findFirst.mockResolvedValue(
        buildGroup([{ ...deliveredOrder, deliveredAt: daysAgo(31) }]),
      );

      await expect(
        service.requestReturn(BUYER_ID, GROUP_ID, { reason: 'WRONG_SIZE' }),
      ).rejects.toThrow(ConflictException);
    });

    it('409s when a return is already open for the order', async () => {
      mockPrisma.paymentGroup.findFirst.mockResolvedValue(
        buildGroup([deliveredOrder]),
      );
      mockPrisma.returnRequest.findMany.mockResolvedValue([
        { orderId: 'order-1' },
      ]);

      await expect(
        service.requestReturn(BUYER_ID, GROUP_ID, { reason: 'WRONG_SIZE' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a REQUESTED return for each eligible child order', async () => {
      mockPrisma.paymentGroup.findFirst.mockResolvedValue(
        buildGroup([deliveredOrder]),
      );

      const result = await service.requestReturn(BUYER_ID, GROUP_ID, {
        reason: 'WRONG_SIZE',
        details: '  Too small  ',
      });

      expect(result.returns).toHaveLength(1);
      expect(mockPrisma.returnRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            orderId: 'order-1',
            storeId: STORE_ID,
            buyerId: BUYER_ID,
            reason: 'WRONG_SIZE',
            details: 'Too small',
          },
        }),
      );
    });
  });

  describe('listForStore', () => {
    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.listForStore(MERCHANT_ID, STORE_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects invalid status filters', async () => {
      await expect(
        service.listForStore(MERCHANT_ID, STORE_ID, { status: 'BOGUS' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps rows with buyer name and paginates take+1', async () => {
      const row = {
        id: RETURN_ID,
        reason: 'DAMAGED',
        details: null,
        status: 'REQUESTED',
        merchantNotes: null,
        createdAt: new Date(),
        resolvedAt: null,
        order: {
          id: 'order-1',
          orderNumber: 'YV-2026-AAAAAA',
          totalInCents: 50_000,
          deliveredAt: daysAgo(3),
        },
        buyer: { firstName: 'Naledi', lastName: 'M', email: 'n@x.co' },
      };
      mockPrisma.returnRequest.findMany.mockResolvedValue([
        row,
        { ...row, id: 'ret-2' },
      ]);

      const result = await service.listForStore(MERCHANT_ID, STORE_ID, {
        take: '1',
      });

      expect(result.returns).toHaveLength(1);
      expect(result.returns[0].buyer).toEqual({
        name: 'Naledi M',
        email: 'n@x.co',
      });
      expect(result.nextCursor).toBe(RETURN_ID);
    });
  });

  describe('transitions', () => {
    beforeEach(() => {
      mockPrisma.returnRequest.findUnique.mockResolvedValue({
        id: RETURN_ID,
        storeId: STORE_ID,
        status: 'REQUESTED',
      });
      mockPrisma.returnRequest.update.mockResolvedValue({
        id: RETURN_ID,
        status: 'APPROVED',
        merchantNotes: null,
        resolvedAt: null,
      });
    });

    it('approves a REQUESTED return', async () => {
      await service.approve(MERCHANT_ID, STORE_ID, RETURN_ID, 'ok');

      expect(mockPrisma.returnRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RETURN_ID },
          data: expect.objectContaining({
            status: 'APPROVED',
            merchantNotes: 'ok',
          }),
        }),
      );
    });

    it('404s cross-store return requests', async () => {
      mockPrisma.returnRequest.findUnique.mockResolvedValue({
        id: RETURN_ID,
        storeId: 'other-store',
        status: 'REQUESTED',
      });

      await expect(
        service.approve(MERCHANT_ID, STORE_ID, RETURN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects invalid transitions (received before approval)', async () => {
      await expect(
        service.markReceived(MERCHANT_ID, STORE_ID, RETURN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets resolvedAt on reject', async () => {
      await service.reject(MERCHANT_ID, STORE_ID, RETURN_ID, 'worn item');

      expect(mockPrisma.returnRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REJECTED',
            resolvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('closes only from RECEIVED', async () => {
      mockPrisma.returnRequest.findUnique.mockResolvedValue({
        id: RETURN_ID,
        storeId: STORE_ID,
        status: 'RECEIVED',
      });

      await service.close(MERCHANT_ID, STORE_ID, RETURN_ID);

      expect(mockPrisma.returnRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
    });
  });
});
