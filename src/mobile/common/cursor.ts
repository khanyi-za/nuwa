import { BadRequestException } from '@nestjs/common';

/**
 * Opaque cursor helpers for the mobile feed-style endpoints. We cursor on the
 * row `id` (unique) with a stable `[createdAt desc, id desc]` ordering — Prisma
 * `cursor: { id }, skip: 1` then handles the windowing. The token is just the
 * base64url-encoded id so the client treats it as opaque.
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(token: string): string {
  let id = '';
  try {
    id = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    id = '';
  }
  if (!id) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is invalid or expired.',
    });
  }
  return id;
}

/**
 * Plain-offset cursor for endpoints whose ordering is fully DETERMINISTIC
 * (new-arrivals: brand-diverse recency, no shuffle) — the token only carries
 * how many rows the client has consumed. Same opaque contract as the others.
 */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(`o1:${offset}`, 'utf8').toString('base64url');
}

export function decodeOffsetCursor(token: string): number {
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    decoded = '';
  }
  const match = /^o1:(\d+)$/.exec(decoded);
  if (!match) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is invalid or expired.',
    });
  }
  return Number(match[1]);
}

/**
 * Discovery-feed cursor: carries the shuffle seed + the row offset so a scroll
 * session keeps one stable arrangement while a fresh load (no cursor) reshuffles.
 * Same opaque-token contract as `encodeCursor` — clients never see the parts.
 */
export function encodeDiscoveryCursor(seed: string, offset: number): string {
  return Buffer.from(`d1:${seed}:${offset}`, 'utf8').toString('base64url');
}

export function decodeDiscoveryCursor(token: string): {
  seed: string;
  offset: number;
} {
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    decoded = '';
  }
  const match = /^d1:([0-9a-f]+):(\d+)$/.exec(decoded);
  if (!match) {
    throw new BadRequestException({
      code: 'INVALID_CURSOR',
      message: 'The pagination cursor is invalid or expired.',
    });
  }
  return { seed: match[1], offset: Number(match[2]) };
}
