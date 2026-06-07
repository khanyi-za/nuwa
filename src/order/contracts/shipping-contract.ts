/**
 * Shipping contract — interface the Order module depends on. Real implementation
 * lives in the future Shipping module (ShipLogic / The Courier Guy). Until that
 * module ships, a stub that throws `NotImplementedException` is bound to the
 * `SHIPPING_SERVICE` token.
 */

export type ShippingServiceTier = 'ECO' | 'LOF' | 'LOX' | 'NFS';

/**
 * Buyer-side delivery address shape — what the rate request sends. The real
 * implementation needs `streetAddress` + `suburb` (ShipLogic's `local_area`)
 * for accurate geocoding; the stub ignores them.
 */
export interface ShippingDeliveryAddress {
  streetAddress: string;             // typically `addressLine1[, addressLine2]`
  suburb?: string | null;            // maps to ShipLogic local_area
  city: string;
  province: string;                  // maps to ShipLogic zone
  postalCode: string;                // maps to ShipLogic code
  country?: string | null;           // defaults to "South Africa" / "ZA"
}

export interface ShippingRateRequest {
  /**
   * `StoreDispatchAddress.id` for the merchant's parcel origin. The real
   * implementation looks this up via Prisma; the stub ignores it.
   */
  dispatchAddressId: string;

  /**
   * Full destination address. Optional only for backwards-compatibility with
   * the stub during the transition; real implementation throws if missing.
   */
  delivery?: ShippingDeliveryAddress;

  /** Per-line legacy fields — kept for the stub path. New code should set `delivery`. */
  destinationProvince: string;
  destinationPostalCode: string;
  destinationCity: string;
  destinationCountry: string;

  totalWeightInGrams: number;
  parcelCount: number;
  serviceTier: ShippingServiceTier;

  /** Optional — insurance value in cents (real implementation converts to rand for ShipLogic). */
  declaredValueInCents?: number;
}

export interface ShippingRateResponse {
  quoteId: string;
  rateInCents: number;
  rateExVatInCents: number;
  serviceTier: string;
  estimatedDeliveryDate: Date;
}

export interface IShippingService {
  getRate(req: ShippingRateRequest): Promise<ShippingRateResponse>;
}

export const SHIPPING_SERVICE = 'SHIPPING_SERVICE';
