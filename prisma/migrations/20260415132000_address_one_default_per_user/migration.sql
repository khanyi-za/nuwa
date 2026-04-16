-- Enforce: a user has at most one active default address.
-- Partial unique index (Postgres-specific) — not expressible in schema.prisma.
-- Protects against the concurrent-create race where two transactions both see
-- zero existing addresses and both write isDefault=true.
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("userId")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;
