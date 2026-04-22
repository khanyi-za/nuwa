# YIIVA — Order Module: Cart (Phase 3)

> Post-implementation reference for what shipped in Phase 3.
> Stack: NestJS + Prisma + PostgreSQL
> Companion to `order-module-foundation.md` (pre-code decisions) and `order-module-foundation-and-addresses.md` (Phases 1–2 implementation).

---

## Table of Contents

1. [Context](#context)
2. [Schema changes](#schema-changes)
   - [Comment fix on `Product.totalStock`](#comment-fix-on-producttotalstock)
   - [Concurrency hardening migration](#concurrency-hardening-migration-cart_item_bare_product_unique)
3. [Independent SKU model](#independent-sku-model)
4. [DTOs](#dtos)
5. [Stock primitives](#stock-primitives)
6. [CartService](#cartservice)
   - [Invariants](#invariants)
   - [Method surface](#method-surface)
   - [Cart view shape](#cart-view-shape)
7. [Controller](#controller)
8. [API endpoints](#api-endpoints-phase-3)
9. [Testing](#testing)
10. [Things Worth Knowing](#things-worth-knowing)
11. [File Inventory](#file-inventory)

---

## Context

Phase 3 delivers authenticated cart CRUD with soft stock reservation — the on-ramp to Phase 4 checkout. The `Cart` and `CartItem` models already existed in the base schema; Phase 3 adds no new tables, only a partial unique index to plug a concurrency hole around bare-product lines and a documentation fix on the `Product.totalStock` comment.

All cart writes bundle a stock movement (reserve on add/increase, release on decrease/remove) with the `CartItem` change in a single `$transaction`. Reserves use an optimistic conditional `UPDATE` — no row locks, no retry loop, 409 on contention.

Anonymous browsing **does not hit this service**. The frontend stashes items in `localStorage` until the buyer logs in (or is auto-created as a guest account at checkout), then replays each item via `POST /cart/items`. Server-side cart is always `userId`-keyed. This removes an entire class of orphan-cart concerns and keeps the `Cart.userId @unique` constraint clean.

**Pre-code decisions live in** the "Phase 3 — Cart" section of `docs/order-module/order-module-foundation.md`. This doc describes what was actually implemented, and captures post-decision refinements that surfaced during coding (notably the partial unique workaround for Prisma's compound-unique handling of nullable columns).

---

## Schema changes

### Comment fix on `Product.totalStock`

`prisma/schema.prisma:473-477`:

```prisma
// Inventory — bare SKU only. Each variant has independent stock.
// Product-overall availability = totalStock + Σ(variants.stock).
sku               String?
totalStock        Int     @default(0)
reservedStock     Int     @default(0)
```

Previous comment read `// Inventory (aggregated from variants if variants exist)` — the aggregate model, which is what Phase 3 decision #4 explicitly rejected. Comment-only change; no migration.

### Concurrency hardening migration `cart_item_bare_product_unique`

File: `prisma/migrations/20260416120000_cart_item_bare_product_unique/migration.sql`

```sql
CREATE UNIQUE INDEX "cart_items_bare_product_unique"
  ON "cart_items" ("cartId", "productId")
  WHERE "variantId" IS NULL;
```

Why this exists: the existing `@@unique([cartId, productId, variantId])` is enforced by Postgres' default `UNIQUE` (`NULLS DISTINCT`), which treats every `NULL` as distinct. Two bare-product adds for the same `(cartId, productId)` with `variantId = NULL` would both insert — breaking Phase 3 decision #2 (duplicate add increments quantity).

The partial unique closes the hole for the bare-SKU case only. The variant case is still covered by the original compound unique (variantId IS NOT NULL there).

Can't live in `schema.prisma` — partial indexes are Postgres-specific. Raw SQL migration, similar to the `addresses_one_default_per_user` partial index from Phase 2.

---

## Independent SKU model

Phase 3 decision #4 locks the inventory model as **independent SKUs**: the bare product (`variantId: null`) and each `ProductVariant` row each carry their own stock counts. Product-overall availability for display is `Product.totalStock + Σ(variants.stock)`.

**In the cart service, this means exactly one rule:**

- `variantId: null` → reserve / release against `Product.reservedStock` (table `products`, counter column `totalStock`).
- `variantId: "var-cuid"` → reserve / release against `ProductVariant.reservedStock` (table `product_variants`, counter column `stock`).

Note that the variant table's capacity column is `stock`, not `totalStock` — the stock primitive handles this asymmetry internally. Callers only pass `(productId, variantId | null, delta)`.

**Product-module follow-up (flagged, not blocking):** product detail pages in the Product module may still treat `Product.totalStock` as an aggregate. To display "available" on a product card correctly under the independent model, the Product module needs to compute `totalStock + Σ(variants.stock)`. Non-blocking for cart operations, which only touch the specific SKU being mutated.

---

## DTOs

Two DTOs, both intentionally minimal — cart item identity is just `(productId, variantId?)` and quantity is the only user-supplied value that changes.

**`AddCartItemDto`** (`src/order/dto/add-cart-item.dto.ts`):

| Field       | Validator                    |
|-------------|------------------------------|
| `productId` | `@IsString()`                |
| `variantId` | `@IsOptional() @IsString()`  |
| `quantity`  | `@IsInt() @Min(1)` — no upper bound; stock is the ceiling (decision #3) |

**`UpdateCartItemDto`** (`src/order/dto/update-cart-item.dto.ts`):

| Field      | Validator            |
|------------|----------------------|
| `quantity` | `@IsInt() @Min(1)`   |

Quantity is absolute, not a delta. `@Min(1)` means removing a line requires `DELETE /cart/items/:id`, not PATCH with 0.

---

## Stock primitives

`src/order/cart/stock.ts` exports two functions that are the only place raw SQL lives in the cart path:

```ts
reserveStock(tx, productId, variantId, delta): Promise<void>
releaseStock(tx, productId, variantId, delta): Promise<void>
```

**Reserve** — one conditional `UPDATE` (decision #5):

```sql
UPDATE "products"
   SET "reservedStock" = "reservedStock" + $1, "updatedAt" = NOW()
 WHERE "id" = $2 AND "reservedStock" + $1 <= "totalStock"
```

If rows-affected is 0, the stock ceiling would be breached — throw `ConflictException("Out of stock. Only available quantity can be reserved.")`. No locks, no deadlock, no retry. The variant-row form targets `product_variants` with `"stock"` as the capacity column.

**Release** — unconditional `UPDATE` with a `GREATEST(…, 0)` floor:

```sql
UPDATE "products"
   SET "reservedStock" = GREATEST("reservedStock" - $1, 0), "updatedAt" = NOW()
 WHERE "id" = $2
```

The `GREATEST` floor is defensive — giving stock back always succeeds, but we refuse to let a raced cron cleanup drive the counter negative.

Both primitives require a `Prisma.TransactionClient`, not a `PrismaService` — cart writes always bundle a stock change with a CartItem change inside the same `$transaction`. The type signature makes misuse a compile error.

Both primitives also guard against non-positive `delta` with a plain `Error` (not a Nest exception) — this is a developer mistake, not a user error; it should 500 loudly, not 400 politely.

---

## CartService

`src/order/cart/cart.service.ts` — `CartService` owns five public methods plus two private helpers.

### Invariants

1. **Server-side, one `Cart` per `userId`.** Enforced by `Cart.userId @unique`. Anonymous browsing never touches this service.

2. **Lazy cart creation.** `GET /cart` on a cartless user returns an empty grouped shape (`stores: []`, `grandSubtotalInCents: 0`, `itemCount: 0`). The `Cart` row is created on first `POST /cart/items` via `cart.upsert({ create: { userId }, update: {} })`.

3. **Duplicate add increments quantity.** Uses `findFirst + create-or-update` rather than `upsert` because Prisma's compound-unique input rejects `variantId: null` at the TypeScript level (see "Things Worth Knowing #1"). DB-level uniqueness is enforced by the partial unique index + the original compound unique.

4. **Independent SKU stock routing.** `variantId ?? null` flows through to `reserveStock` / `releaseStock`, which routes to the correct table and capacity column.

5. **Stock movement before cart-item write.** `reserveStock` runs first inside the transaction. If it throws 409, the create/update never executes and the tx rolls back cleanly. No stale reservation possible.

6. **Reads never mutate.** `GET /cart` renders each item with one of three statuses — `"available"`, `"unavailable"`, `"partial_stock"` — but never deletes, updates, or prunes. Checkout is the source of truth for correctness.

7. **404-not-403 on cross-user access.** `assertCartItemOwned` returns `NotFoundException` whether the item doesn't exist or belongs to another buyer. Matches Phase 2's address ownership semantics.

8. **Ownership guard runs inside the transaction.** `assertCartItemOwned` takes a `Prisma.TransactionClient`. Called inside `$transaction` for `updateItem` / `removeItem`, preventing a concurrent `DELETE` from being effectively resurrected by a raced PATCH.

### Method surface

| Method        | Runs in txn? | Notes                                                                                 |
|---------------|:-----------:|----------------------------------------------------------------------------------------|
| `get`         | no          | `findUnique` with nested includes, builds grouped view, empty shape on no-cart         |
| `addItem`     | yes         | validate product + variant outside txn → upsert cart → reserve → findFirst → create or increment |
| `updateItem`  | yes         | ownership inside txn → compute delta → reserve (up) / release (down) / no-op → update  |
| `removeItem`  | yes         | ownership inside txn → release full line quantity → delete                             |
| `clear`       | yes         | findUnique(items) → per-item release → `deleteMany`. No-op on cartless or empty state. |

Product + variant validation in `addItem` happens **outside** the transaction. Rationale: a 404 for a missing product or a 400 for a mismatched variant shouldn't open a DB transaction. Same "malformed input short-circuits before txn" pattern as `normalizePhone` in `AddressService.update`.

### Cart view shape

The `CartView` type is what every cart-returning endpoint produces — both reads and post-mutation responses. One shape, one builder (`buildCartView`).

```ts
type CartItemView = {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string;
  productSlug: string;
  variantName: string | null;
  thumbnailUrl: string | null;
  unitPriceInCents: number;
  quantity: number;
  lineTotalInCents: number;
  status: 'available' | 'unavailable' | 'partial_stock';
  availableQuantity: number;
};

type CartStoreView = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  items: CartItemView[];
  subtotalInCents: number;
};

type CartView = {
  stores: CartStoreView[];
  grandSubtotalInCents: number;
  itemCount: number;
};
```

**Unit price resolution:** `item.variant?.priceInCents ?? item.product.priceInCents`. Variant prices are optional overrides; missing override falls through to the product price.

**Status logic:**

- `"unavailable"` — `product.status !== ACTIVE`. Takes precedence over stock state.
- `"partial_stock"` — product is ACTIVE but `availableQuantity < item.quantity`. Means an admin reduced `totalStock` below the sum of existing reservations; other reservations take priority and this line's allocation shrinks.
- `"available"` — normal case.

**`availableQuantity`** — how many units *this line* can actually ship, capped at `item.quantity`:

```
otherReservations  = max(0, totalReserved - item.quantity)
availableQuantity  = max(0, min(item.quantity, totalCapacity - otherReservations))
```

In the healthy case (`totalReserved ≤ totalCapacity`), this equals `item.quantity`. The cap prevents misleading "you can have 15" messaging when the buyer only asked for 2.

**Grouping:** items are bucketed by `product.storeId` using a `Map`, iteration order preserved. Per-store `subtotalInCents` and the `grandSubtotalInCents` roll up from `lineTotalInCents`.

**Prices are live** (Phase 3 decision #8). No snapshot column on `CartItem`. Prices follow the catalog until checkout locks them on `OrderItem`. A penny-off race during read is acceptable — checkout is the source of truth for money.

---

## Controller

`src/order/cart/cart.controller.ts` — `CartController`.

- Route prefix: `@Controller('cart')`.
- `@UseGuards(RolesGuard) @Roles(UserRole.BUYER)` — BUYER-only. JWT auth is applied globally via `APP_GUARD` in `AuthModule`.
- `@CurrentUser('id')` extracts the user's id from the decoded JWT.
- Every endpoint returns `CartView`, including `POST /items`, `PATCH`, `DELETE` single, and `DELETE /cart`. The frontend always gets the full post-mutation state back — no separate GET needed after a mutation.

---

## API endpoints (Phase 3)

| Method   | Path                  | Auth        | Status | Description                                                 |
|----------|-----------------------|-------------|--------|-------------------------------------------------------------|
| `GET`    | `/cart`               | JWT + BUYER | 200    | Grouped cart view; empty shape if no cart                   |
| `POST`   | `/cart/items`         | JWT + BUYER | 201    | Add item; duplicates increment quantity; 409 on out-of-stock |
| `PATCH`  | `/cart/items/:itemId` | JWT + BUYER | 200    | Absolute quantity; reserves delta up or releases delta down |
| `DELETE` | `/cart/items/:itemId` | JWT + BUYER | 200    | Remove line; releases full line quantity                    |
| `DELETE` | `/cart`               | JWT + BUYER | 200    | Clear cart; releases all reservations in one tx             |

All mutation responses return the freshly built `CartView` so the frontend can replace its state in one round-trip.

---

## Testing

Unit tests only. Integration / e2e is deferred to a later consolidated pass (same as Phase 2).

### `src/order/cart/stock.spec.ts`

10 tests. Mocks the `tx.$executeRaw` tagged template, asserts:

- Raw SQL targets `"products"` with `"totalStock"` when `variantId` is null.
- Raw SQL targets `"product_variants"` with `"stock"` when `variantId` is set.
- `reserveStock` surfaces 0 rows-affected as `ConflictException`.
- `releaseStock` uses `GREATEST`, does not throw on 0 rows-affected.
- Both reject non-positive deltas with a plain `Error` (programmer guard).

### `src/order/cart/cart.service.spec.ts`

20 tests. `PrismaService` is mocked; `$transaction` is mocked to invoke its callback with the same mock acting as `tx`; the `./stock` module is mocked via `jest.mock` so we assert call shape rather than re-exercising raw SQL.

Coverage map:

| Area        | Scenarios                                                                                                                                 |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `get`       | Empty shape on cartless user; grouped-by-store + subtotals across multi-store cart; `"unavailable"` flag on ARCHIVED product; `"partial_stock"` when capacity reduced below reservations; variant price override; variant price fallback to product |
| `addItem`   | First-time add creates a line; duplicate add increments quantity; variant must belong to product (400); non-ACTIVE product 404; missing product 404; out-of-stock 409 from `reserveStock` propagates |
| `updateItem`| Quantity-up reserves delta; quantity-down releases delta; unchanged quantity is a no-op on stock; variant routing; 404 on cross-user; 404 on missing item |
| `removeItem`| Releases full line quantity then deletes; 404 on cross-user                                                                                 |
| `clear`     | Releases per-line then `deleteMany`; no-op on cartless user; no-op on empty cart                                                            |

**Run:** `npx jest src/order` → **63/63 passing** (Phases 1–3 combined, ~0.6s).

---

## Things Worth Knowing

### 1. Prisma's compound unique with nullable columns requires a workaround

The schema has `@@unique([cartId, productId, variantId])`, but Prisma generates the compound unique input type as `{ cartId: string; productId: string; variantId: string }` — non-nullable. You can't call `tx.cartItem.upsert({ where: { cartId_productId_variantId: { ..., variantId: null } } })` without a type error.

Two consequences:

1. **The upsert path is rewritten as `findFirst + create-or-update`** in `addItem`, so null `variantId` works at the TypeScript layer.
2. **DB uniqueness is enforced with a partial unique index** for the bare-product case (`cart_items_bare_product_unique`), because Postgres' default `UNIQUE` treats NULLs as distinct and wouldn't enforce the invariant on its own.

If Prisma ever fixes the compound-unique-with-null type handling, the service code can swap back to `upsert` — the partial index is still correct and necessary (it's about Postgres NULL semantics, not Prisma).

### 2. `reservedStock` can legitimately exceed `totalStock`

Not under normal cart flow — the optimistic conditional `UPDATE` makes over-reservation impossible at the reserve path. It can happen when:

- An admin reduces `Product.totalStock` below the current `reservedStock` (inventory correction, sudden shortage).
- A bug in some other code path reserves without going through `reserveStock` (future vigilance).

The cart view handles this by flipping affected lines to `"partial_stock"` and showing an `availableQuantity` less than `item.quantity`. Checkout (Phase 4) will enforce hard correctness — a `"partial_stock"` line can't go through to order creation at its requested quantity.

### 3. No server-side guest cart — by design

Phase 3 decision #11 chose the frontend `localStorage` stash over a server-side guest cart. Two implications worth remembering:

- The `Cart.userId @unique` constraint is absolute — no nullable-userId carve-out, no `sessionToken` column.
- Stock is only reserved once items hit the server. A logged-out browser holding items in `localStorage` does not block other buyers from buying the same units. This is a feature, not a bug — it keeps reservation pressure scoped to committed (authenticated) intent.
- Merge-on-login is a frontend-driven sequence: for each stashed item, POST `/cart/items`. Partial failure (some succeed, some 409 on stock) is normal and surfaced per-item by the frontend. The backend does not batch, transact, or coordinate the merge.

### 4. Raw SQL in `stock.ts` is the only raw-SQL surface in the Orders module

Everything else goes through Prisma's query builder. The raw SQL here is deliberate — the optimistic conditional UPDATE (`SET x = x + Δ WHERE x + Δ <= capacity`) can't be expressed with Prisma's update primitives, which don't support column-relative WHERE predicates in the same statement. Keep raw SQL isolated to this file; if you find yourself reaching for `$executeRaw` elsewhere, first check whether the query builder can express the intent.

### 5. Stock reservation is not the same as inventory truth

`reservedStock` tracks *intent-to-buy* across open carts. It's consumed by the stock ceiling on the reserve path and released on cart exits (remove, clear, cron cleanup). Hard inventory decrement — the actual reduction of `totalStock` — happens at payment completion in Phase 4, against `Payment` transitioning to `COMPLETED`. At that point both `totalStock` and `reservedStock` drop by the order's quantity in lockstep.

The Phase 8 stale-cart cron (deferred) releases reservations for carts untouched for 24h and orders stuck in PENDING for >30min. Until Phase 8 ships, reservations can accumulate from abandoned carts — acceptable for dev/staging, not for production.

### 6. Validation lives at three different layers — on purpose

- **DTO layer** (class-validator) — shape + basic types + range. Fast-fail at the request edge.
- **Service layer** (`addItem`) — product existence, product status ACTIVE, variant-belongs-to-product. Domain-level semantic checks.
- **DB layer** (partial unique + conditional UPDATE) — race-safe uniqueness and stock ceiling.

Each layer catches a different failure mode. Removing any one of them opens a window the others don't cover. The conditional UPDATE is especially load-bearing — it's the only thing stopping two concurrent adds from both over-reserving the last unit.

---

## File Inventory

### Files added

```
docs/order-module/order-module-cart.md                                          # this doc

prisma/migrations/20260416120000_cart_item_bare_product_unique/migration.sql

src/order/cart/stock.ts
src/order/cart/stock.spec.ts
src/order/cart/cart.service.spec.ts
src/order/dto/add-cart-item.dto.ts
src/order/dto/update-cart-item.dto.ts
```

### Files rewritten (from Phase 1 placeholders)

```
src/order/cart/cart.service.ts
src/order/cart/cart.controller.ts
```

### Files modified

```
prisma/schema.prisma                    # Product.totalStock comment updated for independent SKU model
docs/order-module/order-module-foundation.md   # Phase 3 section added to Phase Decisions Log
```

---

## References

- Pre-code decisions: `docs/order-module/order-module-foundation.md` (Phase 3 section)
- Phases 1–2 implementation: `docs/order-module/order-module-foundation-and-addresses.md`
- YIIVA philosophy: `docs/about_yiiva.md`
- Auth patterns: `docs/auth-guide.md`
