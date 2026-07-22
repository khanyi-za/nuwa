import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM helpers for Shopify Admin API tokens at rest.
 * Wire format: base64url(iv).base64url(ciphertext).base64url(authTag) —
 * self-describing, no schema change needed if we ever add fields.
 */

export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptToken(encrypted: string, key: Buffer): string {
  const [ivB64, ctB64, tagB64] = encrypted.split('.');
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error('Malformed encrypted token');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
