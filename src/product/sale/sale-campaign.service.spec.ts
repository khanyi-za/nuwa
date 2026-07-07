import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SaleCampaignService } from './sale-campaign.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const CAMPAIGN_ID = 'camp-1';

const baseProduct = {
  id: 'prod-1',
  title: 'Linen Dress',
  status: 'ACTIVE',
  priceInCents: 100_000,
  comparePriceInCents: null,
  variants: [],
};

const variantProduct = {
  id: 'prod-2',
  title: 'Field Jacket',
  status: 'ACTIVE',
  priceInCents: 200_000,
  comparePriceInCents: null,
  variants: [
    { id: 'v-1', priceInCents: 220_000 }, // override — must be discounted too
    { id: 'v-2', priceInCents: null }, // inherits base — untouched
  ],
};

const baseDto = {
  name: 'Winter Sale',
  discountType: 'PERCENTAGE' as const,
  discountValue: 20,
  productIds: ['prod-1'],
};

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  saleCampaign: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  saleCampaignProduct: {
    findMany: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  productVariant: {
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  store: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('SaleCampaignService', () => {
  let service: SaleCampaignService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaleCampaignService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
      ],
    }).compile();

    service = module.get(SaleCampaignService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));

    mockStoreService.canManageStore.mockResolvedValue(true);
    mockPrisma.store.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    mockPrisma.product.findMany.mockResolvedValue([baseProduct]);
    mockPrisma.saleCampaignProduct.findMany.mockResolvedValue([]);
    mockPrisma.saleCampaign.create.mockResolvedValue({
      id: CAMPAIGN_ID,
      name: 'Winter Sale',
      status: 'ACTIVE',
    });
  });

  describe('create', () => {
    it('throws 403 when the user cannot manage the store', async () => {
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects stores that are not approved yet', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ status: 'DRAFT' });

      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('caps percentage discounts at 90', async () => {
      await expect(
        service.create(USER_ID, STORE_ID, { ...baseDto, discountValue: 95 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when a product does not belong to the store', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects non-ACTIVE products', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { ...baseProduct, status: 'DRAFT' },
      ]);

      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s when a product is already in an active sale', async () => {
      mockPrisma.saleCampaignProduct.findMany.mockResolvedValue([
        { productId: 'prod-1' },
      ]);

      await expect(
        service.create(USER_ID, STORE_ID, baseDto),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects discounts that would price a product below R1', async () => {
      mockPrisma.product.findMany.mockResolvedValue([
        { ...baseProduct, priceInCents: 500 },
      ]);

      await expect(
        service.create(USER_ID, STORE_ID, {
          ...baseDto,
          discountType: 'FIXED_AMOUNT',
          discountValue: 450,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.saleCampaign.create).not.toHaveBeenCalled();
    });

    it('applies the sale price and parks the original on comparePrice', async () => {
      const result = await service.create(USER_ID, STORE_ID, baseDto);

      expect(result).toMatchObject({ id: CAMPAIGN_ID, productCount: 1 });
      // Snapshot rows created with the campaign.
      const createArg = mockPrisma.saleCampaign.create.mock.calls[0][0];
      expect(createArg.data.products.create[0]).toMatchObject({
        productId: 'prod-1',
        originalPriceInCents: 100_000,
        salePriceInCents: 80_000, // 20% off
      });
      // Live price mutated inside the transaction.
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { priceInCents: 80_000, comparePriceInCents: 100_000 },
      });
    });

    it('discounts variant price overrides and snapshots their originals', async () => {
      mockPrisma.product.findMany.mockResolvedValue([variantProduct]);

      await service.create(USER_ID, STORE_ID, {
        ...baseDto,
        productIds: ['prod-2'],
      });

      const createArg = mockPrisma.saleCampaign.create.mock.calls[0][0];
      expect(createArg.data.products.create[0].originalVariantPrices).toEqual([
        { variantId: 'v-1', priceInCents: 220_000 },
      ]);
      // Only the override variant is touched (v-2 inherits base price).
      expect(mockPrisma.productVariant.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'v-1' },
        data: { priceInCents: 176_000 },
      });
    });
  });

  describe('endCampaign', () => {
    beforeEach(() => {
      mockPrisma.saleCampaign.findUnique.mockResolvedValue({
        id: CAMPAIGN_ID,
        storeId: STORE_ID,
        status: 'ACTIVE',
      });
      mockPrisma.saleCampaignProduct.findMany.mockResolvedValue([
        {
          productId: 'prod-1',
          originalPriceInCents: 100_000,
          originalComparePriceInCents: null,
          salePriceInCents: 80_000,
          originalVariantPrices: null,
          product: { id: 'prod-1', priceInCents: 80_000 },
        },
      ]);
    });

    it('404s cross-store campaigns', async () => {
      mockPrisma.saleCampaign.findUnique.mockResolvedValue({
        id: CAMPAIGN_ID,
        storeId: 'other-store',
        status: 'ACTIVE',
      });

      await expect(
        service.endCampaign(USER_ID, STORE_ID, CAMPAIGN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('restores original prices and marks the campaign ENDED', async () => {
      const result = await service.endCampaign(USER_ID, STORE_ID, CAMPAIGN_ID);

      expect(result.status).toBe('ENDED');
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { priceInCents: 100_000, comparePriceInCents: null },
      });
      expect(mockPrisma.saleCampaign.update).toHaveBeenCalledWith({
        where: { id: CAMPAIGN_ID },
        data: { status: 'ENDED', endedAt: expect.any(Date) },
      });
    });

    it('leaves hand-edited prices alone when restoring', async () => {
      mockPrisma.saleCampaignProduct.findMany.mockResolvedValue([
        {
          productId: 'prod-1',
          originalPriceInCents: 100_000,
          originalComparePriceInCents: null,
          salePriceInCents: 80_000,
          originalVariantPrices: null,
          // Merchant changed the price mid-sale — 75k ≠ salePrice 80k.
          product: { id: 'prod-1', priceInCents: 75_000 },
        },
      ]);

      await service.endCampaign(USER_ID, STORE_ID, CAMPAIGN_ID);

      expect(mockPrisma.product.update).not.toHaveBeenCalled();
      // Campaign still ends.
      expect(mockPrisma.saleCampaign.update).toHaveBeenCalled();
    });

    it('rejects double-ending', async () => {
      mockPrisma.saleCampaign.findUnique.mockResolvedValue({
        id: CAMPAIGN_ID,
        storeId: STORE_ID,
        status: 'ENDED',
      });

      await expect(
        service.endCampaign(USER_ID, STORE_ID, CAMPAIGN_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sweepExpired', () => {
    it('auto-ends expired campaigns', async () => {
      mockPrisma.saleCampaign.findMany.mockResolvedValue([
        { id: CAMPAIGN_ID, name: 'Winter Sale' },
      ]);
      mockPrisma.saleCampaignProduct.findMany.mockResolvedValue([]);

      await service.sweepExpired();

      expect(mockPrisma.saleCampaign.update).toHaveBeenCalledWith({
        where: { id: CAMPAIGN_ID },
        data: { status: 'ENDED', endedAt: expect.any(Date) },
      });
    });

    it('does nothing when no campaigns expired', async () => {
      mockPrisma.saleCampaign.findMany.mockResolvedValue([]);

      await service.sweepExpired();

      expect(mockPrisma.saleCampaign.update).not.toHaveBeenCalled();
    });
  });
});
