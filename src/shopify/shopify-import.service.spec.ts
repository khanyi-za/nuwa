import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GenderType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyImportService } from './shopify-import.service';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyRehostService } from './shopify-rehost.service';
// The REAL writer runs in this spec (with mocked prisma/rehost) so the
// end-to-end write assertions keep exercising the code the import runs.
import { ShopifyProductWriterService } from './shopify-product-writer.service';
import { ShopifyWebhookRegistrationService } from './shopify-webhook-registration.service';
import type { ImportCatalogue, ImportProduct } from './mapping/import-types';

const USER_ID = 'user-1';
const JOB_ID = 'job-1';
const CDN = 'https://res.cloudinary.com/yiiva-dev/hosted.jpg';

const mockPrisma = {
  shopifyImportJob: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  shopifyConnection: { update: jest.fn() },
  store: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  storeCollection: { findMany: jest.fn(), create: jest.fn() },
  storeBannerMedia: { count: jest.fn(), create: jest.fn() },
  product: { findMany: jest.fn(), create: jest.fn() },
  productVariant: { findMany: jest.fn() },
  productImage: { findMany: jest.fn() },
  productCollection: { create: jest.fn() },
  productCategory: { create: jest.fn() },
  category: { findMany: jest.fn() },
  tag: { upsert: jest.fn() },
  productTag: { create: jest.fn() },
  shopifyProductLink: { createMany: jest.fn() },
};
const mockClient = {
  fetchShopInfo: jest.fn(),
  fetchShopLogoUrl: jest.fn(),
  fetchRefundPolicyText: jest.fn().mockResolvedValue(null),
};
const mockConnections = { getActiveWithToken: jest.fn() };
const mockCatalogue = { getImportCatalogue: jest.fn() };
const mockRehost = { rehostImage: jest.fn() };
const mockRegistration = {
  registerForConnection: jest.fn(),
  unregisterForConnection: jest.fn(),
};

const connection = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  accessToken: 'shpat_abcdef0123456789',
  currencyCode: 'ZAR',
  storeId: null,
};

const shopInfo = {
  name: 'FIELDS',
  email: 'owner@fields.co.za',
  currencyCode: 'ZAR',
  myshopifyDomain: 'fieldsstore.myshopify.com',
  primaryDomain: 'fieldsstore.co.za',
  productsCount: 3,
};

const jobRow = {
  id: JOB_ID,
  status: 'PENDING',
  summary: null,
  error: null,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-07-22T12:00:00Z'),
};

