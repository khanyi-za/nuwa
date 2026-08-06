import { GenderType } from '@prisma/client';
import {
  UNTRACKED_STOCK,
  WEIGHT_FALLBACK_GRAMS,
  inferGender,
  namespaceSku,
  optionField,
  priceToCents,
  slugify,
  stockFromInventory,
  stripHtml,
  stripQuery,
  suggestCategory,
  weightToGrams,
} from './heuristics';

describe('shopify mapping heuristics', () => {
  describe('priceToCents', () => {
    it('converts decimal strings float-safely', () => {
      expect(priceToCents('799.99')).toBe(79999);
      expect(priceToCents('3600.00')).toBe(360000);
      expect(priceToCents('0.10')).toBe(10);
    });

    it('returns null for missing or garbage input', () => {
      expect(priceToCents(null)).toBeNull();
      expect(priceToCents(undefined)).toBeNull();
      expect(priceToCents('')).toBeNull();
      expect(priceToCents('abc')).toBeNull();
    });
  });

  describe('weightToGrams', () => {
    it('converts each Shopify unit to integer grams', () => {
      expect(weightToGrams({ unit: 'GRAMS', value: 450 })).toBe(450);
      expect(weightToGrams({ unit: 'KILOGRAMS', value: 1.2 })).toBe(1200);
      expect(weightToGrams({ unit: 'OUNCES', value: 10 })).toBe(283);
      expect(weightToGrams({ unit: 'POUNDS', value: 1 })).toBe(454);
    });

    it('falls back to 500g when missing, zero, or an unknown unit', () => {
      expect(weightToGrams(null)).toBe(WEIGHT_FALLBACK_GRAMS);
      expect(weightToGrams(undefined)).toBe(WEIGHT_FALLBACK_GRAMS);
      expect(weightToGrams({ unit: 'GRAMS', value: 0 })).toBe(
        WEIGHT_FALLBACK_GRAMS,
      );
      expect(weightToGrams({ unit: 'STONES', value: 2 })).toBe(
        WEIGHT_FALLBACK_GRAMS,
      );
    });
  });

  describe('stockFromInventory', () => {
    it('uses the real tracked quantity', () => {
      expect(stockFromInventory(7, true)).toBe(7);
      expect(stockFromInventory(0, true)).toBe(0);
    });

    it('clamps negative (oversold) quantities to 0', () => {
      expect(stockFromInventory(-3, true)).toBe(0);
    });

    it('treats null tracked quantity as 0', () => {
      expect(stockFromInventory(null, true)).toBe(0);
    });

    it('substitutes the always-available stand-in for untracked inventory', () => {
      expect(stockFromInventory(0, false)).toBe(UNTRACKED_STOCK);
      expect(stockFromInventory(null, false)).toBe(UNTRACKED_STOCK);
    });
  });

  describe('stripHtml', () => {
    it('strips tags, decodes entities, collapses whitespace', () => {
      expect(
        stripHtml('<p>Soft &amp; cosy</p>\n<p>100% cotton&nbsp;fleece</p>'),
      ).toBe('Soft & cosy 100% cotton fleece');
    });

    it('returns null for empty or tag-only input', () => {
      expect(stripHtml(null)).toBeNull();
      expect(stripHtml('')).toBeNull();
      expect(stripHtml('<p> </p>')).toBeNull();
    });
  });

  describe('slugify', () => {
    it('lowercases, strips diacritics, hyphenates', () => {
      expect(slugify('Tolʼthema Négligée Set')).toBe('tol-thema-negligee-set');
    });

    it('caps length at 80', () => {
      expect(slugify('x'.repeat(200)).length).toBe(80);
    });
  });

  describe('inferGender', () => {
    it('prefers tags over type over title', () => {
      expect(
        inferGender({ tags: ['womens'], productType: 'Mens', title: 'Tee' }),
      ).toEqual({ gender: GenderType.WOMEN, source: 'tag' });
      expect(
        inferGender({ tags: [], productType: 'Menswear', title: 'Dress?' }),
      ).toEqual({ gender: GenderType.MEN, source: 'type' });
      expect(
        inferGender({ tags: [], productType: '', title: 'Ladies Blouse' }),
      ).toEqual({ gender: GenderType.WOMEN, source: 'title' });
    });

    it('does not read "women" as containing "men"', () => {
      expect(
        inferGender({ tags: ['women'], productType: '', title: '' }).gender,
      ).toBe(GenderType.WOMEN);
    });

    it('garment words gender a title (dress → WOMEN)', () => {
      expect(
        inferGender({ tags: [], productType: '', title: 'Linen Wrap Dress' })
          .gender,
      ).toBe(GenderType.WOMEN);
    });

    it('falls through ambiguous sources and defaults to UNISEX', () => {
      // tags match BOTH → ambiguous, falls to title which is silent
      expect(
        inferGender({
          tags: ['men', 'women'],
          productType: '',
          title: 'Oversized Hoodie',
        }),
      ).toEqual({ gender: GenderType.UNISEX, source: 'default' });
    });
  });

  describe('optionField', () => {
    it('maps by name content, tolerating messy names', () => {
      expect(optionField('Colour')).toBe('color');
      expect(optionField('Color')).toBe('color');
      expect(optionField('EMB Green Long Sleeve Crop Top Size')).toBe('size');
      expect(optionField('Fabric')).toBe('material');
      expect(optionField('Scent')).toBeNull();
    });
  });

  describe('suggestCategory', () => {
    const noCtx = { tags: [], productType: '' };

    it('specific rules beat generic ones (order matters)', () => {
      expect(suggestCategory({ ...noCtx, title: 'Boxy T-Shirt' })).toBe('tees');
      expect(suggestCategory({ ...noCtx, title: 'Ribbed Leggings' })).toBe(
        'activewear',
      );
      expect(suggestCategory({ ...noCtx, title: 'Lace Bodysuit' })).toBe(
        'underwear',
      );
      expect(suggestCategory({ ...noCtx, title: 'Linen Shirt' })).toBe('tops');
    });

    it('uses tags and product type as signal too', () => {
      expect(
        suggestCategory({
          tags: ['denim'],
          productType: '',
          title: 'The Classic',
        }),
      ).toBe('pants');
      expect(
        suggestCategory({
          tags: [],
          productType: 'Jewellery',
          title: 'Thandi',
        }),
      ).toBe('jewellery');
    });

    it('key hardware is accessories, not jewellery (keychain ≠ chain)', () => {
      // Real case: a leather keychain tagged "key chain" hit jewellery's
      // \bchains?\b before the accessories rule was consulted.
      expect(
        suggestCategory({
          tags: ['key chain'],
          productType: '',
          title: 'Italian Leather Cactus Keychain',
        }),
      ).toBe('accessories');
      expect(suggestCategory({ ...noCtx, title: 'Brass Key Ring' })).toBe(
        'accessories',
      );
      // Actual chains stay jewellery.
      expect(suggestCategory({ ...noCtx, title: 'Cuban Link Chain' })).toBe(
        'jewellery',
      );
    });

    it('returns null when nothing matches', () => {
      expect(suggestCategory({ ...noCtx, title: 'Gift Voucher' })).toBeNull();
    });
  });

  describe('stripQuery', () => {
    it('drops cache params for image-URL matching; bare URLs pass through', () => {
      expect(stripQuery('https://cdn.shopify.com/a.jpg?v=123&width=2048')).toBe(
        'https://cdn.shopify.com/a.jpg',
      );
      expect(stripQuery('https://cdn.shopify.com/a.jpg')).toBe(
        'https://cdn.shopify.com/a.jpg',
      );
    });
  });

  describe('namespaceSku', () => {
    it('prefixes with the store slug and trims', () => {
      expect(namespaceSku('fieldsstore', ' FS-001 ')).toBe('fieldsstore-FS-001');
    });

    it('nulls empty SKUs', () => {
      expect(namespaceSku('fieldsstore', null)).toBeNull();
      expect(namespaceSku('fieldsstore', '  ')).toBeNull();
    });
  });
});
