/**
 * Paystack wire-format types — the subset of the REST API we consume.
 * Amounts are ALWAYS integer subunits (ZAR cents) on both sides — no
 * decimal-string conversion surface (unlike PayFast's Rand strings).
 *
 * Envelope: every Paystack response is `{ status, message, data }` where
 * `status` is a boolean ("did the API call succeed"), NOT the domain status.
 */

export interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

// ─── POST /transaction/initialize ────────────────────────────────────────────

export interface PaystackInitializeRequest {
  amount: number; // integer subunits (ZAR cents)
  email: string;
  currency: 'ZAR';
  /** OUR payment reference (PaymentGroup reference) — echoed on webhooks. */
  reference: string;
  /** Buyer lands here after the hosted checkout (success or failure). */
  callback_url?: string;
  /** Restrict payment channels if ever needed; omit = account defaults. */
  channels?: string[];
  /** Attach a pre-created transaction split (SPL_…) — settlement divides at charge time. */
  split_code?: string;
  metadata?: Record<string, unknown>;
}

export interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

// ─── GET /transaction/verify/:reference ──────────────────────────────────────

export type PaystackTransactionStatus =
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'pending'
  | 'ongoing'
  | 'processing'
  | 'queued'
  | 'reversed';

export interface PaystackVerifyData {
  id: number; // Paystack's numeric transaction id (providerPaymentId)
  status: PaystackTransactionStatus;
  reference: string;
  amount: number; // integer subunits
  currency: string;
  gateway_response: string;
  paid_at: string | null;
  channel: string;
  fees: number | null; // integer subunits, deducted at settlement (PS-7)
  customer?: { email?: string };
}

// ─── POST /refund ─────────────────────────────────────────────────────────────

export interface PaystackRefundRequest {
  /** Transaction id or reference of the ORIGINAL charge. */
  transaction: string | number;
  /** Omit for a full refund; integer subunits for partial. */
  amount?: number;
  currency?: 'ZAR';
  customer_note?: string;
  merchant_note?: string;
}

export type PaystackRefundStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed';

export interface PaystackRefundData {
  id: number; // refund record id
  status: PaystackRefundStatus;
  transaction: { id: number; reference: string } | number;
  amount: number;
  currency: string;
  refunded_at: string | null;
}

// ─── Subaccounts + splits (Phase 6: merchant payouts) ────────────────────────

export interface PaystackBank {
  name: string;
  code: string; // settlement_bank code used at subaccount creation
  active: boolean;
  currency: string;
}

export interface PaystackCreateSubaccountRequest {
  business_name: string;
  settlement_bank: string; // bank code from GET /bank
  account_number: string;
  /**
   * Required by the API but irrelevant to us: dynamic FLAT splits override it
   * per transaction. Set to the platform commission for dashboard legibility.
   */
  percentage_charge: number;
  description?: string;
  primary_contact_email?: string;
}

export interface PaystackSubaccountData {
  id: number;
  subaccount_code: string; // ACCT_xxx — persisted on Store.paystackSubaccountCode
  business_name: string;
  settlement_bank: string; // bank NAME in responses
  account_number: string;
  percentage_charge: number;
  active: boolean;
}

export interface PaystackCreateSplitRequest {
  name: string;
  type: 'flat' | 'percentage';
  currency: 'ZAR';
  subaccounts: { subaccount: string; share: number }[]; // share = integer cents for flat
  /**
   * Who bears Paystack's processing fee. PS-8: at 2.5% commission, card fees
   * exceed the commission — 'all-proportional' keeps YIIVA margin-positive.
   */
  bearer_type: 'account' | 'subaccount' | 'all-proportional' | 'all';
  bearer_subaccount?: string;
}

export interface PaystackSplitData {
  id: number;
  split_code: string; // SPL_xxx — passed to /transaction/initialize
  name: string;
  type: string;
  currency: string;
  subaccounts: { subaccount: { subaccount_code: string }; share: number }[];
}

// ─── Webhook events (consumed in Phase 3) ────────────────────────────────────

/** Header carrying HMAC-SHA512(rawBody, secretKey), hex-encoded. */
export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';

export type PaystackWebhookEventType =
  | 'charge.success'
  | 'refund.pending'
  | 'refund.processing'
  | 'refund.processed'
  | 'refund.failed'
  | (string & {}); // forward-compatible: unknown events are audit-logged, not errors

export interface PaystackWebhookEvent<T = Record<string, unknown>> {
  event: PaystackWebhookEventType;
  data: T;
}
