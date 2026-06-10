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
