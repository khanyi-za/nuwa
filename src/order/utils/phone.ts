import { BadRequestException } from '@nestjs/common';

/**
 * SA phone normalization.
 *
 * Accepted inputs (after stripping whitespace, dashes, parentheses):
 *   - `0XXXXXXXXX`  (10 digits starting with 0)
 *   - `+27XXXXXXXXX` (12 chars: +27 followed by 9 digits)
 *   - `27XXXXXXXXX`  (11 digits starting with 27)
 *
 * Output: canonical `+27XXXXXXXXX` form.
 *
 * Throws `BadRequestException` on anything else — Nest maps this to HTTP 400
 * automatically, so the util stays safe to call from any controller path
 * including future guest-checkout DTOs that may accept looser input.
 */

const SA_NATIONAL_RE = /^0\d{9}$/;
const SA_INTERNATIONAL_RE = /^\+27\d{9}$/;
const SA_INTERNATIONAL_NO_PLUS_RE = /^27\d{9}$/;

export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[\s\-()]/g, '');

  if (SA_INTERNATIONAL_RE.test(cleaned)) {
    return cleaned;
  }
  if (SA_INTERNATIONAL_NO_PLUS_RE.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (SA_NATIONAL_RE.test(cleaned)) {
    return `+27${cleaned.slice(1)}`;
  }

  throw new BadRequestException(
    'Invalid SA phone number. Expected 0XXXXXXXXX or +27XXXXXXXXX.',
  );
}
