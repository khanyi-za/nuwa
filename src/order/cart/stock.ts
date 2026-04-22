import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Stock reservation primitives for cart operations.
 *
 * Routes writes to either the `products` or `product_variants` row based on
 * the independent SKU model (Phase 3 decision #4):
 *   - `variantId` null → reserve on `Product.reservedStock` (bare SKU)
 *   - `variantId` set  → reserve on `ProductVariant.reservedStock` (variant SKU)
 *
 * Reserve uses a single optimistic conditional `UPDATE` (decision #5):
 *   UPDATE … SET reservedStock = reservedStock + Δ
 *    WHERE id = ? AND reservedStock + Δ <= totalStock
 *
 * If rows-affected is 0, someone else grabbed the stock — we throw a 409
 * instead of retrying. No row-level locks, no deadlock risk.
 *
 * Release is unconditional (decision #6) with a `GREATEST(…, 0)` floor so a
 * raced cron cleanup can't drive the column negative.
 *
 * All functions require a transaction client because cart mutations always
 * bundle a stock change with a CartItem write in the same `$transaction`.
 */

export async function reserveStock(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<void> {
  if (delta <= 0) {
    throw new Error(`reserveStock called with non-positive delta ${delta}`);
  }

  const rowsAffected = variantId
    ? await tx.$executeRaw`
        UPDATE "product_variants"
           SET "reservedStock" = "reservedStock" + ${delta},
               "updatedAt"     = NOW()
         WHERE "id" = ${variantId}
           AND "reservedStock" + ${delta} <= "stock"
      `
    : await tx.$executeRaw`
        UPDATE "products"
           SET "reservedStock" = "reservedStock" + ${delta},
               "updatedAt"     = NOW()
         WHERE "id" = ${productId}
           AND "reservedStock" + ${delta} <= "totalStock"
      `;

  if (rowsAffected === 0) {
    throw new ConflictException(
      'Out of stock. Only available quantity can be reserved.',
    );
  }
}

export async function releaseStock(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<void> {
  if (delta <= 0) {
    throw new Error(`releaseStock called with non-positive delta ${delta}`);
  }

  if (variantId) {
    await tx.$executeRaw`
      UPDATE "product_variants"
         SET "reservedStock" = GREATEST("reservedStock" - ${delta}, 0),
             "updatedAt"     = NOW()
       WHERE "id" = ${variantId}
    `;
  } else {
    await tx.$executeRaw`
      UPDATE "products"
         SET "reservedStock" = GREATEST("reservedStock" - ${delta}, 0),
             "updatedAt"     = NOW()
       WHERE "id" = ${productId}
    `;
  }
}
