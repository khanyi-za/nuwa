import { GenderType } from '@prisma/client';
import {
  mapCatalogue,
  productStock,
  summarizeCatalogue,
} from './catalogue-mapper';
import { UNTRACKED_STOCK } from './heuristics';
import type {
  GqlVariantNode,
  RawCatalogue,
  RawProduct,
} from '../shopify-catalogue-types';

const trackedItem = (grams: number | null = 450) => ({
  id: 'gid://shopify/InventoryItem/9001',
  tracked: true,
  measurement: grams ? { weight: { unit: 'GRAMS', value: grams } } : null,
});

const baseVariant: GqlVariantNode = {
  id: 'gid://shopify/ProductVariant/1',
  legacyResourceId: '1',
  title: 'Default Title',
  sku: null,
  position: 1,
  price: '899.00',
  compareAtPrice: null,
  inventoryQuantity: 5,
  selectedOptions: [{ name: 'Title', value: 'Default Title' }],
  inventoryItem: trackedItem(),
};

const bareProduct: RawProduct = {
  id: 'gid://shopify/Product/100',
  legacyResourceId: '100',
  title: 'Mohair Scarf',
  handle: 'mohair-scarf',
  descriptionHtml: '<p>Hand-loomed &amp; warm</p>',
  vendor: 'FIELDS',
  productType: '',
  tags: ['accessories'],
  options: [{ name: 'Title', position: 1 }],
  variants: [baseVariant],
  images: [
    { url: 'https://cdn.shopify.com/scarf-1.jpg', altText: null },
    { url: 'https://cdn.shopify.com/scarf-2.jpg', altText: 'Detail' },
  ],
};

const variantProduct: RawProduct = {
  id: 'gid://shopify/Product/200',
  legacyResourceId: '200',
  title: 'Womens Wrap Dress',
  handle: 'wrap-dress',
  descriptionHtml: null,
  vendor: 'FIELDS',
  productType: 'Dresses',
  tags: ['women'],
  options: [
    { name: 'Colour', position: 1 },
    { name: 'Size', position: 2 },
  ],
  variants: [
    {
      ...baseVariant,
      id: 'gid://shopify/ProductVariant/21',
      legacyResourceId: '21',
      title: 'Black / S',
      sku: 'WD-BLK-S',
      position: 1,
      price: '1200.00',
      compareAtPrice: '1500.00',
      inventoryQuantity: 3,
      selectedOptions: [
        { name: 'Colour', value: 'Black' },
        { name: 'Size', value: 'S' },
      ],
    },
    {
      ...baseVariant,
      id: 'gid://shopify/ProductVariant/22',
      legacyResourceId: '22',
      title: 'Black / M',
      sku: 'WD-BLK-M',
      position: 2,
      price: '1350.00',
      compareAtPrice: null,
      inventoryQuantity: -2, // oversold on Shopify's side
      selectedOptions: [
        { name: 'Colour', value: 'Black' },
        { name: 'Size', value: 'M' },
      ],
    },
  ],
  images: [{ url: 'https://cdn.shopify.com/dress.jpg', altText: null }],
};

const rawCatalogue: RawCatalogue = {
  products: [bareProduct, variantProduct],
  collections: [
    {
      id: 'gid://shopify/Collection/1',
      handle: 'new-in',
      title: 'New In',
      descriptionHtml: '<p>Latest drop</p>',
      imageUrl: 'https://cdn.shopify.com/new-in.jpg',
      productIds: [
        'gid://shopify/Product/100',
        'gid://shopify/Product/200',
        'gid://shopify/Product/999', // not in the pulled set (draft/archived)
      ],
    },
  ],
  locations: [{ id: 'gid://shopify/Location/1', name: 'Studio', isActive: true }],
};

