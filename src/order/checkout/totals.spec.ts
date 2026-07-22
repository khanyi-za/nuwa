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

const shipping = (entries: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(entries));

describe('computeCheckoutTotals', () => {
  it('computes correctly for a single-store single-item cart', () => {
    const items = [makeItem()];
    const result = computeCheckoutTotals(items, shipping({ 'store-1': 11_000 }));

    expect(result.stores).toHaveLength(1);
    expect(result.stores[0]).toMatchObject({
      storeId: 'store-1',
      subtotalInCents: 20_000,
      shippingInCents: 11_000,
      totalInCents: 31_000, // subtotal + shipping
      commissionInCents: 500, // 20000 * 0.025 = 500 — shipping is NOT commissionable
    });
    expect(result.grandSubtotalInCents).toBe(20_000);
    expect(result.grandShippingInCents).toBe(11_000);
    expect(result.grandTotalInCents).toBe(31_000);
  });

  it('groups items by store with per-store shipping rates summed at grand level', () => {
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

    const result = computeCheckoutTotals(
      items,
      shipping({ 'store-1': 11_000, 'store-2': 8_500 }),
    );

    expect(result.stores).toHaveLength(2);
    expect(result.grandSubtotalInCents).toBe(50_000);
    expect(result.grandShippingInCents).toBe(19_500);
    expect(result.grandTotalInCents).toBe(69_500);

    const s1 = result.stores.find((s) => s.storeId === 'store-1')!;
    const s2 = result.stores.find((s) => s.storeId === 'store-2')!;
    expect(s1.shippingInCents).toBe(11_000);
    expect(s1.totalInCents).toBe(30_000 + 11_000);
    expect(s2.shippingInCents).toBe(8_500);
    expect(s2.totalInCents).toBe(20_000 + 8_500);
  });

  it('computes commission on subtotal only (shipping not commissionable)', () => {
    const items = [
      makeItem({ unitPriceInCents: 100_000, quantity: 1 }),
    ];
    const result = computeCheckoutTotals(items, shipping({ 'store-1': 11_000 }));

    expect(result.stores[0].commissionInCents).toBe(2_500); // 100000 * 0.025
  });

  it('returns line totals per item', () => {
    const items = [
      makeItem({ unitPriceInCents: 15_000, quantity: 3 }),
    ];
    const result = computeCheckoutTotals(items, shipping({ 'store-1': 11_000 }));

    expect(result.stores[0].items[0]).toMatchObject({
      unitPriceInCents: 15_000,
      quantity: 3,
      lineTotalInCents: 45_000,
    });
  });

  // ─── Phase 10 gap tests ──────────────────────────────────────────────

  it('handles empty items array gracefully', () => {
    const result = computeCheckoutTotals([], shipping({}));

    expect(result.stores).toHaveLength(0);
    expect(result.grandSubtotalInCents).toBe(0);
    expect(result.grandShippingInCents).toBe(0);
    expect(result.grandTotalInCents).toBe(0);
  });

  it('rounds commission correctly with fractional cents', () => {
    // 10_001 * 0.025 = 250.025 → rounds to 250
    const items = [
      makeItem({ unitPriceInCents: 10_001, quantity: 1 }),
    ];
    const result = computeCheckoutTotals(items, shipping({ 'store-1': 11_000 }));

    expect(result.stores[0].commissionInCents).toBe(250);
    expect(result.stores[0].subtotalInCents).toBe(10_001);
  });

  it('groups multiple items into the same store', () => {
    const items = [
      makeItem({ productId: 'prod-1', unitPriceInCents: 10_000, quantity: 1 }),
      makeItem({ productId: 'prod-2', unitPriceInCents: 20_000, quantity: 2 }),
    ];
    const result = computeCheckoutTotals(items, shipping({ 'store-1': 11_000 }));

    // Both items share store-1, so there's one store group.
    expect(result.stores).toHaveLength(1);
    expect(result.stores[0].items).toHaveLength(2);
    expect(result.stores[0].subtotalInCents).toBe(50_000); // 10000 + 40000
    expect(result.grandSubtotalInCents).toBe(50_000);
  });

  it('defaults shipping to 0 when no entry exists for a store in the map', () => {
    const items = [makeItem()];
    const result = computeCheckoutTotals(items, shipping({})); // no store-1 entry

    expect(result.stores[0].shippingInCents).toBe(0);
    expect(result.stores[0].totalInCents).toBe(20_000);
    expect(result.grandShippingInCents).toBe(0);
  });
});
