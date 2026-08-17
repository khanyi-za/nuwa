import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { ShopifyConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyProductWriterService } from './shopify-product-writer.service';
import { ShopifyTokenService } from './shopify-token.service';
import { decryptToken, encryptToken } from './token-crypto';
import type { RawProduct } from './shopify-catalogue-types';

const KEY = randomBytes(32);

const mockPrisma = {
  shopifyProductLink: { findMany: jest.fn(), findFirst: jest.fn() },
  shopifyConnection: { findUnique: jest.fn() },
  product: {
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  productVariant: { update: jest.fn(), findMany: jest.fn() },
  store: { findUnique: jest.fn() },
  category: { findFirst: jest.fn() },
};
const mockCatalogue = { fetchProduct: jest.fn(), pull: jest.fn() };
const mockWriter = { writeProduct: jest.fn(), loadUsedSkus: jest.fn() };

const connection = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  storeId: 'store-1',
  status: 'ACTIVE',
  encryptedToken: encryptToken('shpat_abcdef0123456789', KEY),
  primaryLocationId: '88',
} as unknown as ShopifyConnection;

const bareLink = {
  id: 'link-1',
  connectionId: 'conn-1',
  productId: 'prod-1',
  variantId: null,
  shopifyProductId: '100',
  shopifyVariantId: '1001',
  inventoryItemId: '5001',
};
const variantLinks = [
  {
    id: 'link-2',
    connectionId: 'conn-1',
    productId: 'prod-2',
    variantId: 'var-1',
    shopifyProductId: '200',
    shopifyVariantId: '21',
    inventoryItemId: '5021',
  },
  {
    id: 'link-3',
    connectionId: 'conn-1',
    productId: 'prod-2',
    variantId: 'var-2',
    shopifyProductId: '200',
    shopifyVariantId: '22',
    inventoryItemId: '5022',
  },
];

