/**
 * Byte-for-byte equivalent of PHP's urlencode() function.
 *
 * PayFast's signature algorithm uses PHP's urlencode() to canonicalize values
 * before MD5. Node's built-in encoders all differ from PHP in subtle ways that
 * produce mismatched signatures:
 *
 *   - encodeURIComponent: leaves ! ' ( ) * ~ unencoded, uses %20 for space
 *   - querystring.escape: same as encodeURIComponent (Node 11+)
 *   - URLSearchParams: encodes * differently, uses + for space
 *
 * PHP's urlencode():
 *   - Encodes everything except A-Z a-z 0-9 - _ .
 *   - Uses + for space
 *   - Uppercase hex %XX
 *
 * Implementation: start from encodeURIComponent (which handles UTF-8 byte
 * sequences correctly) and patch the six chars it misses, then swap %20 → +.
 *
 * IMPORTANT: any change here must keep all url-encode.spec.ts vectors green.
 * A single-byte mismatch causes silent signature failures in production.
 */
export function phpUrlencode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/%20/g, '+');
}
