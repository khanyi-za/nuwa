/**
 * Pure checkout-totals computation. No DB calls, no side effects.
 *
 * Given a list of resolved cart items (already validated as available) and a
 * per-store shipping fee map, groups items by store, computes per-store
 * subtotals + shipping + commission, and derives the grand totals.
 *
 * Each store group carries its own shipping (real ShipLogic per-store rates,
 * Phase 4). YIIVA still pays The Courier Guy directly — the per-store
 * shipping cost is collected from the buyer but not paid out to merchants;
 * the commission math runs on subtotal only.
 *
 * The 5.5% commission is applied to subtotal only — shipping is not
 * commissionable.
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
  shippingInCents: number;       // per-store quote (ShipLogic per-store rate)
  commissionInCents: number;     // 5.5% of subtotal only — shipping not commissionable
  totalInCents: number;          // = subtotalInCents + shippingInCents
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
  shippingByStoreId: Map<string, number>,
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

  // 2. Build store groups (per-store shipping pulled from caller-supplied map).
  const stores: CheckoutStoreGroup[] = [];
  let grandSubtotalInCents = 0;
  let grandShippingInCents = 0;

  for (const [storeId, group] of storeMap) {
    const subtotalInCents = group.items.reduce(
      (sum, i) => sum + i.lineTotalInCents,
      0,
    );
    const shippingInCents = shippingByStoreId.get(storeId) ?? 0;
    const commissionInCents = Math.round(subtotalInCents * COMMISSION_RATE);
    stores.push({
      storeId,
      storeName: group.storeName,
      storeSlug: group.storeSlug,
      items: group.items,
      subtotalInCents,
      shippingInCents,
      commissionInCents,
      totalInCents: subtotalInCents + shippingInCents,
    });
    grandSubtotalInCents += subtotalInCents;
    grandShippingInCents += shippingInCents;
  }

  return {
    stores,
    grandSubtotalInCents,
    grandShippingInCents,
    grandTotalInCents: grandSubtotalInCents + grandShippingInCents,
  };
}
