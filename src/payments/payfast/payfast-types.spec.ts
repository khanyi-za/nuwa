import { PaymentStatus } from '@prisma/client';
import { toPaymentStatus } from './payfast-types';

describe('toPaymentStatus', () => {
  it('maps COMPLETE → COMPLETED (PayFast uses no D)', () => {
    expect(toPaymentStatus('COMPLETE')).toBe(PaymentStatus.COMPLETED);
  });

  it('maps FAILED → FAILED', () => {
    expect(toPaymentStatus('FAILED')).toBe(PaymentStatus.FAILED);
  });

  it('maps CANCELLED → CANCELLED', () => {
    expect(toPaymentStatus('CANCELLED')).toBe(PaymentStatus.CANCELLED);
  });

  it('maps PENDING → PENDING', () => {
    expect(toPaymentStatus('PENDING')).toBe(PaymentStatus.PENDING);
  });

  it('maps REFUND → REFUNDED (PayFast says REFUND, our enum is REFUNDED)', () => {
    expect(toPaymentStatus('REFUND')).toBe(PaymentStatus.REFUNDED);
  });

  it('maps PARTIALLY_REFUNDED → PARTIALLY_REFUNDED', () => {
    expect(toPaymentStatus('PARTIALLY_REFUNDED')).toBe(
      PaymentStatus.PARTIALLY_REFUNDED,
    );
  });

  it('throws on unknown PayFast status (forces explicit handling for new values)', () => {
    expect(() => toPaymentStatus('SOMETHING_NEW')).toThrow(
      'Unknown PayFast payment_status: SOMETHING_NEW',
    );
  });

  it('throws on empty string', () => {
    expect(() => toPaymentStatus('')).toThrow('Unknown PayFast payment_status:');
  });
});
