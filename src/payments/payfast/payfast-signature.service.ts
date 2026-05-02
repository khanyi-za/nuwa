import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { FORM_FIELD_ORDER } from './field-order';
import { phpUrlencode } from './url-encode';

/**
 * PayfastSignatureService — pure cryptographic primitives for PayFast.
 *
 * Three distinct algorithms PayFast uses, all share MD5 + phpUrlencode but
 * differ in field ordering and trim behavior:
 *
 *   1. Form-flow signing (signFormPayload)
 *      - Iterate FORM_FIELD_ORDER, skip empty values
 *      - urlencode(trim(value)) per field
 *      - passphrase included as a regular field at its fixed position
 *      - MD5 the joined param string
 *
 *   2. ITN verification (verifyItnSignature)
 *      - Iterate parsed body in insertion order, BREAK at signature field
 *      - urlencode(value) — NO trim
 *      - Append &passphrase=urlencode(passphrase) if set — NO trim
 *      - MD5 and constant-time compare to received signature
 *
 *   3. API-flow signing (signApiRequest)
 *      - Merge headers + query + body, ksort alphabetically
 *      - urlencode(value) — NO trim
 *      - passphrase added to merged dict before sort
 *      - MD5 the joined param string
 *
 * Source: PayFast PHP SDK, lib/Auth.php and lib/PaymentIntegrations/Notification.php.
 */
@Injectable()
export class PayfastSignatureService {
  /**
   * Generate the signature for a PayFast form-flow (redirect) payload.
   *
   * @param fields  Form fields keyed by PayFast field name. Unknown keys are silently ignored.
   * @param passphrase  Merchant passphrase; omitted from signature input if empty.
   * @returns 32-char lowercase hex MD5
   */
  signFormPayload(fields: Record<string, string>, passphrase: string): string {
    const parts: string[] = [];
    for (const key of FORM_FIELD_ORDER) {
      const raw = key === 'passphrase' ? passphrase : fields[key];
      if (raw === undefined || raw === null) continue;
      const trimmed = String(raw).trim();
      if (trimmed === '') continue;
      parts.push(`${key}=${phpUrlencode(trimmed)}`);
    }
    return md5(parts.join('&'));
  }

  /**
   * Generate the signature for a PayFast REST API request (refunds, history).
   *
   * Signature input = headers ∪ query ∪ body, sorted alphabetically by key,
   * urlencoded values, joined with &. The `signature` key in any input dict
   * is excluded (it's the output, not an input).
   *
   * @param headers  HTTP headers that participate in signing (merchant-id, version, timestamp).
   * @param query    Query-string parameters (none for refunds; varies by endpoint).
   * @param body     JSON body payload as a flat object.
   * @param passphrase  Merchant passphrase; omitted from signature input if empty.
   * @returns 32-char lowercase hex MD5
   */
  signApiRequest(
    headers: Record<string, string>,
    query: Record<string, string>,
    body: Record<string, unknown>,
    passphrase: string,
  ): string {
    const merged: Record<string, string> = {};
    const sources = [headers, query, body];
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) {
        if (k === 'signature') continue;
        if (v === undefined || v === null) continue;
        merged[k] = String(v);
      }
    }
    if (passphrase && passphrase.trim() !== '') {
      merged.passphrase = passphrase.trim();
    }
    const sortedKeys = Object.keys(merged).sort();
    const parts: string[] = [];
    for (const key of sortedKeys) {
      parts.push(`${key}=${phpUrlencode(merged[key])}`);
    }
    return md5(parts.join('&'));
  }

  /**
   * Verify the signature on an incoming ITN payload.
   *
   * Implements the PHP SDK's pfValidSignature + dataToString:
   *   - Iterate parsedBody in insertion order
   *   - Break at the `signature` field (do not include trailing fields)
   *   - urlencode(value) — NO trim
   *   - Append &passphrase=urlencode(passphrase) if set
   *   - MD5, constant-time compare to received signature
   *
   * @param parsedBody  Form-decoded ITN body. Must include `signature`.
   * @param passphrase  Merchant passphrase configured for signing.
   * @returns true iff signatures match
   */
  verifyItnSignature(
    parsedBody: Record<string, string>,
    passphrase: string,
  ): boolean {
    const received = parsedBody.signature;
    if (!received || typeof received !== 'string') return false;

    const paramString = this.buildItnParamString(parsedBody);
    const withPassphrase =
      passphrase && passphrase !== ''
        ? `${paramString}&passphrase=${phpUrlencode(passphrase)}`
        : paramString;
    const expected = md5(withPassphrase);

    return constantTimeEqual(expected, received);
  }

  /**
   * Build the body to POST back to PayFast's /eng/query/validate endpoint.
   *
   * Same as the signature input string — all fields up to (not including)
   * signature, urlencoded, joined with &. No passphrase appended.
   * PayFast's server compares this body to the data they originally sent us;
   * a mismatch returns 'INVALID' instead of 'VALID'.
   */
  buildPostbackBody(parsedBody: Record<string, string>): string {
    return this.buildItnParamString(parsedBody);
  }

  /** Internal: shared between verifyItnSignature and buildPostbackBody. */
  private buildItnParamString(parsedBody: Record<string, string>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(parsedBody)) {
      if (key === 'signature') break; // SDK pattern: stop at signature, do not just skip
      if (value === undefined || value === null) continue;
      parts.push(`${key}=${phpUrlencode(String(value))}`);
    }
    return parts.join('&');
  }
}

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
