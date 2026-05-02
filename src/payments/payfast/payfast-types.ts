import { PaymentStatus } from '@prisma/client';

/**
 * PayFast ITN payload — fields received in the form-encoded POST body of an ITN.
 *
 * Note: PayFast may add fields without notice. Treat unknown fields as opaque
 * (we store the full payload on PaymentEvent.payload for forensics).
 */
export interface ItnPayload {
  m_payment_id: string;
  pf_payment_id?: string;
  payment_status: PayfastStatus;
  item_name?: string;
  item_description?: string;
  amount_gross: string;
  amount_fee?: string;
  amount_net?: string;
  custom_str1?: string;
  custom_str2?: string;
  custom_str3?: string;
  custom_str4?: string;
  custom_str5?: string;
  custom_int1?: string;
  custom_int2?: string;
  custom_int3?: string;
  custom_int4?: string;
  custom_int5?: string;
  name_first?: string;
  name_last?: string;
  email_address?: string;
  merchant_id: string;
  signature: string;
  [key: string]: string | undefined;
}

/**
 * Status values PayFast sends in the `payment_status` ITN field.
 *
 * IMPORTANT: PayFast uses `COMPLETE` (no D). Our Prisma enum is `COMPLETED`.
 * Always map via toPaymentStatus() before persisting.
 */
export type PayfastStatus =
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED'
  | 'PENDING'
  | 'REFUND'
  | 'PARTIALLY_REFUNDED';

/**
 * Map a PayFast ITN status to our Prisma PaymentStatus enum.
 * Throws on unknown values — PayFast adding a new status warrants explicit
 * handling rather than silent acceptance.
 */
export function toPaymentStatus(input: string): PaymentStatus {
  switch (input) {
    case 'COMPLETE':
      return PaymentStatus.COMPLETED;
    case 'FAILED':
      return PaymentStatus.FAILED;
    case 'CANCELLED':
      return PaymentStatus.CANCELLED;
    case 'PENDING':
      return PaymentStatus.PENDING;
    case 'REFUND':
      return PaymentStatus.REFUNDED;
    case 'PARTIALLY_REFUNDED':
      return PaymentStatus.PARTIALLY_REFUNDED;
    default:
      throw new Error(`Unknown PayFast payment_status: ${input}`);
  }
}

/**
 * Response shape from PayFast's REST refund API.
 *
 * The response is wrapped in a `data` envelope per PayFast convention.
 * `response` echoes the refund-creation outcome; `code` is HTTP-style.
 */
export interface PayfastRefundResponse {
  code: number;
  status: string;
  data?: {
    response?: boolean;
    message?: string;
  };
}
