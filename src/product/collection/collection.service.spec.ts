import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus, StoreStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CollectionService } from './collection.service';

const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const COLLECTION_ID = 'col-1';
const PRODUCT_ID = 'prod-1';

const mockPrisma: any = {
  storeCollection: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  productCollection: {
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
  store: {
    findUnique: jest.fn(),
  },
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

describe('CollectionService', () => {
  let service: CollectionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        CollectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(CollectionService);
  });

  describe('listForMerchant', () => {
    const rows = [
      {
        id: 'col-a',
        storeId: STORE_ID,
        name: 'Summer 2026',
        slug: 'summer-2026',
        sortOrder: 0,
        _count: { products: 4 },
      },
    ];

    it('returns collections with product counts ordered by sortOrder then name', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeCollection.findMany.mockResolvedValue(rows);

      const result = await service.listForMerchant(
        USER_ID,
        UserRole.MERCHANT,
        STORE_ID,
      );

      expect(mockStoreService.canManageStore).toHaveBeenCalledWith(
        USER_ID,
        STORE_ID,
      );
      expect(mockPrisma.storeCollection.findMany).toHaveBeenCalledWith({
        where: { storeId: STORE_ID },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: true } } },
      });
      expect(result).toEqual({ data: rows });
    });

    it('throws 403 when the user cannot manage the store (also covers missing store via canManageStore)', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.listForMerchant(USER_ID, UserRole.BUYER, STORE_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.storeCollection.findMany).not.toHaveBeenCalled();
    });

    it('allows ADMIN to read any store without calling canManageStore', async () => {
      mockPrisma.storeCollection.findMany.mockResolvedValue(rows);

      const result = await service.listForMerchant(
        USER_ID,
        UserRole.ADMIN,
        STORE_ID,
      );

      expect(mockStoreService.canManageStore).not.toHaveBeenCalled();
      expect(result).toEqual({ data: rows });
    });
  });

  describe('removeProduct — last-collection-on-ACTIVE rule', () => {
    beforeEach(() => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.store.findUnique.mockResolvedValue({
        status: StoreStatus.ACTIVE,
      });
      mockPrisma.storeCollection.findUnique.mockResolvedValue({
        id: COLLECTION_ID,
        storeId: STORE_ID,
      });
      mockPrisma.productCollection.findUnique.mockResolvedValue({
        productId: PRODUCT_ID,
        collectionId: COLLECTION_ID,
      });
    });

    it('rejects when product is ACTIVE and this is its only collection', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        status: ProductStatus.ACTIVE,
        _count: { collections: 1 },
      });

      await expect(
        service.removeProduct(USER_ID, STORE_ID, COLLECTION_ID, PRODUCT_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.productCollection.delete).not.toHaveBeenCalled();
    });

    it('allows removal when ACTIVE product has another collection', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        status: ProductStatus.ACTIVE,
        _count: { collections: 2 },
      });
      mockPrisma.productCollection.delete.mockResolvedValue({});

      const result = await service.removeProduct(
        USER_ID,
        STORE_ID,
        COLLECTION_ID,
        PRODUCT_ID,
      );

      expect(mockPrisma.productCollection.delete).toHaveBeenCalledWith({
        where: {
          productId_collectionId: {
            productId: PRODUCT_ID,
            collectionId: COLLECTION_ID,
          },
        },
      });
      expect(result).toEqual({ success: true });
    });

    it('allows removal of the only collection when product is DRAFT', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        status: ProductStatus.DRAFT,
        _count: { collections: 1 },
      });
      mockPrisma.productCollection.delete.mockResolvedValue({});

      const result = await service.removeProduct(
        USER_ID,
        STORE_ID,
        COLLECTION_ID,
        PRODUCT_ID,
      );

      expect(mockPrisma.productCollection.delete).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('throws 404 when the product is not linked to this collection', async () => {
      mockPrisma.productCollection.findUnique.mockResolvedValue(null);

      await expect(
        service.removeProduct(USER_ID, STORE_ID, COLLECTION_ID, PRODUCT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.productCollection.delete).not.toHaveBeenCalled();
    });
  });
});
