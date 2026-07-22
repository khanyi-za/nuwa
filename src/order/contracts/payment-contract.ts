/**
 * Payment contract — interface the Order module depends on. The
 * `PAYMENT_SERVICE` token resolves to the bound provider implementation
 * (`PaystackService` since the 2026-07 migration; see docs/payments-module/
 * paystack-migration-foundation.md for the decision record).
 *
 * v3 contract: provider-neutral shapes.
 *   - `reference` is OUR payment-group reference, echoed back on provider
 *     webhooks (persisted as PaymentGroup.mPaymentId — legacy column name).
 *   - `PaymentInitResponse.redirect` covers both hosted-page styles: GET
 *     providers (Paystack) supply a plain URL; a future POST-form provider
 *     would also supply `fields`.
 */

export interface PaymentInitRequest {
  /** One-or-many order IDs. Multi-brand checkouts pass all sibling orders in one call. */
  orderIds: string[];

  /** OUR payment reference — caller-generated, persisted to PaymentGroup.mPaymentId. */
  reference: string;

  /** Total amount across all sibling orders, in cents (integer). */
  totalAmountInCents: number;

  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;

  /** Optional. SA cell number in any format. */
  buyerCellNumber?: string;

  /** Shown on the provider's hosted checkout as "what is the buyer paying for". */
  itemName: string;

  /** Optional. Longer description for the same. */
  itemDescription?: string;

  /** Optional. Frontend may override the default return/callback URL per checkout. */
  returnUrl?: string;

  /**
   * Optional. Restrict the provider's hosted page to specific payment
   * channels (Paystack: 'card' | 'eft' | 'qr' …). Omit → provider defaults
   * (all active channels). POST-form providers may ignore.
   */
  channels?: string[];

  /**
   * Optional. Per-merchant settlement instructions (Paystack flat
   * multi-split): each entry routes `amountInCents` of the settlement
   * directly to the merchant's provider subaccount; the remainder
   * (commission + shipping + any unconfigured merchants' shares) settles to
   * the platform account. Fee bearing: all-proportional (PS-8).
   */
  splits?: PaymentSplitInstruction[];
}

export interface PaymentSplitInstruction {
  /** Provider subaccount (Paystack ACCT_…) from Store.paystackSubaccountCode. */
  subaccountCode: string;
  /** The merchant's payout for their order: subtotal − commission. */
  amountInCents: number;
}

export interface PaymentRedirect {
  /** Where the buyer goes to pay (hosted checkout). */
  url: string;

  /** GET → plain navigation (Paystack). POST → render `fields` as a form and submit (legacy form-flow providers). */
  method: 'GET' | 'POST';

  /** Hidden form inputs — POST-form providers only. */
  fields?: Record<string, string>;
}

export interface PaymentInitResponse {
  redirect: PaymentRedirect;

  /** Provider's own handle for the init when returned (e.g. Paystack access_code). */
  providerRef?: string;
}

export interface RefundRequest {
  /**
   * Provider's id for the ORIGINAL payment (Paystack transaction id, stored
   * on the PaymentGroup.pfPaymentId column — legacy column name).
   */
  providerPaymentId: string;

  /** Refund amount in cents. May be partial; cumulative refunds enforced server-side. */
  amountInCents: number;

  /** Reason text shown to the buyer in their refund confirmation. */
  reason: string;

  /** When true, the provider notifies the buyer about the refund where supported. */
  notifyBuyer?: boolean;
}

export interface RefundResponse {
  /** Provider's refund record identifier. */
  refundId: string;

  /** Refund processing status. Providers confirm asynchronously via webhook. */
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

  /** Raw provider response payload, retained for audit on the Payment row. */
  raw: unknown;
}

export interface IPaymentService {
  initializePayment(req: PaymentInitRequest): Promise<PaymentInitResponse>;
  refundPayment(req: RefundRequest): Promise<RefundResponse>;
}

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';
