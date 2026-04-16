/**
 * Payment contract — interface the Order module depends on. Real implementation
 * lives in the future Payments module (PayFast). Until then, a stub bound to the
 * `PAYMENT_SERVICE` token throws `NotImplementedException`.
 */

export interface PaymentInitRequest {
  /** One-or-many order IDs. Multi-brand checkouts pass all sibling orders in one call. */
  orderIds: string[];
  totalAmountInCents: number;
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

export interface PaymentInitResponse {
  paymentGroupId: string;
  mPaymentId: string;
  payfastRedirectUrl: string;
}

export interface IPaymentService {
  initializePayment(req: PaymentInitRequest): Promise<PaymentInitResponse>;
}

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';
