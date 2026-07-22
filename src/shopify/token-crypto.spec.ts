import { randomBytes } from 'crypto';
import { decryptToken, encryptToken } from './token-crypto';

describe('token-crypto', () => {
  const key = randomBytes(32);

  it('round-trips a token', () => {
    const token = 'shpat_abcdef0123456789abcdef0123456789';
    const enc = encryptToken(token, key);
    expect(enc).not.toContain('shpat_');
    expect(enc.split('.')).toHaveLength(3);
    expect(decryptToken(enc, key)).toBe(token);
  });

  it('produces distinct ciphertexts per call (random IV)', () => {
    const token = 'shpat_same_token';
    expect(encryptToken(token, key)).not.toBe(encryptToken(token, key));
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const enc = encryptToken('shpat_x', key);
    const [iv, ct, tag] = enc.split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 0xff;
    expect(() =>
      decryptToken([iv, flipped.toString('base64url'), tag].join('.'), key),
    ).toThrow();
  });

  it('rejects the wrong key', () => {
    const enc = encryptToken('shpat_x', key);
    expect(() => decryptToken(enc, randomBytes(32))).toThrow();
  });

  it('rejects malformed input', () => {
    expect(() => decryptToken('not-a-token', key)).toThrow(/Malformed/);
  });
});
