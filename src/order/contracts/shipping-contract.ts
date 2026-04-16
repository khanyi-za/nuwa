/**
 * Shipping contract — interface the Order module depends on. Real implementation
 * lives in the future Shipping module (ShipLogic / The Courier Guy). Until that
 * module ships, a stub that throws `NotImplementedException` is bound to the
 * `SHIPPING_SERVICE` token.
 */

export type ShippingServiceTier = 'ECO' | 'LOF' | 'LOX' | 'NFS';

export interface ShippingRateRequest {
  dispatchAddressId: string;
  destinationProvince: string;
  destinationPostalCode: string;
  destinationCity: string;
  destinationCountry: string;
  totalWeightInGrams: number;
  parcelCount: number;
  serviceTier: ShippingServiceTier;
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
