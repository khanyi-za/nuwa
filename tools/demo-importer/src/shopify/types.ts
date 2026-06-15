/*
 * Wire-format shapes returned by Shopify's public storefront JSON endpoints.
 * Only the fields the importer consumes are typed; the raw bodies are persisted
 * untouched so later stages can reach anything we missed.
 *
 * Confirmed against 5 real SA storefronts (2026-06-15): sakanya.co,
 * madebyfade.com, shop.embeddedclothing.com, suhuoriginal.co.za, tolthema.com.
 */

export interface ShopifyVariant {
  id: number;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  sku: string | null;
  requires_shipping: boolean;
  taxable: boolean;
  featured_image: ShopifyImage | null;
  available: boolean;
  price: string; // decimal string, e.g. "3600.00"
  grams: number; // often 0 in the wild → caller applies a weight fallback
  compare_at_price: string | null;
  position: number;
  product_id: number;
  created_at: string;
  updated_at: string;
}

export interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  src: string;
  width: number;
  height: number;
  variant_ids: number[]; // links an image to specific variants
  created_at: string;
  updated_at: string;
}

export interface ShopifyOption {
  name: string; // messy in the wild: "Size", but also "EMB Green Long Sleeve Crop Top Size"
  position: number;
  values: string[];
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  vendor: string;
  product_type: string; // frequently "" or non-taxonomic → tags are the better signal
  tags: string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
}

export interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

export interface ShopifyCollection {
  id: number;
  handle: string;
  title: string;
  description: string | null;
  published_at: string | null;
  updated_at: string | null;
  image: { src: string } | null;
  products_count: number;
}

export interface ShopifyCollectionsResponse {
  collections: ShopifyCollection[];
}