function makeCatalogue(): ImportCatalogue {
  const img = (n: number) => ({
    sourceUrl: `https://cdn.shopify.com/p${n}.jpg`,
    altText: null,
    sortOrder: 0,
    isPrimary: true,
  });
  const bare: ImportProduct = {
    sourceGid: 'gid://shopify/Product/100',
    sourceId: '100',
    title: 'Mohair Scarf',
    slug: 'mohair-scarf',
    sku: 'SC-1',
    description: 'Warm',
    genderType: GenderType.UNISEX,
    genderSource: 'default',
    priceInCents: 89900,
    comparePriceInCents: null,
    weightInGrams: 450,
    isBare: true,
    totalStock: 5,
    stockTracked: true,
    bareVariant: {
      sourceGid: 'gid://shopify/ProductVariant/1001',
      sourceId: '1001',
      inventoryItemId: '5001',
    },
    variants: [],
    images: [img(1)],
    suggestedCategorySlug: 'accessories',
    tags: ['winter'],
    collectionSlugs: ['new-in'],
  };
  const withVariants: ImportProduct = {
    ...bare,
    sourceGid: 'gid://shopify/Product/200',
    sourceId: '200',
    title: 'Wrap Dress',
    slug: 'wrap-dress',
    sku: null,
    genderType: GenderType.WOMEN,
    genderSource: 'tag',
    priceInCents: 120000,
    isBare: false,
    totalStock: 0,
    bareVariant: null,
    variants: [
      {
        sourceGid: 'gid://shopify/ProductVariant/21',
        sourceId: '21',
        inventoryItemId: '5021',
        name: 'Black / S',
        sku: 'WD-1',
        color: 'Black',
        size: 'S',
        material: null,
        // Same asset as the product image (query param varies) — the writer
        // must snapshot the REHOSTED url onto the variant.
        imageSourceUrl: 'https://cdn.shopify.com/p2.jpg?v=99',
        priceInCents: null,
        stock: 3,
        stockTracked: true,
        sortOrder: 1,
      },
      {
        sourceGid: 'gid://shopify/ProductVariant/22',
        sourceId: '22',
        inventoryItemId: '5022',
        name: 'Black / M',
        sku: 'WD-1', // duplicate SKU within the store — must dedupe to null
        color: 'Black',
        size: 'M',
        material: null,
        imageSourceUrl: null, // no assigned image → variant.imageUrl null
        priceInCents: 135000,
        stock: 2,
        stockTracked: true,
        sortOrder: 2,
      },
    ],
    images: [img(2)],
    suggestedCategorySlug: 'dresses', // not seeded in the category map below
    collectionSlugs: [],
  };
  const noImages: ImportProduct = {
    ...bare,
    sourceGid: 'gid://shopify/Product/300',
    sourceId: '300',
    title: 'Gift Voucher',
    slug: 'gift-voucher',
    sku: null,
    images: [],
    suggestedCategorySlug: null,
    tags: [],
    collectionSlugs: [],
  };
  return {
    products: [bare, withVariants, noImages],
    collections: [
      {
        sourceGid: 'gid://shopify/Collection/1',
        name: 'New In',
        slug: 'new-in',
        description: null,
        imageSourceUrl: 'https://cdn.shopify.com/c.jpg',
        productSlugs: ['mohair-scarf'],
        sortOrder: 0,
      },
    ],
    locations: [],
  };
}

function wireHappyDefaults() {
  mockConnections.getActiveWithToken.mockResolvedValue(connection);
  mockClient.fetchShopInfo.mockResolvedValue(shopInfo);
  mockClient.fetchShopLogoUrl.mockResolvedValue(null);
  mockCatalogue.getImportCatalogue.mockResolvedValue(makeCatalogue());
  mockRehost.rehostImage.mockResolvedValue(CDN);

  mockPrisma.shopifyImportJob.findFirst.mockResolvedValue(null);
  mockPrisma.shopifyImportJob.create.mockResolvedValue(jobRow);
  mockPrisma.shopifyImportJob.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.shopifyImportJob.update.mockResolvedValue({});
  mockPrisma.shopifyConnection.update.mockResolvedValue({});
  mockPrisma.store.findUnique.mockResolvedValue(null);
  mockPrisma.store.findFirst.mockResolvedValue(null);
  mockPrisma.store.create.mockResolvedValue({ id: 'store-1', slug: 'fields' });
  mockPrisma.store.update.mockResolvedValue({});
  mockPrisma.storeCollection.findMany.mockResolvedValue([]);
  mockPrisma.storeCollection.create.mockResolvedValue({ id: 'coll-1' });
  mockPrisma.storeBannerMedia.count.mockResolvedValue(0);
  mockPrisma.storeBannerMedia.create.mockResolvedValue({});
  mockPrisma.product.findMany.mockResolvedValue([]);
  mockPrisma.productVariant.findMany.mockResolvedValue([]);
  mockPrisma.product.create.mockResolvedValue({
    id: 'prod-1',
    variants: [
      { id: 'var-1', sortOrder: 1 },
      { id: 'var-2', sortOrder: 2 },
    ],
  });
  mockPrisma.shopifyProductLink.createMany.mockResolvedValue({ count: 1 });
  mockRegistration.registerForConnection.mockResolvedValue({
    registered: true,
    created: 4,
  });
  mockPrisma.productImage.findMany.mockResolvedValue([
    { url: CDN },
    { url: CDN },
  ]);
  mockPrisma.productCollection.create.mockResolvedValue({});
  mockPrisma.productCategory.create.mockResolvedValue({});
  mockPrisma.category.findMany.mockResolvedValue([
    { id: 'cat-1', slug: 'accessories' },
  ]);
  mockPrisma.tag.upsert.mockResolvedValue({ id: 'tag-1' });
  mockPrisma.productTag.create.mockResolvedValue({});
}

