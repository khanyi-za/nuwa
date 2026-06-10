import { OrderStatus, PaymentStatus } from '@prisma/client';

export type MobileOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

/**
 * Consolidate a maya "order" (= one nuwa PaymentGroup) into a single status.
 * Payment-stage statuses dominate before payment completes; afterwards the
 * fulfilment stage is derived from the child per-store orders. Per maya TO-8:
 * SHIPPED when ANY store ships, DELIVERED only when ALL deliver.
 */
export function mapMobileOrderStatus(
  paymentStatus: PaymentStatus,
  childStatuses: OrderStatus[],
): MobileOrderStatus {
  const isCancelled = (s: OrderStatus) =>
    s === OrderStatus.CANCELLED ||
    s === OrderStatus.REFUNDED ||
    s === OrderStatus.REFUND_REQUESTED;

  // A fully-cancelled set of child orders is CANCELLED regardless of payment
  // stage — e.g. a buyer abandons an unpaid order (PaymentGroup stays PENDING
  // because buyer-cancel only transitions the Order rows, not the group).
  if (childStatuses.length > 0 && childStatuses.every(isCancelled)) {
    return 'CANCELLED';
  }

  if (paymentStatus === PaymentStatus.PENDING) return 'PENDING_PAYMENT';
  if (paymentStatus === PaymentStatus.FAILED) return 'PAYMENT_FAILED';
  if (paymentStatus === PaymentStatus.CANCELLED) return 'CANCELLED';

  if (childStatuses.length === 0) return 'CONFIRMED';

  const isShipped = (s: OrderStatus) =>
    s === OrderStatus.DISPATCHED ||
    s === OrderStatus.IN_TRANSIT ||
    s === OrderStatus.DELIVERED;
  const isPreparing = (s: OrderStatus) =>
    s === OrderStatus.PROCESSING || s === OrderStatus.READY_FOR_DISPATCH;

  if (childStatuses.every((s) => s === OrderStatus.DELIVERED)) return 'DELIVERED';
  if (childStatuses.some(isShipped)) return 'SHIPPED';
  if (childStatuses.some(isPreparing)) return 'PREPARING';
  if (childStatuses.some((s) => s === OrderStatus.CONFIRMED)) return 'CONFIRMED';
  return 'CONFIRMED';
}

export function mapPaymentStatusLabel(s: PaymentStatus): string {
  switch (s) {
    case PaymentStatus.COMPLETED:
      return 'succeeded';
    case PaymentStatus.FAILED:
    case PaymentStatus.CANCELLED:
      return 'failed';
    case PaymentStatus.REFUNDED:
    case PaymentStatus.PARTIALLY_REFUNDED:
      return 'refunded';
    default:
      return 'pending';
  }
}
