import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { DispatchAddressService } from './dispatch-address.service';

const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const OTHER_STORE_ID = 'store-2';
const ADDR_ID = 'addr-1';

const baseDto = {
  contactName: 'Khanyi',
  contactPhone: '0820000000',
  addressLine1: '194 Bancor Avenue',
  city: 'Pretoria',
  province: 'Gauteng',
  postalCode: '0181',
};

const baseRow = {
  id: ADDR_ID,
  storeId: STORE_ID,
  label: null,
  contactName: 'Khanyi',
  contactPhone: '+27820000000',
  addressLine1: '194 Bancor Avenue',
  addressLine2: null,
  suburb: null,
  city: 'Pretoria',
  province: 'Gauteng',
  postalCode: '0181',
  country: 'South Africa',
  latitude: null,
  longitude: null,
  isPrimary: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma: any = {
  storeDispatchAddress: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

describe('DispatchAddressService', () => {
  let service: DispatchAddressService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));

    const module = await Test.createTestingModule({
      providers: [
        DispatchAddressService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(DispatchAddressService);
  });

  // ─── authz ──────────────────────────────────────────────────────────────────

  describe('authz', () => {
    it('throws 403 when canManageStore returns false', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(service.list(USER_ID, STORE_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.update(USER_ID, STORE_ID, ADDR_ID, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.delete(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.setPrimary(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ─── list / read ────────────────────────────────────────────────────────────

  describe('list', () => {
    it('filters out soft-deleted rows and orders by isPrimary then createdAt', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeDispatchAddress.findMany.mockResolvedValue([baseRow]);

      await service.list(USER_ID, STORE_ID);

      expect(mockPrisma.storeDispatchAddress.findMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('getById', () => {
    it('returns the row when it belongs to the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(baseRow);

      const result = await service.getById(USER_ID, STORE_ID, ADDR_ID);
      expect(result.id).toBe(ADDR_ID);
    });

    it('throws 404 when the address belongs to a different store (enumeration prevention)', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        storeId: OTHER_STORE_ID,
      });

      await expect(
        service.getById(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the address does not exist', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(null);

      await expect(
        service.getById(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      mockStoreService.canManageStore.mockResolvedValue(true);
    });

    it('first dispatch address auto-promotes to primary regardless of body', async () => {
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(0);
      mockPrisma.storeDispatchAddress.create.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });

      const result = await service.create(USER_ID, STORE_ID, {
        ...baseDto,
        isPrimary: false, // even with false, first one becomes primary
      });

      expect(result.isPrimary).toBe(true);
      expect(mockPrisma.storeDispatchAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPrimary: true,
            storeId: STORE_ID,
            contactPhone: '+27820000000', // normalised
          }),
        }),
      );
    });

    it('clears prior primary when creating a new one with isPrimary: true', async () => {
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(2);
      mockPrisma.storeDispatchAddress.create.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });

      await service.create(USER_ID, STORE_ID, { ...baseDto, isPrimary: true });

      expect(mockPrisma.storeDispatchAddress.updateMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID, isPrimary: true, deletedAt: null },
        data: { isPrimary: false },
      });
    });

    it('non-first address with isPrimary: false stays non-primary', async () => {
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(3);
      mockPrisma.storeDispatchAddress.create.mockResolvedValue(baseRow);

      await service.create(USER_ID, STORE_ID, baseDto); // no isPrimary

      expect(mockPrisma.storeDispatchAddress.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.storeDispatchAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPrimary: false }),
        }),
      );
    });

    it('normalises +27 phone format', async () => {
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(0);
      mockPrisma.storeDispatchAddress.create.mockResolvedValue(baseRow);

      await service.create(USER_ID, STORE_ID, {
        ...baseDto,
        contactPhone: '+27821234567',
      });

      expect(mockPrisma.storeDispatchAddress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contactPhone: '+27821234567' }),
        }),
      );
    });
  });

  // ─── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    beforeEach(() => {
      mockStoreService.canManageStore.mockResolvedValue(true);
    });

    it('returns existing row when DTO is empty (no API call)', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(baseRow);

      const result = await service.update(USER_ID, STORE_ID, ADDR_ID, {});

      expect(result).toEqual(baseRow);
      expect(mockPrisma.storeDispatchAddress.update).not.toHaveBeenCalled();
    });

    it('applies only the fields present in the DTO', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(baseRow);
      mockPrisma.storeDispatchAddress.update.mockResolvedValue({
        ...baseRow,
        city: 'Cape Town',
      });

      await service.update(USER_ID, STORE_ID, ADDR_ID, { city: 'Cape Town ' });

      expect(mockPrisma.storeDispatchAddress.update).toHaveBeenCalledWith({
        where: { id: ADDR_ID },
        data: { city: 'Cape Town' },
      });
    });

    it('throws 404 when the address is soft-deleted', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        deletedAt: new Date(),
      });

      await expect(
        service.update(USER_ID, STORE_ID, ADDR_ID, { city: 'Cape Town' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    beforeEach(() => {
      mockStoreService.canManageStore.mockResolvedValue(true);
    });

    it('soft-deletes a non-primary address', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(baseRow);
      mockPrisma.storeDispatchAddress.update.mockResolvedValue({});

      const result = await service.delete(USER_ID, STORE_ID, ADDR_ID);

      expect(result).toEqual({ success: true });
      expect(mockPrisma.storeDispatchAddress.update).toHaveBeenCalledWith({
        where: { id: ADDR_ID },
        data: { deletedAt: expect.any(Date), isPrimary: false },
      });
    });

    it('rejects deletion of the primary address when other active addresses exist', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(2); // others exist

      await expect(
        service.delete(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.storeDispatchAddress.update).not.toHaveBeenCalled();
    });

    it('allows deletion of the primary when it is the only address (closing out shipping)', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });
      mockPrisma.storeDispatchAddress.count.mockResolvedValue(0); // no others
      mockPrisma.storeDispatchAddress.update.mockResolvedValue({});

      const result = await service.delete(USER_ID, STORE_ID, ADDR_ID);
      expect(result).toEqual({ success: true });
    });

    it('throws 404 on cross-store delete attempt', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        storeId: OTHER_STORE_ID,
      });

      await expect(
        service.delete(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── setPrimary ─────────────────────────────────────────────────────────────

  describe('setPrimary', () => {
    beforeEach(() => {
      mockStoreService.canManageStore.mockResolvedValue(true);
    });

    it('clears the prior primary and promotes the target', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue(baseRow);
      mockPrisma.storeDispatchAddress.update.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });

      await service.setPrimary(USER_ID, STORE_ID, ADDR_ID);

      expect(mockPrisma.storeDispatchAddress.updateMany).toHaveBeenCalledWith({
        where: {
          storeId: STORE_ID,
          isPrimary: true,
          deletedAt: null,
          NOT: { id: ADDR_ID },
        },
        data: { isPrimary: false },
      });
      expect(mockPrisma.storeDispatchAddress.update).toHaveBeenCalledWith({
        where: { id: ADDR_ID },
        data: { isPrimary: true },
      });
    });

    it('is a no-op when the address is already primary', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        isPrimary: true,
      });

      await service.setPrimary(USER_ID, STORE_ID, ADDR_ID);

      expect(mockPrisma.storeDispatchAddress.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.storeDispatchAddress.update).not.toHaveBeenCalled();
    });

    it('throws 404 when target is soft-deleted', async () => {
      mockPrisma.storeDispatchAddress.findUnique.mockResolvedValue({
        ...baseRow,
        deletedAt: new Date(),
      });

      await expect(
        service.setPrimary(USER_ID, STORE_ID, ADDR_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
