import type { ShippingDeliveryAddress } from '../../order/contracts/shipping-contract';
import type { ShipLogicAddress } from './shiplogic-types';

/**
 * Pure mapping helpers. YIIVA's address shapes don't match ShipLogic's
 * (different field names — `street_address` not `addressLine1`, `zone` not
 * `province`, `local_area` not `suburb`, `code` not `postalCode`). These
 * helpers translate at the wire-boundary.
 */

/** Minimal subset of `StoreDispatchAddress` we read in the mapping. */
export interface YiivaDispatchSource {
  addressLine1: string;
  addressLine2?: string | null;
  suburb?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country?: string | null;       // schema-default "South Africa"; ignored — we always send "ZA"
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Convert a YIIVA dispatch (merchant origin) address to ShipLogic shape.
 * `type` defaults to "business" — merchants ship from their premises.
 */
export function toShipLogicCollectionAddress(
  origin: YiivaDispatchSource,
  options: {
    company?: string;
    type?: 'business' | 'residential' | 'counter' | 'locker';
  } = {},
): ShipLogicAddress {
  return stripUndefined({
    type: options.type ?? 'business',
    company: options.company || undefined,
    street_address: joinStreet(origin.addressLine1, origin.addressLine2),
    local_area: origin.suburb || undefined,
    city: origin.city,
    zone: origin.province,
    country: countryToIsoZa(origin.country),
    code: origin.postalCode,
    lat: origin.latitude ?? undefined,
    lng: origin.longitude ?? undefined,
  });
}

/**
 * Convert a contract-shape `ShippingDeliveryAddress` (buyer-side, already
 * has joined `streetAddress`) to ShipLogic shape.
 * `type` defaults to "residential" — buyers are usually at home.
 */
export function toShipLogicDeliveryAddress(
  dest: ShippingDeliveryAddress,
  options: {
    company?: string;
    type?: 'business' | 'residential' | 'counter' | 'locker';
  } = {},
): ShipLogicAddress {
  return stripUndefined({
    type: options.type ?? 'residential',
    company: options.company || undefined,
    street_address: dest.streetAddress.trim(),
    local_area: dest.suburb || undefined,
    city: dest.city,
    zone: dest.province,
    country: countryToIsoZa(dest.country),
    code: dest.postalCode,
  });
}

// ─── Internals ────────────────────────────────────────────────────────────────

function joinStreet(line1: string, line2?: string | null): string {
  if (!line2 || line2.trim() === '') return line1.trim();
  return `${line1.trim()}, ${line2.trim()}`;
}

function countryToIsoZa(country?: string | null): string {
  // We only ship within South Africa in v1. ShipLogic expects ISO-2 codes
  // ("ZA"); our schema stores the full name ("South Africa"). Map at the
  // boundary; treat anything else as "ZA" for now since we don't allow
  // non-SA addresses at the validation layer.
  return 'ZA';
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
