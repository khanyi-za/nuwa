import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AddressService } from './address.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const USER_ID = 'user-cuid-1';
const ADDRESS_ID = 'addr-cuid-1';
const OTHER_ADDRESS_ID = 'addr-cuid-2';

const baseAddress = {
  id: ADDRESS_ID,
  userId: USER_ID,
  label: 'Home',
  recipientName: 'Thandi Dlamini',
  phone: '+27821234567',
  addressLine1: '10 Baker St',
  addressLine2: null,
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '8001',
  country: 'South Africa',
  isDefault: true,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const validCreateDto: CreateAddressDto = {
  label: 'Home',
  recipientName: 'Thandi Dlamini',
  phone: '0821234567',
  addressLine1: '10 Baker St',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '8001',
};

// ─── Prisma mock ────────────────────────────────────────────────────────────

const mockPrisma = {
  address: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  // `$transaction(fn)` — just call the callback with the same mock acting as tx.
  $transaction: jest.fn((fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  ),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('AddressService', () => {
  let service: AddressService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AddressService>(AddressService);
    jest.clearAllMocks();
    // Re-bind the $transaction implementation after clearAllMocks.
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));
  });

  // ─── list / getById ──────────────────────────────────────────────────────

  describe('list', () => {
    it('returns only active addresses for the user, defaults first', async () => {
      mockPrisma.address.findMany.mockResolvedValue([baseAddress]);

      const result = await service.list(USER_ID);

      expect(mockPrisma.address.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      });
      expect(result).toEqual([baseAddress]);
    });
  });

  describe('getById', () => {
    it('returns the address when owned and active', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);

      const result = await service.getById(USER_ID, ADDRESS_ID);

      expect(result).toEqual(baseAddress);
    });

    it('throws 404 when the address belongs to another user', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        userId: 'other-user',
      });

      await expect(service.getById(USER_ID, ADDRESS_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when the address is soft-deleted', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        deletedAt: new Date(),
      });

      await expect(service.getById(USER_ID, ADDRESS_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when the address does not exist', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(null);

      await expect(service.getById(USER_ID, ADDRESS_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('auto-defaults the first address regardless of isDefault in body', async () => {
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.address.create.mockResolvedValue(baseAddress);

      await service.create(USER_ID, { ...validCreateDto, isDefault: false });

      expect(mockPrisma.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: true }),
        }),
      );
    });

    it('normalizes phone to +27 canonical form before persisting', async () => {
      mockPrisma.address.count.mockResolvedValue(0);
      mockPrisma.address.create.mockResolvedValue(baseAddress);

      await service.create(USER_ID, { ...validCreateDto, phone: '0821234567' });

      expect(mockPrisma.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '+27821234567' }),
        }),
      );
    });

    it('flips existing defaults to false when creating a new default', async () => {
      mockPrisma.address.count.mockResolvedValue(2);
      mockPrisma.address.create.mockResolvedValue(baseAddress);

      await service.create(USER_ID, { ...validCreateDto, isDefault: true });

      expect(mockPrisma.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      });
      expect(mockPrisma.address.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: true }),
        }),
      );
    });

    it('does not flip defaults when new address is non-default', async () => {
      mockPrisma.address.count.mockResolvedValue(2);
      mockPrisma.address.create.mockResolvedValue(baseAddress);

      await service.create(USER_ID, { ...validCreateDto, isDefault: false });

      expect(mockPrisma.address.updateMany).not.toHaveBeenCalled();
    });

    it('throws 409 when the 4-address cap is reached', async () => {
      mockPrisma.address.count.mockResolvedValue(4);

      await expect(
        service.create(USER_ID, validCreateDto),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.address.create).not.toHaveBeenCalled();
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates mutable fields and leaves default state alone', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      mockPrisma.address.update.mockResolvedValue({
        ...baseAddress,
        label: 'Work',
      });

      const dto: UpdateAddressDto = { label: 'Work' };
      await service.update(USER_ID, ADDRESS_ID, dto);

      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: { label: 'Work' },
      });
      expect(mockPrisma.address.updateMany).not.toHaveBeenCalled();
    });

    it('flips sibling defaults to false when promoting a non-default to default', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        id: OTHER_ADDRESS_ID,
        isDefault: false,
      });
      mockPrisma.address.update.mockResolvedValue({ ...baseAddress });

      await service.update(USER_ID, OTHER_ADDRESS_ID, { isDefault: true });

      expect(mockPrisma.address.updateMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          isDefault: true,
          deletedAt: null,
          NOT: { id: OTHER_ADDRESS_ID },
        },
        data: { isDefault: false },
      });
      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: OTHER_ADDRESS_ID },
        data: { isDefault: true },
      });
    });

    it('is a no-op on isDefault when target is already the default', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress); // already default
      mockPrisma.address.update.mockResolvedValue(baseAddress);

      await service.update(USER_ID, ADDRESS_ID, { isDefault: true });

      expect(mockPrisma.address.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: {},
      });
    });

    it('throws 409 when trying to unset the current default via PATCH', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress); // isDefault: true

      await expect(
        service.update(USER_ID, ADDRESS_ID, { isDefault: false }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.address.update).not.toHaveBeenCalled();
    });

    it('normalizes phone updates to canonical +27 form', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      mockPrisma.address.update.mockResolvedValue(baseAddress);

      await service.update(USER_ID, ADDRESS_ID, { phone: '0731112222' });

      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: { phone: '+27731112222' },
      });
    });

    it('throws 404 when the address does not belong to the caller', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        userId: 'other-user',
      });

      await expect(
        service.update(USER_ID, ADDRESS_ID, { label: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('soft-deletes and clears isDefault on the target', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        isDefault: false,
      });
      mockPrisma.address.update.mockResolvedValue(undefined);
      mockPrisma.address.findFirst.mockResolvedValue(null);

      const result = await service.delete(USER_ID, ADDRESS_ID);

      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          isDefault: false,
        }),
      });
      expect(result).toEqual({ success: true });
    });

    it('auto-promotes the most-recently-updated surviving address when the default is deleted', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress); // default
      mockPrisma.address.update.mockResolvedValue(undefined);
      const survivor = {
        ...baseAddress,
        id: OTHER_ADDRESS_ID,
        isDefault: false,
      };
      mockPrisma.address.findFirst.mockResolvedValue(survivor);

      await service.delete(USER_ID, ADDRESS_ID);

      expect(mockPrisma.address.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null, NOT: { id: ADDRESS_ID } },
        orderBy: { updatedAt: 'desc' },
      });
      expect(mockPrisma.address.update).toHaveBeenCalledWith({
        where: { id: OTHER_ADDRESS_ID },
        data: { isDefault: true },
      });
    });

    it('leaves the user with no default when the deleted default was the only address', async () => {
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      mockPrisma.address.update.mockResolvedValue(undefined);
      mockPrisma.address.findFirst.mockResolvedValue(null);

      await service.delete(USER_ID, ADDRESS_ID);

      // Only the soft-delete update fires; no promotion update.
      expect(mockPrisma.address.update).toHaveBeenCalledTimes(1);
    });

    it('throws 404 when the address does not belong to the caller', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        userId: 'other-user',
      });

      await expect(service.delete(USER_ID, ADDRESS_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.address.update).not.toHaveBeenCalled();
    });
  });
});