describe('ShopifySyncService', () => {
  let service: ShopifySyncService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifySyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: { tokenKey: KEY } },
        { provide: ShopifyCatalogueService, useValue: mockCatalogue },
        { provide: ShopifyProductWriterService, useValue: mockWriter },
        {
          provide: ShopifyTokenService,
          // Mirrors the legacy path: decrypt the row's stored token.
          useValue: {
            getTokenFor: (c: { encryptedToken: string }) =>
              Promise.resolve(decryptToken(c.encryptedToken, KEY)),
          },
        },
      ],
    }).compile();
    service = module.get(ShopifySyncService);
    jest.clearAllMocks();
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.product.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.productVariant.update.mockResolvedValue({});
    mockWriter.loadUsedSkus.mockResolvedValue(new Set());
    mockWriter.writeProduct.mockResolvedValue('prod-new');
  });

  describe('products/update', () => {
    it('UNKNOWN_PRODUCT when nothing is linked', async () => {
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue([]);
      await expect(
        service.apply(connection, 'products/update', { id: 999 }),
      ).resolves.toBe('UNKNOWN_PRODUCT');
    });

    it('updates a bare product: title/description/status/price/stock', async () => {
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue([bareLink]);

      const outcome = await service.apply(connection, 'products/update', {
        id: 100,
        title: 'New Title',
        body_html: '<p>New &amp; improved</p>',
        status: 'active',
        variants: [
          {
            id: 1001,
            price: '999.00',
            compare_at_price: '1250.00',
            inventory_quantity: 7,
          },
        ],
      });

      expect(outcome).toBe('APPLIED');
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: {
          title: 'New Title',
          description: 'New & improved',
          status: 'ACTIVE',
          priceInCents: 99900,
          comparePriceInCents: 125000,
          totalStock: 7,
        },
      });
    });

    it('maps Shopify draft/archived onto YIIVA statuses', async () => {
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue([bareLink]);

      await service.apply(connection, 'products/update', {
        id: 100,
        status: 'archived',
      });

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { status: 'ARCHIVED' },
      });
    });

    it('updates linked variants (price override + clamped stock), skips unknown ones', async () => {
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue(variantLinks);

      const outcome = await service.apply(connection, 'products/update', {
        id: 200,
        variants: [
          { id: 21, price: '1200.00', inventory_quantity: 5 },
          { id: 22, price: '1350.00', inventory_quantity: -1 },
          { id: 23, price: '1400.00', inventory_quantity: 9 }, // added after import
        ],
      });

      expect(outcome).toBe('APPLIED');
      expect(mockPrisma.productVariant.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: { priceInCents: null, stock: 5 }, // equals min price → override null
      });
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-2' },
        data: { priceInCents: 135000, stock: 0 }, // oversold clamped
      });
    });
  });

  describe('products/delete', () => {
    it('ARCHIVES the linked product (SA-4 — never a hard delete)', async () => {
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue([bareLink]);

      const outcome = await service.apply(connection, 'products/delete', {
        id: 100,
      });

      expect(outcome).toBe('APPLIED');
      expect(mockPrisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['prod-1'] } },
        data: { status: 'ARCHIVED' },
      });
    });
  });

  describe('products/create', () => {
    beforeEach(() => {
      mockPrisma.shopifyProductLink.findFirst.mockResolvedValue(null);
      mockPrisma.store.findUnique.mockResolvedValue({
        id: 'store-1',
        slug: 'fields',
      });
      mockPrisma.product.findFirst.mockResolvedValue(null);
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockCatalogue.fetchProduct.mockResolvedValue(rawProduct('300'));
    });

    it('ALREADY_LINKED when the product was imported before (redelivery)', async () => {
      mockPrisma.shopifyProductLink.findFirst.mockResolvedValue({ id: 'l' });
      await expect(
        service.apply(connection, 'products/create', { id: 100 }),
      ).resolves.toBe('ALREADY_LINKED');
      expect(mockWriter.writeProduct).not.toHaveBeenCalled();
    });

    it('NOT_FOUND when the product vanished before the fetch', async () => {
      mockCatalogue.fetchProduct.mockResolvedValue(null);
      await expect(
        service.apply(connection, 'products/create', { id: 300 }),
      ).resolves.toBe('NOT_FOUND');
    });

    it('SLUG_EXISTS when the store already has that slug', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        service.apply(connection, 'products/create', { id: 300 }),
      ).resolves.toBe('SLUG_EXISTS');
      expect(mockWriter.writeProduct).not.toHaveBeenCalled();
    });

    it('imports the new product through the shared writer', async () => {
      const outcome = await service.apply(connection, 'products/create', {
        id: 300,
      });

      expect(outcome).toBe('APPLIED');
      expect(mockCatalogue.fetchProduct).toHaveBeenCalledWith(
        'fieldsstore.myshopify.com',
        'shpat_abcdef0123456789', // decrypted from the stored token
        '300',
      );
      const [connId, store, mapped] = mockWriter.writeProduct.mock.calls[0];
      expect(connId).toBe('conn-1');
      expect(store).toEqual({ id: 'store-1', slug: 'fields' });
      expect(mapped.slug).toBe('product-300');
    });
  });

  describe('inventory_levels/update', () => {
    it('skips other locations (v1 is primary-location only)', async () => {
      await expect(
        service.apply(connection, 'inventory_levels/update', {
          inventory_item_id: 5021,
          location_id: 99,
          available: 3,
        }),
      ).resolves.toBe('LOCATION_SKIPPED');
    });

    it('sets variant stock from the primary location level', async () => {
      mockPrisma.shopifyProductLink.findFirst.mockResolvedValue(
        variantLinks[0],
      );

      const outcome = await service.apply(connection, 'inventory_levels/update', {
        inventory_item_id: 5021,
        location_id: 88,
        available: 12,
      });

      expect(outcome).toBe('APPLIED');
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({
        where: { id: 'var-1' },
        data: { stock: 12 },
      });
    });

    it('sets bare-product totalStock (clamped at 0)', async () => {
      mockPrisma.shopifyProductLink.findFirst.mockResolvedValue(bareLink);

      await service.apply(connection, 'inventory_levels/update', {
        inventory_item_id: 5001,
        location_id: 88,
        available: -4,
      });

      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { totalStock: 0 },
      });
    });

    it('UNKNOWN_ITEM when no link matches', async () => {
      mockPrisma.shopifyProductLink.findFirst.mockResolvedValue(null);
      await expect(
        service.apply(connection, 'inventory_levels/update', {
          inventory_item_id: 7777,
          location_id: 88,
          available: 5,
        }),
      ).resolves.toBe('UNKNOWN_ITEM');
    });
  });

  it('ignores topics it did not subscribe to', async () => {
    await expect(
      service.apply(connection, 'orders/create', {}),
    ).resolves.toBe('IGNORED_TOPIC');
  });

  describe('reconcileConnection', () => {
    it('repairs stock/price drift and archives products gone from Shopify', async () => {
      mockPrisma.shopifyConnection.findUnique.mockResolvedValue(connection);
      // Shopify now: bare product 100 @ R850 / qty 9. Product 200 is GONE.
      mockCatalogue.pull.mockResolvedValue({
        products: [rawProduct('100', { price: '850.00', quantity: 9 })],
        collections: [],
        locations: [],
      });
      mockPrisma.shopifyProductLink.findMany.mockResolvedValue([
        { ...bareLink, shopifyVariantId: '1000' },
        ...variantLinks,
      ]);
      // DB currently: R899 / stock 5 — both drifted.
      mockPrisma.product.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          priceInCents: 89900,
          comparePriceInCents: null,
          totalStock: 5,
        },
        {
          id: 'prod-2',
          priceInCents: 120000,
          comparePriceInCents: null,
          totalStock: 0,
        },
      ]);
      mockPrisma.productVariant.findMany.mockResolvedValue([]);

      const result = await service.reconcileConnection('conn-1');

      expect(result).toEqual({
        productsChecked: 1,
        stockFixed: 1,
        priceFixed: 1,
        archived: 1,
        unlinked: 0,
      });
      expect(mockPrisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { priceInCents: 85000, totalStock: 9 },
      });
      expect(mockPrisma.product.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['prod-2'] }, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED' },
      });
    });

    it('returns null for disconnected or store-less connections', async () => {
      mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
        ...connection,
        storeId: null,
      });
      await expect(service.reconcileConnection('conn-1')).resolves.toBeNull();
      expect(mockCatalogue.pull).not.toHaveBeenCalled();
    });
  });
});

/** Minimal RawProduct the mapper accepts (bare, one image). */
function rawProduct(
  id: string,
  opts: { price?: string; quantity?: number } = {},
): RawProduct {
  return {
    id: `gid://shopify/Product/${id}`,
    legacyResourceId: id,
    title: `Product ${id}`,
    handle: `product-${id}`,
    descriptionHtml: null,
    vendor: 'FIELDS',
    productType: '',
    tags: [],
    options: [{ name: 'Title', position: 1 }],
    variants: [
      {
        id: `gid://shopify/ProductVariant/${id}0`,
        legacyResourceId: `${id}0`,
        title: 'Default Title',
        sku: null,
        position: 1,
        price: opts.price ?? '500.00',
        compareAtPrice: null,
        inventoryQuantity: opts.quantity ?? 4,
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
        inventoryItem: {
          id: `gid://shopify/InventoryItem/${id}9`,
          tracked: true,
          measurement: null,
        },
      },
    ],
    images: [{ url: `https://cdn.shopify.com/${id}.jpg`, altText: null }],
  };
}
