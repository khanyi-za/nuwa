import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import type { GqlProductNode, GqlVariantNode } from './shopify-catalogue-types';

const SHOP = 'fieldsstore.myshopify.com';
const TOKEN = 'shpat_abcdef0123456789';

const mockClient = { graphql: jest.fn(), fetchShopInfo: jest.fn() };
const mockConnections = { getActiveWithToken: jest.fn() };

const noMore = { hasNextPage: false, endCursor: null };

function variant(id: string, extra: Partial<GqlVariantNode> = {}): GqlVariantNode {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    title: 'Default Title',
    sku: null,
    position: 1,
    price: '500.00',
    compareAtPrice: null,
    inventoryQuantity: 4,
    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
    inventoryItem: { tracked: true, measurement: null },
    ...extra,
  };
}

function product(id: string, extra: Partial<GqlProductNode> = {}): GqlProductNode {
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
    variants: { pageInfo: noMore, nodes: [variant(`${id}0`)] },
    media: {
      pageInfo: noMore,
      nodes: [
        {
          mediaContentType: 'IMAGE',
          image: { url: `https://cdn.shopify.com/${id}.jpg`, altText: null },
        },
      ],
    },
    ...extra,
  };
}

/**
 * Dispatch-style graphql mock: route by operation name + variables so the
 * pagination loops exercise real cursor plumbing.
 */
function wireHappyCatalogue() {
  mockClient.graphql.mockImplementation(
    (_shop: string, _token: string, query: string, vars?: { cursor?: string | null; id?: string }) => {
      if (query.includes('query CataloguePage')) {
        if (!vars?.cursor) {
          return Promise.resolve({
            products: {
              pageInfo: { hasNextPage: true, endCursor: 'p1' },
              nodes: [product('100')],
            },
          });
        }
        return Promise.resolve({
          products: {
            pageInfo: noMore,
            nodes: [
              product('200', {
                variants: {
                  pageInfo: { hasNextPage: true, endCursor: 'v1' },
                  nodes: [variant('2001', { title: 'S' })],
                },
              }),
            ],
          },
        });
      }
      if (query.includes('query VariantsPage')) {
        expect(vars).toEqual({ id: 'gid://shopify/Product/200', cursor: 'v1' });
        return Promise.resolve({
          product: {
            variants: {
              pageInfo: noMore,
              nodes: [variant('2002', { title: 'M' })],
            },
          },
        });
      }
      if (query.includes('query CollectionsPage')) {
        return Promise.resolve({
          collections: {
            pageInfo: noMore,
            nodes: [
              {
                id: 'gid://shopify/Collection/1',
                handle: 'all',
                title: 'All',
                descriptionHtml: null,
                image: null,
                products: {
                  pageInfo: { hasNextPage: true, endCursor: 'c1' },
                  nodes: [{ id: 'gid://shopify/Product/100' }],
                },
              },
            ],
          },
        });
      }
      if (query.includes('query CollectionProductsPage')) {
        expect(vars).toEqual({ id: 'gid://shopify/Collection/1', cursor: 'c1' });
        return Promise.resolve({
          collection: {
            products: {
              pageInfo: noMore,
              nodes: [{ id: 'gid://shopify/Product/200' }],
            },
          },
        });
      }
      if (query.includes('query Locations')) {
        return Promise.resolve({
          locations: {
            nodes: [
              { id: 'gid://shopify/Location/1', name: 'Studio', isActive: true },
            ],
          },
        });
      }
      return Promise.reject(new Error(`Unexpected query: ${query.slice(0, 60)}`));
    },
  );
}

