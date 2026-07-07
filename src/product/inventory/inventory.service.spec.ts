import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const STORE_ID = 'store-1';

const bareProductLow = {
  id: 'prod-bare',
  title: 'Linen Throw',
  status: 'ACTIVE',
  totalStock: 6,
  reservedStock: 2, // available 4 <= threshold 5
  lowStockThreshold: 5,
  variants: [],
  images: [{ url: 'https://cdn.example/throw.jpg' }],
};

const bareProductHealthy = {
  ...bareProductLow,
  id: 'prod-healthy',
  title: 'Cotton Tee',
  totalStock: 50,
  reservedStock: 0,
  images: [],
};

const variantProduct = {
  id: 'prod-var',
  title: 'Field Jacket',
  status: 'ACTIVE',
  totalStock: 0, // ignored for variant products
  reservedStock: 0,
  lowStockThreshold: 5,
  variants: [
    { id: 'v-1', name: 'S', sku: 'FJ-S', stock: 20, reservedStock: 0 },
    { id: 'v-2', name: 'M', sku: 'FJ-M', stock: 6, reservedStock: 3 }, // available 3 → low
    { id: 'v-3', name: 'L', sku: 'FJ-L', stock: 0, reservedStock: 0 }, // available 0 → low
  ],
  images: [],
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  product: { findMany: jest.fn() },
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(InventoryService);
    jest.clearAllMocks();

    mockStoreService.canManageStore.mockResolvedValue(true);
    mockPrisma.product.findMany.mockResolvedValue([]);
  });

  describe('getLowStock', () => {
    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(service.getLowStock(USER_ID, STORE_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    });

    it('flags bare products by totalStock net of reservations', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        bareProductLow,
        bareProductHealthy,
      ]);

      const result = await service.getLowStock(USER_ID, STORE_ID);

      expect(result.count).toBe(1);
      expect(result.items[0]).toMatchObject({
        productId: 'prod-bare',
        availableStock: 4,
        hasVariants: false,
        lowVariants: [],
        primaryImageUrl: 'https://cdn.example/throw.jpg',
      });
    });

    it('flags variant products per-variant and ignores bare totalStock', async () => {
      mockPrisma.product.findMany.mockResolvedValue([variantProduct]);

      const result = await service.getLowStock(USER_ID, STORE_ID);

      expect(result.count).toBe(1);
      const item = result.items[0];
      expect(item.hasVariants).toBe(true);
      expect(item.lowVariants.map((v) => v.id)).toEqual(['v-2', 'v-3']);
      expect(item.lowVariants[0].availableStock).toBe(3);
      // Sum of LOW variants only (healthy S size not counted).
      expect(item.availableStock).toBe(3);
    });

    it('sorts items most-critical first', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        bareProductLow, // available 4
        variantProduct, // low sum 3
      ]);

      const result = await service.getLowStock(USER_ID, STORE_ID);

      expect(result.items.map((i) => i.productId)).toEqual([
        'prod-var',
        'prod-bare',
      ]);
    });

    it('queries only sellable statuses', async () => {
      await service.getLowStock(USER_ID, STORE_ID);

      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: STORE_ID,
            status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
          },
        }),
      );
    });
  });
});