describe('catalogue-mapper', () => {
  describe('mapCatalogue', () => {
    const mapped = mapCatalogue(rawCatalogue);
    const [scarf, dress] = mapped.products;

    it('detects bare products (Title-only options) and uses product-level stock', () => {
      expect(scarf.isBare).toBe(true);
      expect(scarf.variants).toEqual([]);
      expect(scarf.totalStock).toBe(5);
      expect(scarf.stockTracked).toBe(true);
    });

    it('maps prices: min variant price, override only when different', () => {
      expect(dress.priceInCents).toBe(120000);
      expect(dress.variants[0].priceInCents).toBeNull(); // equals product price
      expect(dress.variants[1].priceInCents).toBe(135000);
    });

    it('keeps compareAtPrice only when above the product price', () => {
      expect(dress.comparePriceInCents).toBe(150000);
      expect(scarf.comparePriceInCents).toBeNull();
    });

    it('maps variant selectedOptions to color/size/material by name content', () => {
      expect(dress.variants[0]).toMatchObject({
        name: 'Black / S',
        color: 'Black',
        size: 'S',
        material: null,
        sku: 'WD-BLK-S',
      });
    });

    it('clamps oversold (negative) real stock to 0', () => {
      expect(dress.variants[1].stock).toBe(0);
      expect(dress.variants[0].stock).toBe(3);
    });

    it('infers gender and category with provenance', () => {
      expect(dress.genderType).toBe(GenderType.WOMEN);
      expect(dress.genderSource).toBe('tag');
      expect(dress.suggestedCategorySlug).toBe('dresses');
      expect(scarf.genderType).toBe(GenderType.UNISEX);
      expect(scarf.suggestedCategorySlug).toBe('accessories');
    });

    it('maps images with order, primary flag, and title as alt fallback', () => {
      expect(scarf.images).toEqual([
        {
          sourceUrl: 'https://cdn.shopify.com/scarf-1.jpg',
          altText: 'Mohair Scarf',
          sortOrder: 0,
          isPrimary: true,
        },
        {
          sourceUrl: 'https://cdn.shopify.com/scarf-2.jpg',
          altText: 'Detail',
          sortOrder: 1,
          isPrimary: false,
        },
      ]);
    });

    it('strips HTML from descriptions', () => {
      expect(scarf.description).toBe('Hand-loomed & warm');
      expect(dress.description).toBeNull();
    });

    it('converts variant weight to grams with the 500g fallback', () => {
      expect(scarf.weightInGrams).toBe(450);
    });

    it('resolves collection membership both ways, dropping unknown members', () => {
      expect(scarf.collectionSlugs).toEqual(['new-in']);
      expect(dress.collectionSlugs).toEqual(['new-in']);
      expect(mapped.collections[0]).toMatchObject({
        slug: 'new-in',
        name: 'New In',
        description: 'Latest drop',
        imageSourceUrl: 'https://cdn.shopify.com/new-in.jpg',
        productSlugs: ['mohair-scarf', 'wrap-dress'],
        sortOrder: 0,
      });
    });

    it('carries source ids for webhook correlation (Phase 2 sync)', () => {
      expect(dress.sourceGid).toBe('gid://shopify/Product/200');
      expect(dress.sourceId).toBe('200');
      expect(dress.variants[0].sourceGid).toBe('gid://shopify/ProductVariant/21');
      expect(dress.variants[0].sourceId).toBe('21');
      expect(dress.variants[0].inventoryItemId).toBe('9001'); // numeric from gid
      expect(dress.bareVariant).toBeNull();
      // Bare product: the default variant's identities ride on bareVariant.
      expect(scarf.bareVariant).toEqual({
        sourceGid: 'gid://shopify/ProductVariant/1',
        sourceId: '1',
        inventoryItemId: '9001',
      });
    });

    it('maps locations', () => {
      expect(mapped.locations).toEqual([
        { sourceGid: 'gid://shopify/Location/1', name: 'Studio', isActive: true },
      ]);
    });

    it('substitutes the untracked stand-in and flags it', () => {
      const untracked = mapCatalogue({
        products: [
          {
            ...bareProduct,
            variants: [
              {
                ...baseVariant,
                inventoryQuantity: 0,
                inventoryItem: {
                  id: 'gid://shopify/InventoryItem/9001',
                  tracked: false,
                  measurement: null,
                },
              },
            ],
          },
        ],
        collections: [],
        locations: [],
      }).products[0];

      expect(untracked.totalStock).toBe(UNTRACKED_STOCK);
      expect(untracked.stockTracked).toBe(false);
      expect(untracked.weightInGrams).toBe(500);
    });
  });

  describe('productStock', () => {
    const mapped = mapCatalogue(rawCatalogue);

    it('bare → totalStock; variants → sum', () => {
      expect(productStock(mapped.products[0])).toBe(5);
      expect(productStock(mapped.products[1])).toBe(3); // 3 + clamped 0
    });
  });

  describe('summarizeCatalogue', () => {
    it('aggregates counts, genders, and warnings', () => {
      const noImages: RawProduct = {
        ...bareProduct,
        id: 'gid://shopify/Product/300',
        legacyResourceId: '300',
        title: 'Gift Voucher',
        handle: 'gift-voucher',
        tags: [],
        images: [],
        variants: [{ ...baseVariant, inventoryQuantity: 0 }],
      };
      const summary = summarizeCatalogue(
        mapCatalogue({
          ...rawCatalogue,
          products: [...rawCatalogue.products, noImages],
        }),
      );

      expect(summary.counts).toEqual({
        products: 3,
        variants: 2,
        images: 3,
        collections: 1,
        locations: 1,
      });
      expect(summary.genders).toEqual({ WOMEN: 1, MEN: 0, UNISEX: 2 });
      expect(summary.warnings).toEqual({
        productsWithoutImages: 1,
        productsWithoutCategory: 1, // gift voucher matches no rule
        productsWithUntrackedStock: 0,
        productsOutOfStock: 1,
      });
    });
  });
});
