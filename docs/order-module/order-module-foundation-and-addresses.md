# YIIVA — Order Module: Foundation + Address Management (Phases 1–2)

> Post-implementation reference for what shipped in Phases 1 and 2.
> Stack: NestJS + Prisma + PostgreSQL
> Companion to `order-module-foundation.md` (pre-code decisions doc).

---

## Table of Contents

1. [Context](#context)
2. [Phase 1 — Foundation](#phase-1--foundation)
   - [Schema migration](#schema-migration-add_orders_module_foundation)
   - [Module scaffold](#module-scaffold)
   - [Contract interfaces](#contract-interfaces)
   - [Stub service pattern](#stub-service-pattern)
   - [Order number generator](#order-number-generator)
   - [Module registration](#module-registration)
3. [Phase 2 — Address Management](#phase-2--address-management)
   - [Schema migration](#schema-migration-add_address_soft_delete)
   - [Concurrency hardening migration](#concurrency-hardening-migration-address_one_default_per_user)
   - [DTOs](#dtos)
   - [Phone normalization](#phone-normalization)
   - [Service rules](#service-rules)
   - [Controller](#controller)
   - [API endpoints](#api-endpoints-phase-2)
4. [Testing](#testing)
5. [Things Worth Knowing](#things-worth-knowing)
6. [File Inventory](#file-inventory)

---

## Context

Phase 1 is pure scaffolding — schema migrations, module layout, contract stubs, utility code. Zero endpoints shipped. Its job is to make Phases 2+ (and later, Payments + Shipping) possible without re-debating architectural patterns mid-feature.

Phase 2 ships the first real Order-module functionality: buyer-facing address CRUD. Addresses are a hard prerequisite for checkout — a buyer can't place an order without a delivery destination. Phase 2 is intentionally small and isolated: no dependencies on Products, Payments, or Shipping, only the User model and a single new field.

**Pre-code decisions for both phases live in** `docs/order-module/order-module-foundation.md`. This doc describes what was *actually implemented* after those decisions were locked, and captures the small number of post-decision refinements that surfaced during review (notably the partial unique index in Phase 2).

---

## Phase 1 — Foundation

### Schema migration `add_orders_module_foundation`

File: `prisma/migrations/20260415131507_add_orders_module_foundation/migration.sql`

Six related schema changes in one migration:

#### 1. New `PaymentGroup` model

One PayFast transaction can cover multiple Orders (multi-brand cart → multi-order checkout). `PaymentGroup` owns every field that describes the **transaction** — ITN payload, signature, PayFast IDs, buyer info, method. `Payment` owns only the per-order slice.

```prisma
model PaymentGroup {
  id                 String        @id @default(cuid())
  mPaymentId         String        @unique
  pfPaymentId        String?
  status             PaymentStatus @default(PENDING)

  amountGrossInCents Int
  amountFeeInCents   Int           @default(0)
  amountNetInCents   Int

  method             PaymentMethod?

  pfSignature        String?
  itnPayload         Json?
  pfToken            String?
  pfNameFirst        String?
  pfNameLast         String?
  pfEmailAddress     String?

  paidAt             DateTime?
  failedAt           DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  payments           Payment[]

  @@index([mPaymentId])
  @@index([status])
  @@map("payment_groups")
}
```

#### 2. `Payment` refactored

All PayFast-transaction fields (`mPaymentId`, `pfPaymentId`, `paymentStatus`, `merchantId`, `customStr*`, `customInt*`, `pfName*`, `pfEmailAddress`, `pfToken`, `pfSignature`, `itnPayload`, `method`, `failedAt`) were **dropped**. They live on `PaymentGroup` now. Three eager-commission fields were added so payout math is locked at payment time:

```prisma
model Payment {
  id                        String        @id @default(cuid())
  orderId                   String        @unique
  paymentGroupId            String

  status                    PaymentStatus @default(PENDING)

  amountGrossInCents        Int
  amountFeeInCents          Int           @default(0) // proportional PayFast fee
  amountNetInCents          Int

  platformCommissionInCents Int           @default(0) // locked YIIVA take
  merchantPayoutInCents     Int           @default(0) // amountNet - commission

  refundedAmountInCents     Int           @default(0)

  paidAt                    DateTime?
  refundedAt                DateTime?
  createdAt                 DateTime      @default(now())
  updatedAt                 DateTime      @updatedAt

  order                     Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  paymentGroup              PaymentGroup  @relation(fields: [paymentGroupId], references: [id], onDelete: Cascade)

  @@index([paymentGroupId])
  @@index([status])
  @@map("payments")
}
```

Rationale for eager math: if YIIVA changes the commission rate later, historical Payments stay locked at the rate that was in effect when they were paid. Payout cron becomes a dumb `SUM(merchantPayoutInCents)` — no retroactive recompute.

#### 3. Stock reservation columns

```prisma
model Product {
  totalStock    Int @default(0)
  reservedStock Int @default(0) // NEW
}

model ProductVariant {
  stock         Int @default(0)
  reservedStock Int @default(0) // NEW
}
```

Available stock is **computed** (`totalStock - reservedStock`), never stored. All mutations go through guarded `updateMany` with the available-stock check in the `WHERE` clause — see `order-module-foundation.md` Pattern 3 for the canonical pattern.

#### 4. `StoreDispatchAddress`

Separate from `StoreAddress` because dispatch locations need full logistics fields (province, pickup contact, lat/lng) and should not leak into the public store profile.

```prisma
model StoreDispatchAddress {
  id           String   @id @default(cuid())
  storeId      String
  label        String?

  contactName  String   // ShipLogic pickup contact
  contactPhone String

  addressLine1 String
  addressLine2 String?
  suburb       String?
  city         String
  province     String
  postalCode   String
  country      String   @default("South Africa")

  latitude     Float?
  longitude    Float?

  isPrimary    Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  store        Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  orders       Order[]

  @@index([storeId])
  @@map("store_dispatch_addresses")
}
```

Reverse relation `dispatchAddresses StoreDispatchAddress[]` added to `Store`.

**Not yet wired:** the foundation doc mentioned `shipments Shipment[]` on `StoreDispatchAddress`. That relation is deferred until the Shipping module adds a `dispatchAddressId` column to `Shipment`. `orders` alone is enough for the Order audit-trail relation.

#### 5. `User.isGuestAccount`

```prisma
model User {
  isGuestAccount Boolean @default(false) // NEW
}
```

Enables guest checkout (Pattern B — auto-created guest User). Claim flow in Phase 6 flips this back to `false` and promotes `accountStatus` to `ACTIVE`.

#### 6. Order shipping fields

```prisma
model Order {
  shippingQuoteId           String?
  shippingServiceTier       String?               // "ECO" / "LOF" / "LOX"
  shippingDispatchAddressId String?

  dispatchAddress           StoreDispatchAddress? @relation(fields: [shippingDispatchAddressId], references: [id])
}
```

`shippingDispatchAddressId` is an **audit-trail** FK — if the merchant later deletes or edits their dispatch address, historical orders must retain their origin for refund disputes and courier investigations.

> ⚠️ **Known follow-up:** Prisma generated `ON DELETE SET NULL` for this FK (default for optional relations). That defeats the audit-trail intent. Revisit when the Shipping module plans dispatch-address CRUD — candidates are `ON DELETE RESTRICT` or soft-deleting `StoreDispatchAddress`.

### Module scaffold

Final layout under `src/order/`:

```
src/order/
├── order.module.ts
├── order.service.ts                        # placeholder
├── order.controller.ts                     # placeholder
├── address/
│   ├── address.service.ts                  # Phase 2 — real
│   ├── address.service.spec.ts             # Phase 2 — unit tests
│   └── address.controller.ts               # Phase 2 — real
├── cart/
│   ├── cart.service.ts                     # Phase 3 — placeholder
│   └── cart.controller.ts                  # Phase 3 — placeholder
├── checkout/
│   ├── checkout.service.ts                 # Phase 4 — placeholder (wires stubs)
│   └── checkout.controller.ts              # Phase 4 — placeholder
├── contracts/
│   ├── payment-contract.ts
│   ├── shipping-contract.ts
│   └── stubs/
│       ├── payment-stub.service.ts
│       └── shipping-stub.service.ts
├── dto/
│   ├── sa-provinces.ts
│   ├── create-address.dto.ts
│   └── update-address.dto.ts
└── utils/
    ├── order-number.ts
    ├── phone.ts
    └── phone.spec.ts
```

Placeholders are importable and register in `OrderModule`, but their methods are empty (or constructor-only). They're filled in their target phases.

### Contract interfaces

`src/order/contracts/shipping-contract.ts` and `src/order/contracts/payment-contract.ts` define the thin interface surface the Order module needs from Shipping and Payments respectively.

**Shipping contract:**

```typescript
export type ShippingServiceTier = 'ECO' | 'LOF' | 'LOX' | 'NFS';

export interface ShippingRateRequest { /* dispatchAddressId, destination, weight, tier */ }
export interface ShippingRateResponse { /* quoteId, rateInCents, estimatedDeliveryDate */ }

export interface IShippingService {
  getRate(req: ShippingRateRequest): Promise<ShippingRateResponse>;
}

export const SHIPPING_SERVICE = 'SHIPPING_SERVICE';
```

**Payment contract:**

```typescript
export interface PaymentInitRequest { orderIds: string[]; /* + amount, buyer, URLs */ }
export interface PaymentInitResponse { paymentGroupId: string; mPaymentId: string; payfastRedirectUrl: string; }

export interface IPaymentService {
  initializePayment(req: PaymentInitRequest): Promise<PaymentInitResponse>;
}

export const PAYMENT_SERVICE = 'PAYMENT_SERVICE';
```

Tokens are exported from the contract files — a single source of truth (token + interface + request/response types all co-located). Consumers import both the token (for `@Inject()`) and the type (for the injected property signature).

> Project convention: because `isolatedModules + emitDecoratorMetadata` is on, injected interface types must use `import type`:
>
> ```typescript
> import { SHIPPING_SERVICE } from '../contracts/shipping-contract';
> import type { IShippingService } from '../contracts/shipping-contract';
> ```
>
> See `checkout.service.ts` for the canonical usage.

### Stub service pattern

Both stubs in `src/order/contracts/stubs/` throw `NotImplementedException` for every method. Bindings in `OrderModule`:

```typescript
{ provide: SHIPPING_SERVICE, useClass: ShippingStubService },
{ provide: PAYMENT_SERVICE, useClass: PaymentStubService },
```

When Shipping and Payments ship, the only change needed is swapping `useClass` to the real services. No consumer code changes.

### Order number generator

`src/order/utils/order-number.ts` — produces display identifiers like `YV-2026-A4F2K`.

- Alphabet: 32 chars (Crockford-style base32), excluding `I`, `L`, `O`, `U` to avoid read-aloud and typing ambiguity.
- Random segment: 5 chars (32⁵ ≈ 33.5M combinations per year).
- RNG: `crypto.randomInt` (CSPRNG, unbiased).
- No retry loop in the util — collision retry is the caller's responsibility (catch Prisma `P2002` on insert → regenerate → retry). This keeps the util pure and easy to mock.

`Order.orderNumber` is a **display** identifier only. Internal relations use `Order.id` (CUID).

### Module registration

`src/order/order.module.ts`:

```typescript
@Module({
  imports: [StoreModule, ProductModule],
  controllers: [
    OrderController,
    AddressController,
    CartController,
    CheckoutController,
    // WishlistController — added in Phase 9
  ],
  providers: [
    OrderService,
    AddressService,
    CartService,
    CheckoutService,
    { provide: SHIPPING_SERVICE, useClass: ShippingStubService },
    { provide: PAYMENT_SERVICE, useClass: PaymentStubService },
  ],
  exports: [OrderService],
})
export class OrderModule {}
```

`OrderModule` is registered in `src/app.module.ts` alongside the existing modules.

---

## Phase 2 — Address Management

### Schema migration `add_address_soft_delete`

File: `prisma/migrations/20260415131740_add_address_soft_delete/migration.sql`

```prisma
model Address {
  // ...existing fields
  deletedAt DateTime?           // NEW

  @@index([userId, deletedAt]) // NEW composite index for fast filtered list queries
}
```

Soft delete is non-negotiable here — existing `Order` rows hold an FK to `Address.id`, and the foundation doc locked FK integrity preservation as the right call. Order snapshot fields already preserve delivery info independent of the Address row, so the FK can stay intact even after the buyer "deletes" an address.

### Concurrency hardening migration `address_one_default_per_user`

File: `prisma/migrations/20260415132000_address_one_default_per_user/migration.sql`

```sql
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("userId")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;
```

**Why a raw-SQL migration:** Postgres partial unique indexes aren't expressible in `schema.prisma`. A plain `@@unique([userId, isDefault])` would forbid *any* two addresses with the same `isDefault` value per user — which would break as soon as the user has two non-default addresses. A partial index targets only the rows where `isDefault = true AND deletedAt IS NULL`, which is exactly the invariant.

**Why it exists:** without this index, the code alone can't defend against the concurrent-first-create race — two parallel `POST /addresses` on an empty account can both observe `activeCount === 0`, both set `isDefault: true`, and land two defaults. Default READ COMMITTED isolation doesn't help because count-then-insert has no row to conflict on. The partial index enforces the invariant at the DB layer; a raced auto-default surfaces as a Prisma `P2002` which the caller can retry.

Callers should treat `P2002` on this index as a hint to retry with `isDefault: false` (the user already has a default by the time the race resolves).

### DTOs

Both DTOs live in `src/order/dto/`:

**`CreateAddressDto`** — all fields except `label`, `addressLine2`, and `isDefault` are required. Key validators:

| Field           | Rule                                                                |
|-----------------|---------------------------------------------------------------------|
| `label`         | optional, 1–30 chars                                                 |
| `recipientName` | 2–100 chars                                                          |
| `phone`         | regex `/^(?:\+?27\|0)\d{9}$/` — SA formats only; no whitespace in DTO |
| `addressLine1`  | 1–200 chars                                                          |
| `addressLine2`  | optional, 0–200 chars                                                |
| `city`          | 1–100 chars                                                          |
| `province`      | `@IsIn(SA_PROVINCES)` — 9 official provinces                          |
| `postalCode`    | `^\d{4}$` — 4 digits                                                 |
| `isDefault`     | optional boolean                                                     |

`SA_PROVINCES` lives in `src/order/dto/sa-provinces.ts` as a readonly tuple — also exported as type `SaProvince`.

**`UpdateAddressDto`** — every field is optional. Validators mirror `CreateAddressDto`.

> **DTO vs util phone tolerance:** the DTO regex is strict (`"0821234567"` / `"+27821234567"` / `"27821234567"` only — no spaces or dashes). The `normalizePhone` utility additionally strips whitespace, dashes, and parens. The mismatch is intentional belt-and-braces — DTO enforces clean input from the current UI, util is tolerant for future callers (e.g. guest checkout intake, where the DTO surface may be looser).

### Phone normalization

`src/order/utils/phone.ts` — `normalizePhone(input: string): string`.

- Accepts `0XXXXXXXXX`, `+27XXXXXXXXX`, or `27XXXXXXXXX` after stripping `[\s\-()]`.
- Output: canonical `+27XXXXXXXXX`.
- Throws `BadRequestException` on invalid input. NestJS maps this to HTTP 400, so the util stays safe to call from any controller path — even if the DTO layer is ever bypassed or loosened.

Reusable across buyer-side modules (cart, checkout, support tickets later).

### Service rules

`src/order/address/address.service.ts` — `AddressService` owns five public methods plus one private helper.

**Invariants enforced by the service:**

1. **Max 4 active addresses per user.** `ConflictException` (409) with message `"You can have at most 4 addresses. Delete one to add another."` Deleted addresses don't count against the cap. Cap is a module-level constant (`MAX_ADDRESSES_PER_USER`).

2. **First address auto-defaults.** On `create`, if `activeCount === 0`, `isDefault: true` is forced regardless of what the request body says.

3. **Transactional default-flip.** When a create or update sets `isDefault: true`, the service transactionally flips all other active defaults to `false` before setting the new one. Single `$transaction` wraps the flip + the write.

4. **Unset-default-via-PATCH is blocked.** `dto.isDefault === false` on a currently-default address raises `ConflictException` (409) with guidance to promote another address instead. This prevents the buyer from landing in a no-default state via PATCH, which would break checkout defaults.

5. **Soft-delete with auto-promote.** `delete` sets `deletedAt` + clears `isDefault` on the target. If the deleted address was the default, the most-recently-updated *active* address is promoted to default in the same transaction. If no other address exists, the user ends up with no default — checkout handles the empty state.

6. **404 on every ownership / soft-delete / missing path.** The private helper `assertAddressOwnedAndActive(client, userId, addressId)` returns `NotFoundException` ("Address not found") whether the address belongs to a different user, has been soft-deleted, or doesn't exist. Prevents enumeration.

**Concurrency handling:**

The private helper takes a `PrismaService | Prisma.TransactionClient` as its first argument. In `update` and `delete`, the helper is called **inside** the `$transaction` callback, passing `tx`. This prevents a concurrent DELETE from being effectively "resurrected" by a raced PATCH that read the row before the delete committed.

In `update`, `normalizePhone` is called *outside* the transaction so a malformed phone 400s before a txn is opened — cheaper and cleaner.

**Method surface:**

| Method            | Runs in txn? | Notes                                                            |
|-------------------|:-----------:|------------------------------------------------------------------|
| `list`            | no          | `findMany` filtered by `deletedAt: null`, ordered default-first  |
| `getById`         | no          | Direct helper call; no writes                                    |
| `create`          | yes         | count → cap check → flip defaults → insert                       |
| `update`          | yes         | helper inside txn → build patch → flip siblings if promoting     |
| `delete`          | yes         | helper inside txn → soft-delete → auto-promote if was default    |

### Controller

`src/order/address/address.controller.ts` — `AddressController`.

- Route prefix: `@Controller('addresses')`.
- Global `JwtAuthGuard` is already registered via `APP_GUARD` in `AuthModule`, so every endpoint is JWT-authed by default.
- Controller adds `@UseGuards(RolesGuard)` + `@Roles(UserRole.BUYER)` — restricts access to buyers only. Admin address views for support are deferred to Phase 7's separate admin controller.
- `@CurrentUser('id')` extracts the user's id from the JWT-decoded request user. Consistent with the rest of the codebase.

### API endpoints (Phase 2)

| Method   | Path              | Auth           | Status | Description                                     |
|----------|-------------------|----------------|--------|-------------------------------------------------|
| `GET`    | `/addresses`      | JWT + BUYER    | 200    | List active addresses, defaults first           |
| `GET`    | `/addresses/:id`  | JWT + BUYER    | 200    | Get one address                                 |
| `POST`   | `/addresses`      | JWT + BUYER    | 201    | Create an address                               |
| `PATCH`  | `/addresses/:id`  | JWT + BUYER    | 200    | Update fields; `isDefault: true` flips siblings |
| `DELETE` | `/addresses/:id`  | JWT + BUYER    | 200    | Soft-delete; auto-promote if was default        |

---

## Testing

Unit tests only. Integration (e2e) tests are deferred to a later consolidated pass.

### `src/order/utils/phone.spec.ts`

12 tests across three groups:

- **Canonicalization** — `+27XXX` passthrough, `0XXX` → `+27XXX`, `27XXX` → `+27XXX`.
- **Formatting tolerance** — spaces, dashes, parentheses stripped.
- **Rejection** — `it.each` table covering empty string, letters, too-short, too-long, non-SA country code, non-zero national leading digit. All raise `BadRequestException`.

### `src/order/address/address.service.spec.ts`

20 tests. `PrismaService` is mocked; `$transaction` is mocked to invoke its callback with the same mock acting as `tx`, so in-transaction behavior is exercised end-to-end.

Coverage map:

| Area       | Scenarios                                                                                                       |
|------------|------------------------------------------------------------------------------------------------------------------|
| `list`     | Returns active only, ordered default-first                                                                       |
| `getById`  | Happy path; 404 on cross-user, soft-deleted, missing                                                             |
| `create`   | First-address auto-default; phone normalization; default-flip when creating new default; no flip when non-default; 409 at 4-cap |
| `update`   | Partial field update; sibling default-flip when promoting; no-op when already default; 409 on unset-default-via-PATCH; phone normalization; 404 on cross-user |
| `delete`   | Soft-delete + clears `isDefault`; auto-promote surviving most-recent; no-promote when deleted wasn't default; empty state when no siblings; 404 on cross-user |

**Run:** `npx jest src/order` → **32/32 passing** (~0.7s).

---

## Things Worth Knowing

### 1. Partial unique index lives outside `schema.prisma`

The one-default-per-user invariant is a Postgres partial unique index (`addresses_one_default_per_user`). Prisma's schema DSL can't express it, so it ships as a raw SQL migration. If you ever regenerate from schema via `prisma db pull`, this index will not round-trip into the schema file — it'll stay in the migration history and in the live DB. Document it wherever you document constraints.

### 2. `onDelete` policy for `Order.shippingDispatchAddressId` is provisional

Currently `ON DELETE SET NULL` (Prisma default). This contradicts the audit-trail intent. Fix is deferred to Shipping-module planning — likely `ON DELETE RESTRICT` plus a user-facing "this address has active orders, archive it instead" flow, or promoting `StoreDispatchAddress` to a soft-delete model.

### 3. Dispatch address pre-requisite for checkout

No existing `Store` rows have `StoreDispatchAddress` records. Checkout (Phase 4) will require "at least one primary dispatch address" per store. Seed fixtures for Store tests will need updating when Shipping-module planning starts. Store onboarding may gain a new go-live-gate step (decision deferred to that planning session).

### 4. Stub → real service swap is one edit

When Payments and Shipping modules ship:

```diff
- { provide: PAYMENT_SERVICE, useClass: PaymentStubService },
+ { provide: PAYMENT_SERVICE, useClass: PaymentService },
```

Orders-module tests can mock `IPaymentService` / `IShippingService` by token — no rewriting required when the swap happens.

### 5. `deletedAt: null` on API responses

Every address response (`list`, `getById`, `create`, `update`) includes `deletedAt: null`. This is cosmetic, not a leak — only the owner's rows are ever returned. If you want a cleaner API shape later, introduce a response DTO.

### 6. Commission math is paid on `Payment`, not `PaymentGroup`

`platformCommissionInCents` and `merchantPayoutInCents` are per-order (on `Payment`), not per-transaction. Each sibling Payment in a multi-brand PaymentGroup carries its own commission slice. When the Payments module lands, the ITN handler will compute these values at the moment the PayFast transaction completes and write them to each Payment row.

### 7. Order number collision retry is the caller's job

`generateOrderNumber()` is stateless — it produces a candidate and that's it. The eventual Phase 4 checkout service will wrap insert in a retry loop that catches Prisma `P2002` on `orders.orderNumber` and regenerates. 32⁵ combinations per year ≈ 33.5M; at 1M orders/year, sustained collision rate is ~3 in 100M.

---

## File Inventory

### Files added

```
docs/order-module/order-module-foundation.md                                    # pre-code decisions
docs/order-module/order-module-foundation-and-addresses.md                      # this doc

prisma/migrations/20260415131507_add_orders_module_foundation/migration.sql
prisma/migrations/20260415131740_add_address_soft_delete/migration.sql
prisma/migrations/20260415132000_address_one_default_per_user/migration.sql

src/order/order.module.ts
src/order/order.service.ts
src/order/order.controller.ts
src/order/address/address.service.ts
src/order/address/address.service.spec.ts
src/order/address/address.controller.ts
src/order/cart/cart.service.ts
src/order/cart/cart.controller.ts
src/order/checkout/checkout.service.ts
src/order/checkout/checkout.controller.ts
src/order/contracts/payment-contract.ts
src/order/contracts/shipping-contract.ts
src/order/contracts/stubs/payment-stub.service.ts
src/order/contracts/stubs/shipping-stub.service.ts
src/order/dto/create-address.dto.ts
src/order/dto/update-address.dto.ts
src/order/dto/sa-provinces.ts
src/order/utils/order-number.ts
src/order/utils/phone.ts
src/order/utils/phone.spec.ts
```

### Files modified

```
prisma/schema.prisma                    # all six Phase 1 changes + Phase 2 soft-delete
src/app.module.ts                       # register OrderModule
```

---

## References

- Pre-code decisions: `docs/order-module/order-module-foundation.md`
- Product-module docs (pattern reference): `docs/product-module/`
- YIIVA philosophy: `docs/about_yiiva.md`
- Auth patterns: `docs/auth-guide.md`
