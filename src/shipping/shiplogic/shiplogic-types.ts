/**
 * Wire-format types for the ShipLogic REST API. Mirrors what the API actually
 * returns — fields with falsy values may be omitted (per ShipLogic docs), so
 * keep most properties optional and access defensively.
 */

export type ShipLogicAddressType = 'business' | 'residential' | 'counter' | 'locker';

export interface ShipLogicAddress {
  type: ShipLogicAddressType;
  company?: string;
  street_address: string;
  local_area?: string;
  city: string;
  zone: string;             // SA province
  country: string;          // "ZA"
  code: string;             // postal code, 4 digits in SA
  lat?: number;
  lng?: number;
}

export interface ShipLogicParcel {
  parcel_description?: string;
  submitted_length_cm: number;
  submitted_width_cm: number;
  submitted_height_cm: number;
  submitted_weight_kg: number;
}

export interface ShipLogicRateRequest {
  collection_address: ShipLogicAddress;
  delivery_address: ShipLogicAddress;
  parcels: ShipLogicParcel[];
  declared_value?: number;  // ZAR (rands, not cents)
  collection_min_date?: string; // ISO date
  delivery_min_date?: string;   // ISO date
}

export interface ShipLogicServiceLevel {
  id: number;
  code: string;             // "ECO", "LOF", "LOX", "NFS", "LSF", etc.
  name: string;
  description?: string;
  delivery_date_from?: string;  // ISO datetime
  delivery_date_to?: string;    // ISO datetime
  collection_date?: string;     // ISO datetime
  collection_cut_off_time?: string;
  insurance_disabled?: boolean;
  vat_type?: string;
}

export interface ShipLogicRateOption {
  rate: number;                  // inclusive of VAT, in ZAR (not cents)
  rate_excluding_vat: number;    // ZAR
  service_level: ShipLogicServiceLevel;
  charged_weight?: number;
  actual_weight?: number;
  volumetric_weight?: number;
  surcharges?: unknown[];
  rate_adjustments?: unknown[];
  time_based_rate_adjustments?: unknown[];
  extras?: unknown[];
  base_rate?: {
    charge: number;
    vat: number;
    vat_percentage: number;
    vat_type: string;
    rate_formula_type: string;
    rate_types: string[];
    group_name: string;
    total_calculated_weight: number;
    charge_per_parcel: number[];
  };
}

export interface ShipLogicRateResponse {
  message?: string;
  service_days?: {
    collection_service_days: unknown | null;
    delivery_service_days: unknown | null;
  };
  rates: ShipLogicRateOption[];
}

// ─── Shipment create ────────────────────────────────────────────────────────

export interface ShipLogicContact {
  name: string;
  mobile_number: string;
  email?: string;
}

export interface ShipLogicCreateParcel extends ShipLogicParcel {
  alternative_tracking_reference?: string;
}

export interface ShipLogicCreateShipmentRequest {
  collection_address: ShipLogicAddress;
  collection_contact: ShipLogicContact;
  delivery_address: ShipLogicAddress;
  delivery_contact: ShipLogicContact;
  parcels: ShipLogicCreateParcel[];
  service_level_code: string;        // "ECO", "LOF", etc.
  declared_value?: number;            // rand, not cents
  special_instructions_collection?: string;
  special_instructions_delivery?: string;
  opt_in_rates?: number[];
  opt_in_time_based_rates?: number[];
}

/**
 * Subset of fields we read from the ShipLogic `POST /shipments` response.
 * The full payload is large — we store it on `Shipment.shiplogicPayload` as
 * a Json blob for audit and only deconstruct what we need into typed fields.
 */
export interface ShipLogicCreateShipmentResponse {
  id: number;                                 // ShipLogic internal shipment ID
  short_tracking_reference: string;           // e.g. "VD3GLQ" — webhook lookup key
  custom_tracking_reference?: string;         // full prefixed form, e.g. "SLXVD3GLQ"
  status?: string;                            // initial status, e.g. "collection-assigned"
  service_level_code?: string;
  service_level_name?: string;
  rate?: number;                              // ZAR
  original_rate?: number;
  declared_value?: number;
  parcels?: Array<{
    id: number;
    status?: string;
    tracking_reference: string;
    parcel_description?: string;
    submitted_length_cm?: number;
    submitted_width_cm?: number;
    submitted_height_cm?: number;
    submitted_weight_kg?: number;
  }>;
  estimated_collection?: string;              // ISO
  estimated_delivery_from?: string;
  estimated_delivery_to?: string;
  proof_of_delivery_pin?: string;
  charged_weight?: number;
  actual_weight?: number;
  volumetric_weight?: number;
  rates?: unknown[];
  collection_address?: ShipLogicAddress;
  delivery_address?: ShipLogicAddress;
  // Plus many more fields we don't currently use; preserved in shiplogicPayload.
  [k: string]: unknown;
}

// ─── Shipment cancel ────────────────────────────────────────────────────────

export interface ShipLogicCancelShipmentRequest {
  tracking_reference: string; // short_tracking_reference (e.g. "VD3GLQ")
}