/** The summary object recorded on the FINAL job update. */
function finalSummary() {
  const calls = mockPrisma.shopifyImportJob.update.mock.calls;
  return calls[calls.length - 1][0].data.summary;
}

describe('ShopifyImportService', () => {
  let service: ShopifyImportService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyImportService,
        ShopifyProductWriterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyClient, useValue: mockClient },
        { provide: ShopifyConnectionService, useValue: mockConnections },
        { provide: ShopifyCatalogueService, useValue: mockCatalogue },
        { provide: ShopifyRehostService, useValue: mockRehost },
        {
          provide: ShopifyWebhookRegistrationService,
          useValue: mockRegistration,
        },
      ],
    }).compile();
    service = module.get(ShopifyImportService);
    jest.clearAllMocks();
    wireHappyDefaults();
  });

  describe('startImport', () => {
    beforeEach(() => {
      jest.spyOn(service, 'runImport').mockResolvedValue(undefined);
    });

    it('refuses non-ZAR shops with SHOP_CURRENCY_UNSUPPORTED', async () => {
      mockClient.fetchShopInfo.mockResolvedValue({
        ...shopInfo,
        currencyCode: 'USD',
      });
      await expect(service.startImport(USER_ID, {})).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.shopifyImportJob.create).not.toHaveBeenCalled();
    });

    it('409s when a job is already PENDING/RUNNING', async () => {
      mockPrisma.shopifyImportJob.findFirst.mockResolvedValue({ id: 'job-0' });
      await expect(service.startImport(USER_ID, {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s early when the shop name clashes with an existing store', async () => {
      mockPrisma.store.findFirst.mockResolvedValue({ id: 'other-store' });
      await expect(service.startImport(USER_ID, {})).rejects.toThrow(
        /already exists/,
      );
      expect(mockPrisma.shopifyImportJob.create).not.toHaveBeenCalled();
    });

    it('skips the name-clash check when the user already has a store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: 'store-1' });
      mockPrisma.store.findFirst.mockResolvedValue({ id: 'other-store' });

      const view = await service.startImport(USER_ID, {});

      expect(view).toMatchObject({ id: JOB_ID, status: 'PENDING' });
    });

    it('creates the job and fires the executor', async () => {
      const view = await service.startImport(USER_ID, {
        defaultGenderType: GenderType.WOMEN,
      });

      expect(view).toMatchObject({ id: JOB_ID, status: 'PENDING' });
      expect(service.runImport).toHaveBeenCalledWith(
        JOB_ID,
        USER_ID,
        GenderType.WOMEN,
      );
    });
  });

  describe('runImport', () => {
    it('claims the job via CAS — a non-PENDING job is a no-op', async () => {
      mockPrisma.shopifyImportJob.updateMany.mockResolvedValue({ count: 0 });

      await service.runImport(JOB_ID, USER_ID);

      expect(mockCatalogue.getImportCatalogue).not.toHaveBeenCalled();
    });

    it('creates a DRAFT store from the shop identity when the user has none', async () => {
      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.store.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ownerId: USER_ID,
          companyName: 'FIELDS',
          displayName: 'FIELDS',
          slug: 'fields',
          contactEmail: 'owner@fields.co.za',
          websiteUrl: 'https://fieldsstore.co.za',
          status: 'DRAFT',
        }),
        select: { id: true, slug: true },
      });
      expect(mockPrisma.shopifyConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { storeId: 'store-1', primaryLocationId: null }, // no locations in fixture
      });
    });

    it('imports into the EXISTING store without creating one', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 'store-9',
        slug: 'existing',
      });

      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.store.create).not.toHaveBeenCalled();
      expect(mockPrisma.shopifyConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { storeId: 'store-9', primaryLocationId: null },
      });
      expect(finalSummary()).toMatchObject({ storeCreated: false });
    });

    it('records the first ACTIVE location and fires webhook registration', async () => {
      const cat = makeCatalogue();
      cat.locations = [
        {
          sourceGid: 'gid://shopify/Location/77',
          name: 'Closed',
          isActive: false,
        },
        {
          sourceGid: 'gid://shopify/Location/88',
          name: 'Studio',
          isActive: true,
        },
      ];
      mockCatalogue.getImportCatalogue.mockResolvedValue(cat);

      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.shopifyConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { storeId: 'store-1', primaryLocationId: '88' },
      });
      expect(mockRegistration.registerForConnection).toHaveBeenCalledWith(
        'conn-1',
      );
    });

    it('writes sync link rows for bare and variant products', async () => {
      await service.runImport(JOB_ID, USER_ID);

      const linkCalls = mockPrisma.shopifyProductLink.createMany.mock.calls;
      // Bare product: one row, variantId null, ids from bareVariant.
      expect(linkCalls[0][0].data).toEqual([
        {
          connectionId: 'conn-1',
          productId: 'prod-1',
          variantId: null,
          shopifyProductId: '100',
          shopifyVariantId: '1001',
          inventoryItemId: '5001',
        },
      ]);
      // Variant product: one row per created variant, matched by sortOrder.
      expect(linkCalls[1][0].data).toEqual([
        expect.objectContaining({
          variantId: 'var-1',
          shopifyProductId: '200',
          shopifyVariantId: '21',
          inventoryItemId: '5021',
        }),
        expect.objectContaining({
          variantId: 'var-2',
          shopifyVariantId: '22',
          inventoryItemId: '5022',
        }),
      ]);
    });

    it('rehosts the shop logo onto a newly created store when available', async () => {
      mockClient.fetchShopLogoUrl.mockResolvedValue(
        'https://cdn.shopify.com/logo.png',
      );

      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: { logoUrl: CDN },
      });
    });

    it('writes products ACTIVE with real stock, rehosted images, namespaced deduped SKUs', async () => {
      await service.runImport(JOB_ID, USER_ID);

      // Two displayable products; the image-less gift voucher is skipped.
      expect(mockPrisma.product.create).toHaveBeenCalledTimes(2);

      const bareCall = mockPrisma.product.create.mock.calls[0][0].data;
      expect(bareCall).toMatchObject({
        storeId: 'store-1',
        title: 'Mohair Scarf',
        slug: 'mohair-scarf',
        sku: 'SC-1', // bare SKU kept raw — Product.sku has no unique constraint
        status: 'ACTIVE',
        totalStock: 5,
        genderType: GenderType.UNISEX,
      });
      expect(bareCall.variants).toBeUndefined();
      expect(bareCall.images.create).toEqual([
        { url: CDN, altText: null, sortOrder: 0, isPrimary: true },
      ]);
      expect(bareCall.publishedAt).toBeInstanceOf(Date);

      const variantCall = mockPrisma.product.create.mock.calls[1][0].data;
      expect(variantCall.totalStock).toBe(0);
      expect(variantCall.variants.create).toEqual([
        // Variant image snapshots the REHOSTED url (query-stripped source
        // match against the product image), null when no image assigned.
        expect.objectContaining({ sku: 'fields-WD-1', stock: 3, imageUrl: CDN }),
        expect.objectContaining({ sku: null, stock: 2, imageUrl: null }), // in-store dupe nulled
      ]);
    });

    it('links collections and only EXISTING platform categories', async () => {
      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.storeCollection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: 'store-1',
          slug: 'new-in',
          imageUrl: CDN,
        }),
        select: { id: true },
      });
      expect(mockPrisma.productCollection.create).toHaveBeenCalledWith({
        data: { productId: 'prod-1', collectionId: 'coll-1' },
      });
      // 'accessories' exists → linked once; 'dresses' isn't seeded → no link.
      expect(mockPrisma.productCategory.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.productCategory.create).toHaveBeenCalledWith({
        data: { productId: 'prod-1', categoryId: 'cat-1' },
      });
    });

    it('skips products whose slug already exists in the store (re-run safety)', async () => {
      mockPrisma.product.findMany.mockResolvedValue([{ slug: 'mohair-scarf' }]);

      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.product.create).toHaveBeenCalledTimes(1); // only wrap-dress
      expect(finalSummary()).toMatchObject({
        productsSkippedExisting: 1,
        productsImported: 1,
      });
    });

    it('skips a product when every image upload fails (must stay displayable)', async () => {
      mockRehost.rehostImage.mockResolvedValue(null);

      await service.runImport(JOB_ID, USER_ID);

      expect(mockPrisma.product.create).not.toHaveBeenCalled();
      expect(finalSummary()).toMatchObject({
        productsSkippedNoImage: 3, // 1 born image-less + 2 all-uploads-failed
        productsImported: 0,
      });
    });

    it('counts a per-product failure and continues (never fatal)', async () => {
      mockPrisma.product.create
        .mockRejectedValueOnce(new Error('unique violation'))
        .mockResolvedValue({ id: 'prod-2' });

      await service.runImport(JOB_ID, USER_ID);

      expect(finalSummary()).toMatchObject({
        productsFailed: 1,
        productsImported: 1,
      });
      const finalCall =
        mockPrisma.shopifyImportJob.update.mock.calls.at(-1)?.[0];
      expect(finalCall.data.status).toBe('COMPLETED');
    });

    it('applies defaultGenderType ONLY to gender-silent products', async () => {
      await service.runImport(JOB_ID, USER_ID, GenderType.MEN);

      const bareCall = mockPrisma.product.create.mock.calls[0][0].data;
      const variantCall = mockPrisma.product.create.mock.calls[1][0].data;
      expect(bareCall.genderType).toBe(GenderType.MEN); // source was 'default'
      expect(variantCall.genderType).toBe(GenderType.WOMEN); // inferred — kept
    });

    it('seeds a starter banner only for a store the import created', async () => {
      await service.runImport(JOB_ID, USER_ID);
      expect(mockPrisma.storeBannerMedia.create).toHaveBeenCalledTimes(2);
      expect(
        mockPrisma.storeBannerMedia.create.mock.calls[0][0].data,
      ).toMatchObject({ storeId: 'store-1', sortOrder: 0, isPrimary: true });

      jest.clearAllMocks();
      wireHappyDefaults();
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 'store-9',
        slug: 'existing',
      });
      await service.runImport(JOB_ID, USER_ID);
      expect(mockPrisma.storeBannerMedia.create).not.toHaveBeenCalled();
    });

    it('records the final summary with full counts on COMPLETED', async () => {
      await service.runImport(JOB_ID, USER_ID);

      expect(finalSummary()).toMatchObject({
        phase: 'DONE',
        totalProducts: 3,
        productsImported: 2,
        productsSkippedNoImage: 1,
        variantsImported: 2,
        collectionsCreated: 1,
        storeCreated: true,
      });
      const finalCall =
        mockPrisma.shopifyImportJob.update.mock.calls.at(-1)?.[0];
      expect(finalCall.data.status).toBe('COMPLETED');
      expect(finalCall.data.finishedAt).toBeInstanceOf(Date);
    });

    it('marks the job FAILED with the error when the pull dies', async () => {
      mockCatalogue.getImportCatalogue.mockRejectedValue(
        new Error('Shopify unreachable'),
      );

      await service.runImport(JOB_ID, USER_ID);

      const finalCall =
        mockPrisma.shopifyImportJob.update.mock.calls.at(-1)?.[0];
      expect(finalCall.data.status).toBe('FAILED');
      expect(finalCall.data.error).toBe('Shopify unreachable');
    });
  });

  describe('getLatest / getById', () => {
    it('getLatest 404s when no job exists', async () => {
      mockPrisma.shopifyImportJob.findFirst.mockResolvedValue(null);
      await expect(service.getLatest(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("getById 404s on someone else's job (404-not-403)", async () => {
      mockPrisma.shopifyImportJob.findUnique.mockResolvedValue({
        ...jobRow,
        connection: { userId: 'someone-else' },
      });
      await expect(service.getById(USER_ID, JOB_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getById returns the owned job view', async () => {
      mockPrisma.shopifyImportJob.findUnique.mockResolvedValue({
        ...jobRow,
        status: 'COMPLETED',
        connection: { userId: USER_ID },
      });
      const view = await service.getById(USER_ID, JOB_ID);
      expect(view).toMatchObject({ id: JOB_ID, status: 'COMPLETED' });
    });
  });
});
