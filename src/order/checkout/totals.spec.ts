import {
  computeCheckoutTotals,
  CheckoutLineItem,
} from './totals';

// ─── computeCheckoutTotals ──────────────────────────────────────────────────

const makeItem = (overrides: Partial<CheckoutLineItem> = {}): CheckoutLineItem => ({
  productId: 'prod-1',
  variantId: null,
  storeId: 'store-1',
  storeName: 'Store One',
  storeSlug: 'store-one',
  productTitle: 'Widget',
  variantName: null,
  productImageUrl: null,
  unitPriceInCents: 10_000,
  quantity: 2,
  ...overrides,
});

describe('computeCheckoutTotals', () => {
  it('computes correctly for a single-store single-item cart', () => {
    const items = [makeItem()];
    const result = computeCheckoutTotals(items, 11_000);

    expect(result.stores).toHaveLength(1);
    expect(result.stores[0]).toMatchObject({
      storeId: 'store-1',
      subtotalInCents: 20_000,
      totalInCents: 20_000, // no shipping at store level
      commissionInCents: 1_100, // 20000 * 0.055 = 1100
    });
    expect(result.grandSubtotalInCents).toBe(20_000);
    expect(result.grandShippingInCents).toBe(11_000);
    expect(result.grandTotalInCents).toBe(31_000);
  });

  it('groups items by store — shipping stays at checkout level only', () => {
    const items = [
      makeItem({
        storeId: 'store-1',
        storeName: 'Store One',
        unitPriceInCents: 30_000,
        quantity: 1,
      }),
      makeItem({
        storeId: 'store-2',
        storeName: 'Store Two',
        storeSlug: 'store-two',
        productId: 'prod-2',
        unitPriceInCents: 20_000,
        quantity: 1,
      }),
    ];

    const result = computeCheckoutTotals(items, 11_000);

    expect(result.stores).toHaveLength(2);
    expect(result.grandSubtotalInCents).toBe(50_000);
    expect(result.grandShippingInCents).toBe(11_000);
    expect(result.grandTotalInCents).toBe(61_000);

    // No shipping at store level — each store's total equals its subtotal.
    for (const store of result.stores) {
      expect(store.totalInCents).toBe(store.subtotalInCents);
    }
  });

  it('computes commission on subtotal only (shipping not commissionable)', () => {
    const items = [
      makeItem({ unitPriceInCents: 100_000, quantity: 1 }),
    ];
    const result = computeCheckoutTotals(items, 11_000);

    expect(result.stores[0].commissionInCents).toBe(5_500); // 100000 * 0.055
  });

  it('returns line totals per item', () => {
    const items = [
      makeItem({ unitPriceInCents: 15_000, quantity: 3 }),
    ];
    const result = computeCheckoutTotals(items, 11_000);

    expect(result.stores[0].items[0]).toMatchObject({
      unitPriceInCents: 15_000,
      quantity: 3,
      lineTotalInCents: 45_000,
    });
  });
});
