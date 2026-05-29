import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MediaType, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';
import { BannerMediaService } from './banner-media.service';

const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const OTHER_STORE_ID = 'store-2';
const CLOUD_URL = 'https://res.cloudinary.com/yiiva-dev/image/upload/v1/test.jpg';

const mockPrisma: any = {
  storeBannerMedia: {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  store: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

describe('BannerMediaService', () => {
  let service: BannerMediaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // $transaction is invoked with a callback; relay to the same mock prisma.
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));

    const module = await Test.createTestingModule({
      providers: [
        BannerMediaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(BannerMediaService);
  });

  describe('addBannerMedia', () => {
    it('creates a first item as cover (isPrimary: true, sortOrder: 0)', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.count.mockResolvedValue(0);
      mockPrisma.storeBannerMedia.create.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        url: CLOUD_URL,
        mediaType: MediaType.IMAGE,
        sortOrder: 0,
        isPrimary: true,
      });

      const result = await service.addBannerMedia(USER_ID, STORE_ID, {
        url: CLOUD_URL,
        mediaType: MediaType.IMAGE,
      });

      expect(mockPrisma.storeBannerMedia.create).toHaveBeenCalledWith({
        data: {
          storeId: STORE_ID,
          url: CLOUD_URL,
          mediaType: MediaType.IMAGE,
          sortOrder: 0,
          isPrimary: true,
        },
      });
      expect(result.isPrimary).toBe(true);
      expect(result.sortOrder).toBe(0);
    });

    it('appends subsequent items at the end with isPrimary: false', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.count.mockResolvedValue(3);
      mockPrisma.storeBannerMedia.create.mockResolvedValue({
        id: 'bm-4',
        storeId: STORE_ID,
        url: CLOUD_URL,
        mediaType: MediaType.VIDEO,
        sortOrder: 3,
        isPrimary: false,
      });

      await service.addBannerMedia(USER_ID, STORE_ID, {
        url: CLOUD_URL,
        mediaType: MediaType.VIDEO,
      });

      expect(mockPrisma.storeBannerMedia.create).toHaveBeenCalledWith({
        data: {
          storeId: STORE_ID,
          url: CLOUD_URL,
          mediaType: MediaType.VIDEO,
          sortOrder: 3,
          isPrimary: false,
        },
      });
    });

    it('throws 400 when the gallery is at the 5-item cap', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.count.mockResolvedValue(5);

      await expect(
        service.addBannerMedia(USER_ID, STORE_ID, {
          url: CLOUD_URL,
          mediaType: MediaType.IMAGE,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storeBannerMedia.create).not.toHaveBeenCalled();
    });

    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.addBannerMedia(USER_ID, STORE_ID, {
          url: CLOUD_URL,
          mediaType: MediaType.IMAGE,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.storeBannerMedia.count).not.toHaveBeenCalled();
    });
  });

  describe('removeBannerMedia', () => {
    it('removes an item and renumbers the remaining items', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      // The item being removed
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-2',
        storeId: STORE_ID,
        isPrimary: false,
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.DRAFT,
      });
      // Pre-delete count
      mockPrisma.storeBannerMedia.count.mockResolvedValue(3);
      // Post-delete findMany returns the remaining 2 items
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([
        { id: 'bm-1' },
        { id: 'bm-3' },
      ]);

      const result = await service.removeBannerMedia(USER_ID, STORE_ID, 'bm-2');

      expect(mockPrisma.storeBannerMedia.delete).toHaveBeenCalledWith({
        where: { id: 'bm-2' },
      });
      // Both remaining items should be renumbered
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'bm-1' },
        data: { sortOrder: 0, isPrimary: true },
      });
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'bm-3' },
        data: { sortOrder: 1, isPrimary: false },
      });
      expect(result).toEqual({ message: 'Banner media removed' });
    });

    it('promotes the next item to cover when the deleted item was the cover', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        isPrimary: true, // ← was the cover
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.APPROVED,
      });
      mockPrisma.storeBannerMedia.count.mockResolvedValue(2);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([{ id: 'bm-2' }]);

      await service.removeBannerMedia(USER_ID, STORE_ID, 'bm-1');

      // bm-2 (formerly index 1) is now the only item — should be promoted
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'bm-2' },
        data: { sortOrder: 0, isPrimary: true },
      });
    });

    it('throws 404 when the item does not exist', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue(null);

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when the item belongs to a different store (anti-enumeration)', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-x',
        storeId: OTHER_STORE_ID, // ← different store
        isPrimary: false,
      });

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'bm-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when deleting the last item on an ACTIVE store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        isPrimary: true,
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.ACTIVE,
      });
      mockPrisma.storeBannerMedia.count.mockResolvedValue(1);

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'bm-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.storeBannerMedia.delete).not.toHaveBeenCalled();
    });

    it('throws 400 when deleting the last item on a PENDING_GO_LIVE store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        isPrimary: true,
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.PENDING_GO_LIVE,
      });
      mockPrisma.storeBannerMedia.count.mockResolvedValue(1);

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'bm-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows deleting the last item on a DRAFT store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        isPrimary: true,
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.DRAFT,
      });
      mockPrisma.storeBannerMedia.count.mockResolvedValue(1);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([]);

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'bm-1'),
      ).resolves.toEqual({ message: 'Banner media removed' });
    });

    it('allows deleting the last item on an APPROVED store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findUnique.mockResolvedValue({
        id: 'bm-1',
        storeId: STORE_ID,
        isPrimary: true,
      });
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.APPROVED,
      });
      mockPrisma.storeBannerMedia.count.mockResolvedValue(1);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([]);

      await expect(
        service.removeBannerMedia(USER_ID, STORE_ID, 'bm-1'),
      ).resolves.toEqual({ message: 'Banner media removed' });
    });
  });

  describe('reorderBannerMedia', () => {
    it('reorders the gallery and sets the first id as cover', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValueOnce([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      // For the return-the-reordered-gallery call at the end
      mockPrisma.storeBannerMedia.findMany.mockResolvedValueOnce([
        { id: 'c', sortOrder: 0, isPrimary: true },
        { id: 'a', sortOrder: 1, isPrimary: false },
        { id: 'b', sortOrder: 2, isPrimary: false },
      ]);

      await service.reorderBannerMedia(USER_ID, STORE_ID, {
        ids: ['c', 'a', 'b'],
      });

      // Each item gets the right sortOrder + isPrimary on index 0 only
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'c' },
        data: { sortOrder: 0, isPrimary: true },
      });
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'a' },
        data: { sortOrder: 1, isPrimary: false },
      });
      expect(mockPrisma.storeBannerMedia.update).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { sortOrder: 2, isPrimary: false },
      });
    });

    it('throws 400 when the ids array has fewer items than the current set', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      await expect(
        service.reorderBannerMedia(USER_ID, STORE_ID, {
          ids: ['a', 'b'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when ids array has duplicates', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        service.reorderBannerMedia(USER_ID, STORE_ID, {
          ids: ['a', 'a'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when ids contains an unknown id', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeBannerMedia.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        service.reorderBannerMedia(USER_ID, STORE_ID, {
          ids: ['a', 'unknown'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.reorderBannerMedia(USER_ID, STORE_ID, {
          ids: ['a', 'b'],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
