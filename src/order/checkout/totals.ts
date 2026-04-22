/**
 * Pure checkout-totals computation. No DB calls, no side effects.
 *
 * Given a list of resolved cart items (already validated as available) and a
 * total shipping fee, groups items by store, computes per-store subtotals,
 * and derives commission per store.
 *
 * Shipping is a single flat fee that lives on the PaymentGroup — it is NOT
 * split across stores/orders. YIIVA pays The Courier Guy directly; merchants
 * never see or handle shipping money.
 *
 * The 5.5% commission is applied to subtotal only — shipping is not
 * commissionable (Phase 4 decision #12).
 */

const COMMISSION_RATE = 0.055;

// ─── Input shape ────────────────────────────────────────────────────────────

export interface CheckoutLineItem {
  productId: string;
  variantId: string | null;
  storeId: string;
  storeName: string;
  storeSlug: string;
  productTitle: string;
  variantName: string | null;
  productImageUrl: string | null;
  unitPriceInCents: number;
  quantity: number;
}

// ─── Output shape ───────────────────────────────────────────────────────────

export interface CheckoutStoreGroup {
  storeId: string;
  storeName: string;
  storeSlug: string;
  items: CheckoutStoreItem[];
  subtotalInCents: number;
  commissionInCents: number;
  totalInCents: number; // = subtotalInCents (no shipping at store level)
}

export interface CheckoutStoreItem {
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantName: string | null;
  productImageUrl: string | null;
  unitPriceInCents: number;
  quantity: number;
  lineTotalInCents: number;
}

export interface CheckoutTotals {
  stores: CheckoutStoreGroup[];
  grandSubtotalInCents: number;
  grandShippingInCents: number;
  grandTotalInCents: number;
}

// ─── Core function ──────────────────────────────────────────────────────────

export function computeCheckoutTotals(
  items: CheckoutLineItem[],
  totalShippingInCents: number,
): CheckoutTotals {
  // 1. Group items by store.
  const storeMap = new Map<
    string,
    { storeName: string; storeSlug: string; items: CheckoutStoreItem[] }
  >();

  for (const item of items) {
    let group = storeMap.get(item.storeId);
    if (!group) {
      group = {
        storeName: item.storeName,
        storeSlug: item.storeSlug,
        items: [],
      };
      storeMap.set(item.storeId, group);
    }
    group.items.push({
      productId: item.productId,
      variantId: item.variantId,
      productTitle: item.productTitle,
      variantName: item.variantName,
      productImageUrl: item.productImageUrl,
      unitPriceInCents: item.unitPriceInCents,
      quantity: item.quantity,
      lineTotalInCents: item.unitPriceInCents * item.quantity,
    });
  }

  // 2. Build store groups (no shipping at store level).
  const stores: CheckoutStoreGroup[] = [];
  let grandSubtotalInCents = 0;

  for (const [storeId, group] of storeMap) {
    const subtotalInCents = group.items.reduce(
      (sum, i) => sum + i.lineTotalInCents,
      0,
    );
    const commissionInCents = Math.round(subtotalInCents * COMMISSION_RATE);
    stores.push({
      storeId,
      storeName: group.storeName,
      storeSlug: group.storeSlug,
      items: group.items,
      subtotalInCents,
      commissionInCents,
      totalInCents: subtotalInCents,
    });
    grandSubtotalInCents += subtotalInCents;
  }

  return {
    stores,
    grandSubtotalInCents,
    grandShippingInCents: totalShippingInCents,
    grandTotalInCents: grandSubtotalInCents + totalShippingInCents,
  };
}