describe('ShopifyCatalogueService', () => {
  let service: ShopifyCatalogueService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyCatalogueService,
        { provide: ShopifyClient, useValue: mockClient },
        { provide: ShopifyConnectionService, useValue: mockConnections },
      ],
    }).compile();
    service = module.get(ShopifyCatalogueService);
    jest.clearAllMocks();
  });

  describe('pull', () => {
    it('pages products, merges nested continuations, resolves membership', async () => {
      wireHappyCatalogue();

      const raw = await service.pull(SHOP, TOKEN);

      expect(raw.products).toHaveLength(2);
      expect(raw.products[0].handle).toBe('product-100');
      // Product 200's variants: first-page node + continuation node, merged.
      expect(raw.products[1].variants.map((v) => v.title)).toEqual(['S', 'M']);
      // Collection membership: inline page + continuation page, merged.
      expect(raw.collections[0].productIds).toEqual([
        'gid://shopify/Product/100',
        'gid://shopify/Product/200',
      ]);
      expect(raw.locations).toEqual([
        { id: 'gid://shopify/Location/1', name: 'Studio', isActive: true },
      ]);
    });

    it('only pulls ACTIVE products (status filter baked into the query)', async () => {
      wireHappyCatalogue();
      await service.pull(SHOP, TOKEN);

      const productsCall = mockClient.graphql.mock.calls.find(([, , q]) =>
        (q as string).includes('query CataloguePage'),
      );
      expect(productsCall?.[2]).toContain('query: "status:active"');
    });

    it('drops non-image media instead of producing empty image rows', async () => {
      wireHappyCatalogue();
      mockClient.graphql.mockImplementationOnce(() =>
        Promise.resolve({
          products: {
            pageInfo: noMore,
            nodes: [
              product('100', {
                media: {
                  pageInfo: noMore,
                  nodes: [
                    { mediaContentType: 'VIDEO' }, // no image field
                    {
                      mediaContentType: 'IMAGE',
                      image: {
                        url: 'https://cdn.shopify.com/real.jpg',
                        altText: 'Real',
                      },
                    },
                  ],
                },
              }),
            ],
          },
        }),
      );

      const raw = await service.pull(SHOP, TOKEN);
      expect(raw.products[0].images).toEqual([
        { url: 'https://cdn.shopify.com/real.jpg', altText: 'Real' },
      ]);
    });

    it('degrades locations to [] when the scope is missing', async () => {
      wireHappyCatalogue();
      mockClient.graphql.mockImplementation(
        (_s: string, _t: string, query: string) => {
          if (query.includes('query Locations')) {
            return Promise.reject(new Error('ACCESS_DENIED'));
          }
          if (query.includes('query CataloguePage')) {
            return Promise.resolve({
              products: { pageInfo: noMore, nodes: [] },
            });
          }
          return Promise.resolve({
            collections: { pageInfo: noMore, nodes: [] },
          });
        },
      );

      const raw = await service.pull(SHOP, TOKEN);
      expect(raw.locations).toEqual([]);
    });
  });

  describe('previewForUser', () => {
    beforeEach(() => {
      mockConnections.getActiveWithToken.mockResolvedValue({
        id: 'conn-1',
        shopDomain: SHOP,
        accessToken: TOKEN,
        currencyCode: 'ZAR',
        storeId: null,
      });
      mockClient.fetchShopInfo.mockResolvedValue({
        name: 'FIELDS',
        email: null,
        currencyCode: 'ZAR',
        myshopifyDomain: SHOP,
        primaryDomain: null,
        productsCount: 2,
      });
    });

    it('propagates 404 when no shop is connected', async () => {
      mockConnections.getActiveWithToken.mockRejectedValue(
        new NotFoundException(),
      );
      await expect(service.previewForUser('user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses non-ZAR shops BEFORE pulling anything', async () => {
      mockClient.fetchShopInfo.mockResolvedValue({
        name: 'US Shop',
        email: null,
        currencyCode: 'USD',
        myshopifyDomain: SHOP,
        primaryDomain: null,
        productsCount: 9,
      });

      await expect(service.previewForUser('user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockClient.graphql).not.toHaveBeenCalled();
    });

    it('returns shop identity, summary, warnings, and a sample', async () => {
      wireHappyCatalogue();

      const preview = await service.previewForUser('user-1');

      expect(preview.shop).toEqual({
        name: 'FIELDS',
        domain: SHOP,
        currencyCode: 'ZAR',
      });
      expect(preview.counts).toMatchObject({
        products: 2,
        collections: 1,
        locations: 1,
      });
      expect(preview.warnings).toBeDefined();
      expect(preview.sample).toHaveLength(2);
      expect(preview.sample[0]).toEqual({
        title: 'Product 100',
        priceInCents: 50000,
        genderType: 'UNISEX',
        suggestedCategorySlug: null,
        imageCount: 1,
        variantCount: 0, // bare product
        stock: 4,
      });
    });
  });
});
