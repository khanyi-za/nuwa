-- Partial unique index for bare-product cart lines (variantId IS NULL).
--
-- The existing `@@unique([cartId, productId, variantId])` compound unique
-- is enforced by Postgres' default UNIQUE (NULLS DISTINCT), which treats
-- every NULL as distinct. That means two `(cartId, productId, NULL)` rows
-- can coexist — breaking Phase 3 decision #2 (duplicate add increments
-- quantity) for bare products.
--
-- This partial index closes that hole: for the bare-SKU case only, the
-- (cartId, productId) pair must be unique. The existing compound unique
-- already covers the variant case (variantId IS NOT NULL).
--
-- Can't be expressed in schema.prisma — partial indexes are Postgres-only.

CREATE UNIQUE INDEX "cart_items_bare_product_unique"
  ON "cart_items" ("cartId", "productId")
  WHERE "variantId" IS NULL;
