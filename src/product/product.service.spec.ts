import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CategoryService } from './category/category.service';
import { ProductService } from './product.service';

// Focused spec — only covers the ADMIN read-access change on
// listProducts/getProduct. Mutations still depend on canManageStore as before
// and are not retested here.

const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';

const mockPrisma: any = {
  product: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  // listProducts uses `prisma.$transaction([count(), findMany()])` (array form).
  // The mocks for count/findMany return resolved values directly, so the wrapper
  // just awaits and forwards them.
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

const mockCategoryService = {};

describe('ProductService — admin read access', () => {
  let service: ProductService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
        { provide: CategoryService, useValue: mockCategoryService },
      ],
    }).compile();

    service = module.get(ProductService);
  });

  describe('listProducts', () => {
    it('allows ADMIN to read any store without calling canManageStore', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);

      await service.listProducts(USER_ID, UserRole.ADMIN, STORE_ID, {} as any);

      expect(mockStoreService.canManageStore).not.toHaveBeenCalled();
      expect(mockPrisma.product.findMany).toHaveBeenCalled();
    });

    it('throws 403 for non-admin when canManageStore is false', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.listProducts(USER_ID, UserRole.BUYER, STORE_ID, {} as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });

    it('allows MERCHANT owner/employee when canManageStore is true', async () => {
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.count.mockResolvedValue(0);

      await service.listProducts(USER_ID, UserRole.MERCHANT, STORE_ID, {} as any);

      expect(mockStoreService.canManageStore).toHaveBeenCalledWith(
        USER_ID,
        STORE_ID,
      );
      expect(mockPrisma.product.findMany).toHaveBeenCalled();
    });
  });

  describe('getProduct', () => {
    const product = {
      id: PRODUCT_ID,
      storeId: STORE_ID,
      title: 'Widget',
      images: [],
      variants: [],
      categories: [],
      tags: [],
      collections: [],
    };

    it('allows ADMIN to read a product without calling canManageStore', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(product);

      const result = await service.getProduct(
        USER_ID,
        UserRole.ADMIN,
        STORE_ID,
        PRODUCT_ID,
      );

      expect(mockStoreService.canManageStore).not.toHaveBeenCalled();
      expect(result).toEqual(product);
    });

    it('throws 403 for non-admin when canManageStore is false', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.getProduct(USER_ID, UserRole.BUYER, STORE_ID, PRODUCT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.product.findUnique).not.toHaveBeenCalled();
    });
  });
});
