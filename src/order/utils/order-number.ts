import { randomInt } from 'crypto';

/**
 * Human-readable order number generator.
 *
 * Format: `YV-<YYYY>-<5 chars>`
 * Example: `YV-2026-A4F2K`
 *
 * Alphabet (Crockford-style base32): 32 chars. Excludes `I`, `L`, `O`, `U`
 * to avoid read-aloud and typing ambiguity (`1` vs `I` vs `L`, `0` vs `O`).
 *
 * Collision space: 32^5 ≈ 33.5M per year. At DB-unique + retry-on-collision,
 * practical collision risk is negligible at projected scale. See
 * `docs/order-module/order-module-foundation.md` §Things Worth Flagging.
 *
 * Note: `Order.orderNumber` is a **display** identifier. Relations use `Order.id`.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RANDOM_SEGMENT_LENGTH = 5;

/**
 * Generate a new candidate order number. The caller is responsible for the
 * DB unique-constraint retry loop (generate → insert → catch P2002 → retry).
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  let random = '';
  for (let i = 0; i < RANDOM_SEGMENT_LENGTH; i++) {
    random += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return `YV-${year}-${random}`;
}
