# YIIVA — Order Module: Foundation

> Locked product decisions, schema changes, architectural patterns, and cross-module contracts for the Order module.
> Stack: NestJS + Prisma + PostgreSQL
> Status: Decisions locked. Implementation pending.

---

## Table of Contents

1. [Context](#context)
2. [Locked Product Decisions](#locked-product-decisions)
3. [Schema Changes](#schema-changes)
4. [Cross-Module Dependencies](#cross-module-dependencies)
5. [Architectural Patterns](#architectural-patterns)
6. [Module Scaffold](#module-scaffold)
7. [Phase Breakdown](#phase-breakdown)
8. [Things Worth Flagging](#things-worth-flagging)
9. [Phase Decisions Log](#phase-decisions-log)
   - [Phase 2 — Address Management](#phase-2--address-management)

---

## Context

The Order module is the second of three tightly-related modules being built in sequence: Orders → Shipping-and-Delivery → Payments-and-Payouts. Together they handle the full commerce flow from cart to delivery to merchant payout.

**Why Orders first.** Payments and Shipping both attach to Order records — they cannot be built first. Orders module is scaffolded with stub contracts for Payments and Shipping so the end-to-end flow can be designed up-front without waiting for those modules to land.

**What Orders owns.**
- `Order`, `OrderItem` — the core order record and line items
- `Cart`, `CartItem` — the precursor to an order
- `WishlistItem` — buyer-saved products
- `Address` — buyer delivery addresses
- `PromotionUsage` — the join between a promotion and a specific order

**What Orders reads from or triggers (but does not own).**
- Reads `Store`, `StoreDispatchAddress` — for merchant scope checks and pickup origin
- Reads `Product`, `ProductVariant` — for cart items and stock reservation
- Calls Shipping module's `IShippingService` — for rate quotes at checkout
- Calls Payments module's `IPaymentService` — for PayFast initialization

This document captures the decisions and schema up-front. Implementation details for each phase will be documented in per-phase docs after code ships.

---

## Locked Product Decisions

The Order module's shape was determined by 15 product questions answered before planning started. All are locked.

### Orders

| # | Question | Decision |
|---|----------|----------|
| 1 | Single-store per order? | **Yes.** Cart may contain multi-brand items; checkout auto-splits into one Order per store. UX shows "1 checkout, N orders." |
| 2 | Cart lifecycle? | **Server-side persisted.** One active `Cart` per `userId`, as current schema. |
| 3 | Stock reservation? | **Soft-reserve on cart-add** (increment `reservedStock`), **hard-decrement on payment complete** (decrement `totalStock` + `reservedStock`). Buyer sees "sold out" at checkout if race occurred. |
| 4 | Guest checkout? | **Allowed.** Requires email + phone + address. Auto-creates `User` with `isGuestAccount: true`. Prompt "Claim your account" after purchase. |
| 5 | Cancellation rules? | Buyer: at `PENDING` and `CONFIRMED` only (before `PROCESSING`). Merchant: any time before `DISPATCHED`. Admin: any status. All cancellations trigger refund + release reservation. |

### Payments

| # | Question | Decision |
|---|----------|----------|
| 6 | PayFast dev mode? | **Sandbox credentials + ngrok** for local ITN testing. Staging uses real subdomain. |
| 7 | Payment retry policy? | **Same Order stays alive for 30 minutes** after `FAILED`. Buyer returns to same checkout with same items + locked shipping rate. |
| 8 | Platform commission? | **Flat 5.5%** across all brands for MVP. Deducted after PayFast fee, before merchant payout. Config-driven for future tiering. |
| 9 | Payout frequency? | **Twice weekly — Monday + Thursday.** Rolling window: Monday pays Fri–Sun orders, Thursday pays Mon–Wed orders. Automated cron. |
| 10 | Refund model? | **Automated via PayFast API.** Manual fallback only if API fails. |

### Shipping

| # | Question | Decision |
|---|----------|----------|
| 11 | ShipLogic env? | **Sandbox/test keys** for dev. Request from TCG once business account is live. |
| 12 | Origin address? | **New `StoreDispatchAddress` model** (not a flag on `StoreAddress`). Merchant sets one primary; can have multiple for multi-location brands. |
| 13 | Rate caching? | **Locked at order creation.** Stored on `Order.shippingInCents` + `shippingQuoteId`. YIIVA absorbs any delta if re-quote at dispatch differs. |
| 14 | Service tier selection? | **Default "ECO"** for all orders. Buyer can upgrade to LOF/LOX at checkout. Merchant can set store default in dashboard later. |
| 15 | Tracking ingestion? | **Webhook push** preferred. ShipLogic configured with our notify URL. Polling only as fallback. |

---

## Schema Changes

Six migrations, applied in one Prisma migration named `add_orders_module_foundation`. No production data → clean destructive migration is acceptable.

### Change 1 — New `PaymentGroup` model

Represents one PayFast transaction. Owns all transaction-scoped fields (ITN payload, signature, PayFast IDs, buyer info). Required because a single PayFast transaction can cover multiple Orders (multi-brand cart).

```prisma
model PaymentGroup {
  id                   String         @id @default(cuid())
  mPaymentId           String         @unique
  pfPaymentId          String?
  status               PaymentStatus  @default(PENDING)

  amountGrossInCents   Int
  amountFeeInCents     Int            @default(0)
  amountNetInCents     Int

  method               PaymentMethod?

  pfSignature          String?
  itnPayload           Json?
  pfToken              String?
  pfNameFirst          String?
  pfNameLast           String?
  pfEmailAddress       String?

  paidAt               DateTime?
  failedAt             DateTime?
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt

  payments             Payment[]

  @@index([mPaymentId])
  @@index([status])
  @@map("payment_groups")
}
```

### Change 2 — Refactor `Payment`

Strip all PayFast transaction fields (they live on `PaymentGroup` now). Add `paymentGroupId`. Add **eager commission math** fields locked at payment time.

```prisma
model Payment {
  id                          String        @id @default(cuid())
  orderId                     String        @unique
  paymentGroupId              String

  status                      PaymentStatus @default(PENDING)

  // This order's portion of the payment group
  amountGrossInCents          Int
  amountFeeInCents            Int           @default(0)  // proportional PayFast fee
  amountNetInCents            Int

  // Eager commission math (locked at payment time; immune to rate changes)
  platformCommissionInCents   Int           @default(0)  // YIIVA 5.5% take
  merchantPayoutInCents       Int           @default(0)  // amountNet - platformCommission

  // Refund tracking
  refundedAmountInCents       Int           @default(0)

  paidAt                      DateTime?
  refundedAt                  DateTime?
  createdAt                   DateTime      @default(now())
  updatedAt                   DateTime      @updatedAt

  order                       Order         @relation(fields: [orderId], references: [id], onDelete: Cascade)
  paymentGroup                PaymentGroup  @relation(fields: [paymentGroupId], references: [id], onDelete: Cascade)

  @@index([paymentGroupId])
  @@index([status])
  @@map("payments")
}
```

**Why eager commission math.** If YIIVA later changes the commission rate (e.g. 5.5% → 6%), old payments stay locked at the rate that was in effect when they were paid. Payout cron becomes dumb arithmetic (`SUM(merchantPayoutInCents)`), no retroactive recompute.

### Change 3 — `reservedStock` on `Product` and `ProductVariant`

```prisma
model Product {
  // ...existing
  totalStock      Int  @default(0)
  reservedStock   Int  @default(0)  // NEW
}

model ProductVariant {
  // ...existing
  stock           Int  @default(0)
  reservedStock   Int  @default(0)  // NEW
}
```

Available stock = `totalStock - reservedStock` (computed, not stored).

**Concurrency contract:** all `reservedStock` mutations use guarded atomic updates (see [Architectural Patterns — Stock Safety](#pattern-3--stock-reservation-is-transactional)).

### Change 4 — New `StoreDispatchAddress` model

Replaces the rejected idea of flagging existing `StoreAddress` with `isPrimaryDispatchAddress`. Separate model because dispatch addresses have different field requirements (ShipLogic needs province, country, pickup contact) and different privacy semantics (warehouses shouldn't leak to the public profile).

```prisma
model StoreDispatchAddress {
  id                  String   @id @default(cuid())
  storeId             String
  label               String?              // e.g. "Warehouse", "Studio", "Home"

  // Pickup contact (ShipLogic requires)
  contactName         String
  contactPhone        String

  // Full address (ShipLogic rate-endpoint requirements)
  addressLine1        String
  addressLine2        String?
  suburb              String?
  city                String
  province            String
  postalCode          String
  country             String   @default("South Africa")

  // Optional for rate accuracy
  latitude            Float?
  longitude           Float?

  isPrimary           Boolean  @default(false)  // One primary per store
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  store               Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)
  shipments           Shipment[]
  orders              Order[]

  @@index([storeId])
  @@map("store_dispatch_addresses")
}
```

Reverse relation on `Store`:
```prisma
model Store {
  // ...existing
  dispatchAddresses   StoreDispatchAddress[]
}
```

### Change 5 — `User.isGuestAccount` flag

```prisma
model User {
  // ...existing
  isGuestAccount      Boolean  @default(false)  // NEW
}
```

Enables guest checkout (Pattern B — auto-create guest User). When buyer claims their account post-purchase, flag flips to `false` and `accountStatus: ACTIVE`.

### Change 6 — Shipping fields on `Order`

```prisma
model Order {
  // ...existing
  shippingInCents              Int      @default(0)
  shippingQuoteId              String?                    // NEW — ShipLogic quote ref
  shippingServiceTier          String?                    // NEW — "ECO" / "LOF" / "LOX"
  shippingDispatchAddressId    String?                    // NEW — audit trail

  dispatchAddress              StoreDispatchAddress?  @relation(fields: [shippingDispatchAddressId], references: [id])
}
```

**Why `shippingDispatchAddressId` audit trail.** If the merchant later edits their primary dispatch address, historical orders still point to the original origin. Matters for refund disputes and courier-related investigations.

---

## Cross-Module Dependencies

```
                ┌────────────────────┐
                │   OrderModule      │
                │                    │
                │  OrderService      │
                │  CartService       │
                │  CheckoutService   │
                │  AddressService    │
                └────────┬───────────┘
                         │
         ┌───────────────┼────────────────┐
         │               │                │
         ↓               ↓                ↓
  ┌──────────────┐  ┌─────────┐  ┌──────────────┐
  │ StoreModule  │  │ Product │  │  Payments    │
  │              │  │ Module  │  │  + Shipping  │
  │ canManage    │  │         │  │              │
  │ dispatch     │  │ stock   │  │  IPayment    │
  │ addresses    │  │ reads   │  │  IShipping   │
  └──────────────┘  └─────────┘  └──────────────┘
                                    (contracts)
```

**Rules:**
- Orders imports Store and Product modules directly (they already exist).
- Orders imports Payments and Shipping via **injection-token interfaces** (`IPaymentService`, `IShippingService`) — not via direct module imports. Contracts live in `src/order/contracts/`. Stub implementations (`NotImplementedException`) are the initial bindings; real services replace them when those modules ship.
- Payments and Shipping will later import `OrderService` (to update `Order.status` on ITN or tracking events). No circular dependency — Orders uses contracts, Payments/Shipping use the concrete `OrderService`.
- Payouts module (built last) imports Orders + Stores read-only for payout period aggregation.

---

## Architectural Patterns

These patterns apply to every endpoint and service method in the Order module. They're locked at Phase 1 so they don't get re-debated during implementation.

### Pattern 1 — Actor-based ownership checks

Every endpoint verifies actor ownership against the resource:

| Actor     | Check                                                              |
|-----------|--------------------------------------------------------------------|
| BUYER     | `resource.userId === currentUser.id`                               |
| MERCHANT  | `storeService.canManageStore(userId, resource.storeId) === true`   |
| ADMIN     | Bypass — full access                                               |

Never compare roles directly; always go through canonical services. Keeps Orders free of store-employee knowledge.

### Pattern 2 — 404-not-403 on cross-actor leaks

Cross-user access attempts return **404 Not Found**, never 403. Prevents enumeration attacks (confirming an order exists via its ID).

### Pattern 3 — Stock reservation is transactional

Every mutation to `reservedStock` or `totalStock` must:

1. Execute inside `prisma.$transaction()` for multi-row updates.
2. Use **guarded `updateMany`** with available-stock check in the `WHERE` clause — never read-then-update (race condition).
3. Check the returned count; if 0 rows updated → throw 409 "Insufficient stock".

Example pattern:

```typescript
const result = await prisma.product.updateMany({
  where: {
    id: productId,
    totalStock: { gte: reservedStock + quantity },
  },
  data: { reservedStock: { increment: quantity } },
});
if (result.count === 0) throw new ConflictException('Insufficient stock');
```

Orders module is the single source of truth for stock movement. Products module reads these fields but never mutates them after initial seed.

### Pattern 4 — Multi-brand checkout flow

Canonical flow when buyer clicks "Pay":

1. Read cart → group items by `product.storeId`.
2. For each store group, call `IShippingService.getRate()` → get per-store shipping quote.
3. Compute per-store totals (subtotal + shipping + discounts).
4. Create **one** `PaymentGroup` (total = sum of all store totals).
5. Create **N** `Order` rows (one per store group).
6. Create **N** `Payment` rows, all linked to the same `PaymentGroup`.
7. Call `IPaymentService.initializePayment(orderIds: [...])` → get PayFast redirect URL.
8. Stock stays in `reservedStock` — not yet moved to committed.
9. Redirect buyer to PayFast.

On ITN success: `PaymentGroup.status → COMPLETED` cascades to all child `Payment` rows → all `Order` rows flip to `CONFIRMED` → `totalStock` and `reservedStock` both decrement.

On ITN failure or 30-minute timeout (Q7): release reservations, mark orders `CANCELLED`.

### Pattern 5 — Guest user auto-creation

At checkout, if buyer is unauthenticated and provides email + phone:

1. Look up `User` by email.
2. Found + `isGuestAccount: false` → reject: "Account exists. Please log in."
3. Found + `isGuestAccount: true` → reuse.
4. Not found → create `User` with `isGuestAccount: true`, `accountStatus: PENDING_VERIFICATION`, random/placeholder `passwordHash`, `role: BUYER`.

All downstream records (Orders, Addresses) get a real `userId` FK.

**Claim flow** (Phase 6 — Buyer Views): signed-out buyer lands on confirmation page → "Claim your account" CTA → sets password → email verification token → flips `isGuestAccount: false`, `accountStatus: ACTIVE`.

**Guest claim race mitigation:** When two guests check out with the same email in rapid succession, wrap the email lookup + `User.create` in the same transaction using `SELECT FOR UPDATE` semantics.

### Pattern 6 — Order number generation

`Order.orderNumber` is the buyer-facing human-readable ID. CUIDs remain the primary key (`Order.id`); order numbers are a **secondary display identifier** — never used in relations.

**Format:** `YV-<YYYY>-<5 chars>`

Example: `YV-2026-A4F2K`

**Restricted alphabet (Crockford base32-like):** 32 characters — `0-9 A-H J K M N P Q R S T V W X Y Z`. Excludes `I`, `L`, `O`, `U` to avoid read-aloud and typed ambiguity.

**Collision space:** 32⁵ ≈ 33.5M per year. At 1M orders/year, collision per order is ~3 in 100M. DB unique constraint + retry-on-collision handles the theoretical edge.

**Why this format:**
- Prefix `YV` distinguishes YIIVA order numbers from PayFast IDs, waybills, bank refs.
- Year segment resets collision space annually and makes historical scanning trivial.
- 32-char restricted alphabet avoids human confusion (`1` vs `I` vs `L`, `0` vs `O`, `U` vs `V`).
- 5 chars is short enough to tell someone over the phone, long enough to never collide in practice.

Utility in `src/order/utils/order-number.ts`.

---

## Module Scaffold

Directory structure created in Phase 1 (placeholder services and controllers — populated in subsequent phases):

```
src/order/
├── order.module.ts
├── order.service.ts                    # Top-level order lifecycle (placeholder)
├── order.controller.ts                 # Merchant + admin endpoints (placeholder)
├── address/
│   ├── address.service.ts              # Phase 2
│   └── address.controller.ts           # Phase 2
├── cart/
│   ├── cart.service.ts                 # Phase 3
│   └── cart.controller.ts              # Phase 3
├── checkout/
│   ├── checkout.service.ts             # Phase 4
│   └── checkout.controller.ts          # Phase 4
├── wishlist/
│   ├── wishlist.service.ts             # Phase 9
│   └── wishlist.controller.ts          # Phase 9
├── contracts/
│   ├── shipping-contract.ts            # IShippingService interface
│   ├── payment-contract.ts             # IPaymentService interface
│   └── stubs/
│       ├── shipping-stub.service.ts    # Throws NotImplementedException
│       └── payment-stub.service.ts     # Throws NotImplementedException
├── dto/
│   └── (populated per phase)
└── utils/
    └── order-number.ts                 # Order number generator
```

### Contract Interfaces

**`contracts/shipping-contract.ts`:**

```typescript
export interface ShippingRateRequest {
  dispatchAddressId: string;
  destinationProvince: string;
  destinationPostalCode: string;
  destinationCity: string;
  destinationCountry: string;
  totalWeightInGrams: number;
  parcelCount: number;
  serviceTier: 'ECO' | 'LOF' | 'LOX' | 'NFS';
}

export interface ShippingRateResponse {
  quoteId: string;
  rateInCents: number;
  rateExVatInCents: number;
  serviceTier: string;
  estimatedDeliveryDate: Date;
}

export interface IShippingService {
  getRate(req: ShippingRateRequest): Promise<ShippingRateResponse>;
}
```

**`contracts/payment-contract.ts`:**

```typescript
export interface PaymentInitRequest {
  orderIds: string[];              // one or many (multi-brand checkout)
  totalAmountInCents: number;
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

export interface PaymentInitResponse {
  paymentGroupId: string;
  mPaymentId: string;
  payfastRedirectUrl: string;
}

export interface IPaymentService {
  initializePayment(req: PaymentInitRequest): Promise<PaymentInitResponse>;
}
```

### Module Registration

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
    { provide: 'SHIPPING_SERVICE', useClass: ShippingStubService },
    { provide: 'PAYMENT_SERVICE', useClass: PaymentStubService },
  ],
  exports: [OrderService],
})
export class OrderModule {}
```

Registered in `app.module.ts` alongside existing modules.

---

## Phase Breakdown

| Phase | Scope | Steps |
|-------|-------|-------|
| **1 — Foundation** | Schema migrations, module scaffold, contract stubs, patterns locked | Step 1 |
| **2 — Address Management** | Buyer address CRUD | Steps 2–5 |
| **3 — Cart** | Cart CRUD, item add/update/remove, soft stock reservation, cart views | Steps 6–10 |
| **4 — Checkout** | Multi-brand split, shipping rate (via stub), total computation, order creation, payment init (via stub), stock commit | Steps 11–14 |
| **5 — Merchant Order Management** | List store orders, view detail, state transitions, merchant cancel | Steps 15–18 |
| **6 — Buyer Order Views** | Buyer order list, detail, buyer cancel, guest account claim flow | Steps 19–22 |
| **7 — Admin Order Views** | Admin cross-store order list, admin overrides, refund trigger point (stub) | Steps 23–24 |
| **8 — Cron: Cart & Stock Cleanup** | Release reservations on stale carts, expire PENDING orders after 30 min | Step 25 |
| **9 — Wishlist** | Add / remove / list wishlist items | Steps 26–27 |
| **10 — Consolidated Testing** | Unit, integration, manual checks | Step 28 |

Cart-abandonment cron (Phase 8) comes before Wishlist because stock correctness matters more than wishlist features.

---

## Things Worth Flagging

Items that aren't blockers but deserve visibility before coding starts.

### 1. Dispatch address pre-requisite

Existing stores from Store module seed/tests have no `StoreDispatchAddress` rows. Checkout (Phase 4) will require "at least one primary dispatch address" per store. This means:

- Store seed fixtures must be updated to create a primary dispatch address for each seeded store.
- Store onboarding (existing module) may need a new step in the go-live flow to require at least one primary dispatch address before `ACTIVE`. Decision deferred to when Shipping module is planned — for now, checkout enforces it at Order creation time with a clear error.

### 2. Payment fee proportional split

One PayFast transaction covers multiple orders (multi-brand). PayFast charges one transaction fee on the whole amount. We split it proportionally across child payments:

```
Payment.amountFeeInCents = PaymentGroup.amountFeeInCents × (Payment.amountGrossInCents / PaymentGroup.amountGrossInCents)
```

Rounding cents go to the larger order. Pragmatic but not accounting-exact. **Flag for finance team review before production.**

### 3. Order number collision probability

32⁵ combinations per year = ~33.5M. At projected growth of 1M orders/year, collision probability stays negligible for years. DB unique constraint + retry catches the theoretical edge. Revisit only at >100K orders/year sustained.

### 4. Stub → real service swap

When Payments and Shipping modules ship, the binding changes in `order.module.ts`:

```diff
- { provide: 'PAYMENT_SERVICE', useClass: PaymentStubService },
+ { provide: 'PAYMENT_SERVICE', useClass: PaymentService },
```

Orders module tests can mock `IPaymentService` and `IShippingService` directly — no rewriting when the swap happens.

### 5. Account claim email verification

Guest-to-real-account upgrade needs email verification (buyer must prove they own the email). Reuse the existing `User.verificationToken` + `verificationExpiry` fields from Auth module. Flag: ensure token lifetime policy matches existing Auth conventions. Handled in Phase 6.

### 6. Stock reservation TTL

Items sitting in a cart indefinitely hold reserved stock. Phase 8 cron releases reservations when:
- Cart hasn't been updated in 24 hours → clear all `CartItem` rows; decrement `reservedStock` on the affected products.
- Order stuck in `PENDING` for > 30 minutes (per Q7) → release reservation, flip to `CANCELLED`.

TTL values are config-driven so they can be tuned without a code change.

---

## Phase Decisions Log

Per-phase product decisions locked at planning time, before code is written. Each subsection records the answers that pin down a phase's shape. Implementation details (service method signatures, test tables, exact error messages) go in the per-phase implementation docs **after** code ships.

### Phase 2 — Address Management

Phase 2 builds buyer-facing address CRUD (`POST/GET/PATCH/DELETE /addresses`). Addresses are a hard prerequisite for checkout — a buyer can't place an order without a delivery destination. Phase 2 is intentionally the smallest phase in the Orders module: no dependencies on Products, Payments, or Shipping.

**Scope.** Buyer-authenticated CRUD only. Admin address views (for support) are deferred to Phase 7. Guest checkout creates addresses inline via the same service — no special guest path in Phase 2.

**Locked decisions:**

| # | Question | Decision |
|---|----------|----------|
| 1 | How is `isDefault` managed across multiple addresses? | **Pattern A** — inline via the main create/update endpoints. Passing `isDefault: true` transactionally flips all other defaults to `false`. No separate `set-default` endpoint. |
| 2 | Does the buyer's first address auto-default? | **Yes.** On create, if the buyer has zero active addresses, force `isDefault: true` regardless of request body. |
| 3 | What happens when the default is deleted? | **Pattern B** — auto-promote. Find the buyer's most recently updated other active address and flip it to `isDefault: true`. If it's the only address, allow delete anyway (buyer ends up with no default; checkout handles the empty state). |
| 4 | What happens to existing Orders when an Address is deleted? | **Pattern C (soft delete).** Add `Address.deletedAt DateTime?`. Reads filter by `deletedAt: null`. FK integrity preserved. No cascade changes to `Order.addressId`. Order snapshot fields already preserve delivery info independent of the Address row. |
| 5 | Address validation rules? | **SA-specific.** Province restricted to 9 SA provinces via `@IsIn`. Postal code must be 4 digits. Phone accepts `0XXXXXXXXX` or `+27XXXXXXXXX`, normalized to `+27` format on save. Country defaults to "South Africa". Recipient name 2–100 chars. Label 1–30 chars, optional, free-form. |
| 6 | Cap on addresses per buyer? | **4 addresses max.** Error: "You can have at most 4 addresses. Delete one to add another." |
| 7 | Ownership check semantics? | **404-not-403** on cross-user access. Admin bypass deferred to a separate admin controller in Phase 7. |
| 8 | Guest addresses? | **No special path.** Guest checkout (Phase 4) creates addresses inline via the same `AddressService.create()` — the guest `User` is auto-created first, so standard ownership semantics work. |

**Phase 2 schema change.**

```prisma
model Address {
  // ...existing fields
  deletedAt   DateTime?                     // NEW — null = active, set = soft-deleted

  @@index([userId, deletedAt])              // NEW composite index for fast filtered list queries
}
```

Migration name: `add_address_soft_delete`. Additive, no destructive changes.

**Phase 2 helpers established:**

- `AddressService.assertAddressOwnedAndActive(userId, addressId)` — private helper wrapping fetch + ownership + deleted-check; used by update, delete, and get-by-id.
- `src/order/utils/phone.ts` — `normalizePhone(input: string): string` converts `0XXXXXXXXX` → `+27XXXXXXXXX`. Reusable across buyer-side modules.

**Phase 2 endpoints (5 total):**

| Method   | Path              | Description                                     |
|----------|-------------------|-------------------------------------------------|
| `GET`    | `/addresses`      | List all active addresses for current buyer     |
| `GET`    | `/addresses/:id`  | Get a single address                            |
| `POST`   | `/addresses`      | Create a new address                            |
| `PATCH`  | `/addresses/:id`  | Update an address (including `isDefault` switch) |
| `DELETE` | `/addresses/:id`  | Soft-delete an address                          |

All guarded by `UserRole.BUYER`.

**Edge case flagged for Phase 2 implementation:**

- **Unset default directly.** Setting `isDefault: false` on the current default address via PATCH is blocked with 409 — "Set another address as default instead." Rationale: prevents the buyer from ending up in a no-default state via PATCH (which would break checkout defaults). The only way to lose the default is to delete it, which auto-promotes another.

### Phase 3 — Cart

Phase 3 builds authenticated cart CRUD with soft stock reservation — the on-ramp to Phase 4 checkout. Cart schema (`Cart`, `CartItem`) already exists from pre-Orders-module work; no new tables are required. All writes route through a stock-reservation primitive that keeps `reservedStock` in lockstep with cart contents.

**Scope.** Authenticated buyer cart CRUD only. Anonymous browsing uses a client-side `localStorage` stash on the frontend, replayed via `POST /cart/items` after login or guest-account creation — no server-side guest cart. Checkout's split-by-store and hard-decrement-on-payment are Phase 4 concerns.

**Locked decisions:**

| # | Question | Decision |
|---|----------|----------|
| 1 | Must the buyer pick a variant when a product has variants? | **No.** Bare product is its own SKU (`variantId: null`). Buyer may add bare or any variant. |
| 2 | Duplicate-add behavior (same product + variant already in cart)? | **Increment quantity.** Backed by the existing `@@unique([cartId, productId, variantId])` — duplicate insert becomes an UPDATE. |
| 3 | Per-line quantity cap? | **Only bounded by stock.** No hard-coded ceiling. |
| 4 | Which stock row is reserved on add? | **Independent SKU model.** `variantId: null` → reserve on `Product.reservedStock`. `variantId` set → reserve on `ProductVariant.reservedStock`. Each SKU's inventory is independent; product-overall availability = bare + Σ(variants). |
| 5 | Stock race handling on add / quantity-up? | **Optimistic conditional `UPDATE`**. Single `UPDATE … WHERE reservedStock + Δ <= totalStock`. Rows-affected = 0 ⇒ 409 "Out of stock". No row-level locks, no retry loop. |
| 6 | Quantity-down / remove? | **Unconditional `UPDATE`** releasing reservation by delta. No race — giving stock back always succeeds. |
| 7 | `GET /cart` response shape? | **Grouped by store** — `{ stores: [{ storeId, storeName, items, subtotalInCents }], grandSubtotalInCents }`. Mirrors the checkout-time split. |
| 8 | Price snapshotting on cart lines? | **None.** Live `Product.priceInCents` on every read. `CartItem` has no price column. Checkout locks price on `OrderItem` creation. |
| 9 | Stale-line surfacing (archived product, missing variant, stock dropped below qty)? | **Non-destructive flag.** Each item carries `status: "available" \| "unavailable" \| "partial_stock"`. Cart reads never mutate. Checkout enforces correctness. |
| 10 | Empty-cart behavior on GET? | **Lazy cart.** `GET /cart` for a user with no `Cart` row returns 200 with an empty grouped shape. `Cart` row is created on first `POST /cart/items`. |
| 11 | Guest-cart strategy? | **Client-side stash (`localStorage`).** No server-side guest cart, no schema carve-out for `Cart.userId`. Frontend replays stashed items via `POST /cart/items` after login or guest-account creation. Stock reservation only starts once items hit the server. |
| 12 | Clear-cart endpoint? | **Yes.** `DELETE /cart` nukes all items and releases all reservations in a single transaction. |
| 13 | Product / store deactivation while items are in cart? | **No auto-removal.** Line persists, `status` flips to `"unavailable"` on read. Stale-cart cron (Phase 8) still applies the 24h inactivity rule. |

**Phase 3 schema change.**

No new columns or tables. One documentation fix to the `Product` model:

```prisma
model Product {
  // Inventory — bare SKU. Each variant has independent stock.
  // Product-overall availability = bare + Σ(variants).
  totalStock        Int     @default(0)
  reservedStock     Int     @default(0)
}
```

The previous comment read `// Inventory (aggregated from variants if variants exist)` — that was the aggregate model, which we're explicitly rejecting with decision #4. Comment-only edit; no migration.

**Phase 3 helpers established:**

- `src/order/cart/stock.ts` — `reserveStock(tx, productId, variantId, delta)` and `releaseStock(tx, productId, variantId, delta)`. Route to the `Product` row (when `variantId` is null) or the `ProductVariant` row based on the SKU rule in decision #4. `reserveStock` throws `ConflictException("Out of stock")` on rows-affected = 0; `releaseStock` is unconditional.
- `CartService.buildCartView(userId)` — private helper that fetches items + joins product/variant + groups by `product.storeId` + computes per-store subtotal + flags `status` per item. Used by both `GET /cart` and post-mutation response shapes so every cart-returning endpoint gives an identical view.
- `CartService.assertCartItemOwned(tx, userId, itemId)` — ownership guard for PATCH/DELETE item. 404-not-403 on cross-user, matching Phase 2's pattern.

**Phase 3 endpoints (5 total):**

| Method   | Path                  | Description                                     |
|----------|-----------------------|-------------------------------------------------|
| `GET`    | `/cart`               | Grouped cart view for current buyer             |
| `POST`   | `/cart/items`         | Add an item (product + optional variant + qty)  |
| `PATCH`  | `/cart/items/:itemId` | Change quantity (up or down)                    |
| `DELETE` | `/cart/items/:itemId` | Remove a single line (releases its reservation) |
| `DELETE` | `/cart`               | Clear all items (releases all reservations)     |

All guarded by `UserRole.BUYER`.

**Edge cases flagged for Phase 3 implementation:**

- **Item-not-in-cart on PATCH/DELETE.** 404-not-403, matching Phase 2. Ownership guard runs inside the transaction so a concurrent delete can't be resurrected by a raced patch.
- **Out-of-stock on quantity-up.** Conditional UPDATE fails ⇒ 409. Cart line quantity is unchanged; buyer sees the current quantity preserved and a clear error.
- **Simultaneous add of same SKU from two tabs.** Both calls compete on the conditional UPDATE. Loser gets 409. No deadlock — the lock is per-row and held only for the UPDATE's duration.
- **Stock race during `DELETE /cart`.** Release runs per-item inside one transaction; a concurrent add on the same SKU is serialized by Postgres's normal MVCC. The clear succeeds or the whole transaction rolls back.
- **Merge race on login (frontend-driven).** Stash merge is a sequence of POSTs; partial failure is possible (some items add, some get 409 from stock changes during the stash window). Frontend renders the result per-item. Out of scope for the backend.

**Product-module follow-up (not Phase 3 blocking):**

The independent-SKU inventory model (decision #4) means product detail pages should display overall availability as `Product.totalStock + Σ(variants.stock)`. Today's Product module may still treat `Product.totalStock` as an aggregate — verify and adjust when Product display logic is next touched. Not a blocker for Phase 3 because cart operations only touch the specific SKU being added/mutated.

### Phase 4 — Checkout

Phase 4 is the largest phase in the module. It takes the cart from Phase 3 and materializes it into one or more `Order` rows (one per store), assembles a `PaymentGroup` with per-order `Payment` slices, calls into the stubbed `PAYMENT_SERVICE` to initialize a PayFast transaction, and returns a redirect URL. Stock reservations carry through from cart-add to ITN outcome; hard-decrement happens later via the Payments module's ITN handler, which is out of scope here.

**Scope.** Buyer-side checkout only: quote + commit endpoints. Merchant order views (Phase 5), buyer order views (Phase 6), admin cross-store views (Phase 7), and the stale-cart / pending-order cron (Phase 8) are separate phases. ITN handling itself lives in the Payments module when it ships — Phase 4 only ships the outbound call (`initialize`) via the contract.

**Locked decisions:**

| # | Question | Decision |
|---|----------|----------|
| 1 | Checkout flow shape? | **Two-step.** `POST /checkout/quote` returns per-store totals + shipping breakdown + grand total for UI confirmation. `POST /checkout` commits — creates Orders + PaymentGroup + Payments, calls PayFast, returns redirect URL. |
| 2 | Shipping tier / service selection? | **Single tier for MVP.** No buyer-selectable tiers. `Order.shippingServiceTier` defaults to `ECO`. Phase 4 ships the tier column hard-coded; buyer-selection is a future Shipping-module concern. |
| 3 | Shipping fee shape? | **Flat R110 per checkout.** 11000 cents. Stored in env var `SHIPPING_FLAT_FEE_IN_CENTS` (default 11000). `ShippingStubService.getRate` returns `{ quoteId: "stub-flat-${cuid}", rateInCents: <env> }` — the contract shape stays stable when the real Shipping module lands. |
| 4 | Multi-store shipping allocation? | **No per-Order split.** Shipping is a single flat R110 stored on `PaymentGroup.shippingInCents`. `Order.shippingInCents = 0` always. YIIVA pays The Courier Guy directly — merchants never see or handle shipping money. `Order.totalInCents = subtotalInCents`. |
| 5 | Guest User materialization timing? | **On commit, not on quote.** `POST /checkout/quote` accepts `{ email, phone, address }` transiently — no DB writes. `POST /checkout` creates the guest `User` (with `isGuestAccount: true`) and `Address` inside the same atomic transaction as the Orders. Prevents guest-account leakage from abandoned quotes. |
| 6 | Guest email verification? | **Deferred to Phase 6** (account-claim flow). Guest accounts are usable for checkout without verification; verification is required only for the "upgrade to real account" path. |
| 7 | Stock commit timing? | **Hard-decrement only at ITN success.** Reservations from Phase 3 persist through Order creation → through PayFast → until ITN outcome. On ITN `COMPLETE` (Payments module, later): `totalStock -= qty`, `reservedStock -= qty` atomically. On ITN `FAILED` / 30-min expiry (Phase 8 cron): release reservation, flip Order to `CANCELLED`. |
| 8 | Rollback when PayFast `initialize` fails after DB writes committed? | **Delete Orders + Payments + PaymentGroup** in a compensating transaction. Cart + reservations stay untouched so buyer can retry. Alternative (keep rows in PENDING + let cron expire) was rejected as leaving zombie state. |
| 9 | External HTTP inside DB transaction? | **Never.** PayFast `initialize` runs *after* the DB tx commits. Tx 1: create Orders + PaymentGroup + Payments (DB-only). Tx 2 (on PayFast success): clear cart items. Tx 3 (on PayFast failure): delete Orders + PaymentGroup + Payments. |
| 10 | Cart-clear timing? | **After PayFast `initialize` succeeds, not before.** If PayFast fails and we've already cleared the cart, rebuilding it from about-to-be-deleted OrderItems is ugly. Cart persists until the buyer is actually on the PayFast page. |
| 11 | VAT? | **None for MVP.** Prices are final, no VAT line on Order. Revisit when YIIVA crosses the SA VAT registration threshold. |
| 12 | Commission base? | **Subtotal only.** `Payment.platformCommissionInCents = round(Order.subtotalInCents × 0.055)`. Shipping is not commissionable. Computed at Order creation, locked on the Payment row. |
| 13 | PayFast fee allocation? | **Deferred to Payments module.** Phase 4 writes `Payment.amountFeeInCents = 0` at creation time. When ITN arrives with the actual PayFast fee on `PaymentGroup`, the Payments module splits it proportionally across sibling Payments. |
| 14 | Handling of `"unavailable"` / `"partial_stock"` lines at checkout? | **Hard reject.** Quote and commit both 409 with a list of offending `{ itemId, productTitle, status }`. Buyer must adjust cart and retry. No auto-skip. |
| 15 | Store missing primary dispatch address? | **Hard reject at quote time.** 400 "Store X has not configured shipping yet." — surfaces the onboarding gap to the buyer. Deferred check: store-onboarding go-live-gate should prevent this state in the first place (Shipping-module planning). |
| 16 | Stub behavior for end-to-end testability? | **Deterministic.** `ShippingStubService.getRate` returns the flat R110. `PaymentStubService.initialize` returns `{ mPaymentId: "stub-${cuid}", redirectUrl: \`https://sandbox.payfast.co.za/eng/process?m_payment_id=...\` }`. Enables service-level integration tests without a mock framework in the cart/checkout path. |
| 17 | Order number collision retry? | **Inside the checkout service.** Wrap the atomic create in a try/catch for Prisma `P2002` on `orders.orderNumber`; regenerate and retry up to 3 times. After 3 consecutive collisions, throw 500 (should be statistically impossible — foundation note #3). |

**Phase 4 schema changes.** Added `shippingInCents Int @default(0)` to `PaymentGroup` — the flat shipping fee lives here (YIIVA pays The Courier Guy directly, merchants never handle shipping money). Individual `Order.shippingInCents` is always 0.

**Phase 4 helpers established:**

- `src/order/checkout/totals.ts` — `computeCheckoutTotals(cart, shippingTotalInCents)`. Pure function: groups cart by store, computes per-store subtotal + commission, returns `{ stores, grandSubtotal, grandShipping, grandTotal }`. No per-store shipping split — shipping stays at checkout level on `PaymentGroup`.
- `src/order/checkout/reservations.ts` — `releaseOrderReservations(tx, orderIds)`. Walks each Order's items and issues `releaseStock` per line. Used by the PayFast-failure rollback path and by the Phase 8 stale-order cron.
- `CheckoutService.assertCartIsCheckoutable(cart)` — private guard. Throws 409 with detail payload when any line has `status !== 'available'`. Also validates cart is non-empty.
- `CheckoutService.resolveShippingAddress(userId, dto)` — resolves the delivery address. For authenticated buyers: reads `addressId` from DTO, calls the Address service's ownership guard. For guests: materializes a new User + Address inside the checkout transaction.
- `generateOrderNumber()` — reused from Phase 1 (`src/order/utils/order-number.ts`).

**Phase 4 endpoints (2 total):**

| Method | Path               | Auth            | Description                                                    |
|--------|--------------------|-----------------|----------------------------------------------------------------|
| `POST` | `/checkout/quote`  | Optional JWT    | Preview: accept `addressId` (or guest `{email, phone, address}`), return per-store subtotals + shipping allocation + grand total. No DB writes. |
| `POST` | `/checkout`        | Optional JWT    | Commit: validate cart, create Orders + PaymentGroup + Payments, call PayFast init, clear cart on success. Returns `{ redirectUrl, orderNumbers }`. |

"Optional JWT" means the endpoint is callable by both authenticated buyers (JWT present, BUYER role) and guests (no JWT, must supply `{email, phone, address}` in the DTO). `GET /checkout/status/:orderNumber` is deferred to Phase 6 (buyer order views).

**Edge cases flagged for Phase 4 implementation:**

- **Concurrent cart mutation during quote → commit.** Buyer opens checkout in two tabs, commits in one, the second tab's commit finds a missing cart item. Surface as 409; the second tab refreshes its cart view from `GET /cart`.
- **Stock grabbed between quote and commit.** Quote shows `"available"`, buyer confirms, commit re-checks statuses and one line is now `"partial_stock"`. Same 409 hard-reject as Phase 3 decision #14 — no auto-adjust.
- **`orderNumber` collision on retry.** Three collisions in a row ⇒ 500. Statistically negligible at our volume; collision probability at 1M orders/year is ~3 in 100M (foundation note #3).
- **Guest commit with an email that already belongs to a verified User.** Reject with 409 "An account with this email exists. Please log in to continue." Prevents account hijacking via guest checkout.
- **Per-checkout flat shipping lives on `PaymentGroup`, not on individual Orders.** `Order.shippingInCents = 0` always. Frontend displays shipping from the PaymentGroup level, not from Order detail.
- **PayFast init timeout / network error.** Treated as failure → Orders/Payments/PaymentGroup deleted, cart untouched, buyer sees "Payment provider unavailable, please retry." Reservations from Phase 3 stay, so a quick retry hits the same stock.

**Shipping subsidy model (Path A — acknowledged risk):**

MVP charges buyers a flat R110 per checkout regardless of how many stores/parcels are involved. YIIVA pays The Courier Guy separately per shipment — each Order is a physically separate parcel shipped from the merchant's dispatch address to the buyer. When multi-brand carts split into N shipments, the real courier cost will typically exceed R110.

This is an intentional **customer-acquisition subsidy** for the marketplace phase. Phase 4 does not integrate with The Courier Guy API — `ShippingStubService` returns R110, no rate lookup. When the Shipping module ships:

- A new `Shipment` model will track `costInCentsFromCourier` per parcel (the real Courier Guy cost, written at waybill creation time).
- A weekly reconciliation report computes `Σ(buyer-paid shipping) − Σ(courier-billed)` to track the subsidy burn.
- If subsidy exceeds a threshold (e.g. 5% of monthly GMV), pricing options include: a multi-brand surcharge (`R110 + R50 per additional store`), real-time Courier Guy rate quotes at checkout, or a higher flat fee.

Until Shipping module lands, this gap is invisible in the code — the flat R110 is the only number in play.

**Phase 4 data flow (commit path):**

```
POST /checkout                                     [tx count]
 ├── validate cart (not empty, no unavailable lines)    [-]
 ├── resolve shipping address (existing or guest)       [tx 1 — guest: create User + Address]
 ├── fetch shipping rate from ShippingStubService       [-]
 ├── compute totals (shipping on PaymentGroup only)      [-]
 ├── create Orders + OrderItems + PaymentGroup +
 │   Payments (commission computed here)                [tx 1 continued]
 ├── commit tx 1 ───────────────────────────────────── ✓ DB: PENDING Orders
 ├── call PaymentStubService.initialize                 [HTTP]
 │    ├── success → tx 2: clear cart items ─────────── ✓ DB: empty cart
 │    │             return { redirectUrl, orderNumbers }
 │    └── failure → tx 3: delete Orders/Payments/      ✓ DB: reverted
 │                        PaymentGroup
 │                  return 502 "Payment init failed"
```

Reservations from Phase 3 are untouched throughout. They are only resolved by the Payments module's ITN handler (success → hard-decrement) or the Phase 8 cron (expiry → release).

---

### Phase 5 Decisions — Merchant Order Management

**Scope.** Merchant-facing order list, detail, state transitions, and cancel. These endpoints let merchants view and manage orders placed against their store. All routes are scoped under `stores/:storeId/orders` and guarded by `MERCHANT` role + `StoreService.canManageStore()` (owner or active employee).

| # | Question | Decision |
|---|----------|----------|
| 1 | List orders endpoint shape? | **`GET /stores/:storeId/orders`** with query params. Scoped under the store for natural ownership semantics. |
| 2 | Order detail endpoint? | **`GET /stores/:storeId/orders/:orderId`** — full order with items, buyer contact, shipping address snapshot, payment status. |
| 3 | Filtering & pagination? | **Status filter + order number search + cursor-based pagination.** Default 20 per page, max 50. Date range filtering deferred. |
| 4 | Sorting? | **Newest first, fixed.** No user-selectable sort for MVP. |
| 5 | Merchant-driven state transitions? | **`CONFIRMED → PROCESSING → READY_FOR_DISPATCH`.** Sequential only — no skipping steps. |
| 6 | Who confirms `PENDING → CONFIRMED`? | **Automatic on successful payment** (ITN handler in Payments module). Not a merchant action — Phase 5 starts from `CONFIRMED`. |
| 7 | Merchant cancel constraints? | **`CONFIRMED` or `PROCESSING` only.** Once `READY_FOR_DISPATCH`, cancellation requires admin involvement. |
| 8 | Cancel reason required? | **Yes.** Enum: `OUT_OF_STOCK`, `CANNOT_FULFILL`, `OTHER` + optional freetext notes. Stored as `cancelReason` on the Order row. |
| 9 | Who can access these endpoints? | **Store owner + active employees** via `StoreService.canManageStore()`. Staff model already exists; guard is future-proof. |
| 10 | Guard pattern? | **Reuse `StoreService.canManageStore()`** — no new guard needed. Service calls it at the start of every method. |
| 11 | Order list response shape? | **Summary only:** orderNumber, status, totalInCents, itemCount, buyerName, placedAt. Full items on detail endpoint only. |
| 12 | Buyer contact in merchant view? | **Yes — name, email, phone.** Merchants need this for fulfillment coordination. |

**Phase 5 schema changes.** None. All columns needed (`status`, `cancelReason`, `cancelledAt`, timestamp fields) were established in Phase 1.

**Phase 5 files created:**

- `src/order/merchant-orders/merchant-orders.service.ts` — list, detail, status transition, cancel logic
- `src/order/merchant-orders/merchant-orders.controller.ts` — 4 route handlers
- `src/order/merchant-orders/merchant-orders.service.spec.ts` — 20 tests
- `src/order/dto/merchant-order-query.dto.ts` — status filter, search, cursor, take
- `src/order/dto/update-order-status.dto.ts` — target status enum validation
- `src/order/dto/cancel-order.dto.ts` — `CancelReason` enum + optional notes

**Phase 5 endpoints (4 total):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/stores/:storeId/orders` | MERCHANT + store access | List orders: status filter, order number search, cursor pagination |
| `GET` | `/stores/:storeId/orders/:orderId` | MERCHANT + store access | Full detail: items, buyer info, shipping address, payment |
| `PATCH` | `/stores/:storeId/orders/:orderId/status` | MERCHANT + store access | Advance: `CONFIRMED → PROCESSING → READY_FOR_DISPATCH` |
| `POST` | `/stores/:storeId/orders/:orderId/cancel` | MERCHANT + store access | Cancel with required reason (from `CONFIRMED` or `PROCESSING` only) |

**State machine (merchant-driven transitions only):**

```
                    ┌──────────────┐
  (payment ITN) ──▶ │  CONFIRMED   │
                    └──────┬───────┘
                           │ PATCH status=PROCESSING
                           ▼
                    ┌──────────────┐
                    │  PROCESSING  │
                    └──────┬───────┘
                           │ PATCH status=READY_FOR_DISPATCH
                           ▼
                    ┌──────────────────┐
                    │ READY_FOR_DISPATCH│
                    └──────────────────┘

  Cancel (POST /cancel) allowed from CONFIRMED or PROCESSING only.
  PENDING → CONFIRMED is a payment event, not a merchant action.
  DISPATCHED, IN_TRANSIT, DELIVERED are shipping/courier events (future).
```

**Edge cases handled:**

- **Cross-store access.** 404 (not 403) when order exists but belongs to a different store — consistent with existing 404-not-403 pattern.
- **Invalid transition.** 400 with message "Cannot transition from X to Y" — covers skip attempts (CONFIRMED → READY_FOR_DISPATCH) and backward transitions.
- **Cancel from post-dispatch states.** 400 "Cannot cancel an order in READY_FOR_DISPATCH status" — admin-only path needed for these.
- **Cancel reason format.** `OUT_OF_STOCK` and `CANNOT_FULFILL` stored as-is. `OTHER` with notes stored as `"OTHER: <notes>"` for searchability.

---

### Phase 6 Decisions — Buyer Order Views + Guest Account Claim

**Scope.** Buyer-facing order list, detail, buyer cancel, and guest account claim flow. The buyer endpoints live in the Orders module (`/orders`); the claim endpoint lives in the Auth module (`/auth/claim`).

| # | Question | Decision |
|---|----------|----------|
| 1 | List orders endpoint? | **`GET /orders`** — JWT identifies the buyer, no userId in path needed. |
| 2 | Order detail endpoint? | **`GET /orders/:orderId`** — full detail with items, timeline, shipping address, payment status. |
| 3 | Filtering & pagination? | **Status filter + order number search + cursor-based pagination.** Same pattern as merchant orders. |
| 4 | Multi-store grouping? | **Flat list across all stores.** Frontend groups by store/checkout if desired. |
| 5 | Buyer cancel? | **Yes, from `PENDING` or `CONFIRMED` only.** Once `PROCESSING`, buyer must contact the merchant. |
| 6 | Buyer cancel reason? | **Required enum:** `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `FOUND_CHEAPER`, `OTHER` + optional notes. |
| 7 | Buyer vs merchant detail shape? | **Buyers don't see:** commission, merchant payout. **Buyers see:** status, items, totals, shipping address, payment status (paid/pending/failed), status timeline. |
| 8 | Status timeline? | **Yes.** `placedAt`, `confirmedAt`, `dispatchedAt`, `deliveredAt`, `cancelledAt` — all included in detail response. |
| 9 | Guest claim flow? | **Email verification required** (Option B). Prevents claiming a random guest's account. Verification stubbed for MVP — enforced when Notifications module ships. |
| 10 | Guest order view before claiming? | **Deferred.** Order status communicated via transactional email (future Notifications module). No public order-status endpoint for MVP. |
| 11 | Guest claim implementation scope? | **Scaffold.** `POST /auth/claim` sets password + flips `isGuestAccount: false` + sets `emailVerified: true`. Real OTP/link verification added when Notifications module lands. |

**Phase 6 schema changes.** None.

**Phase 6 files created:**

- `src/order/buyer-orders/buyer-orders.service.ts` — list, detail, buyer cancel
- `src/order/buyer-orders/buyer-orders.controller.ts` — 3 route handlers
- `src/order/buyer-orders/buyer-orders.service.spec.ts` — 13 tests
- `src/order/dto/buyer-order-query.dto.ts` — status filter, search, cursor, take
- `src/order/dto/buyer-cancel-order.dto.ts` — `BuyerCancelReason` enum + optional notes
- `src/auth/claim/claim.service.ts` — guest account claim (password set, verification stubbed)
- `src/auth/claim/claim.controller.ts` — `POST /auth/claim` (public endpoint)
- `src/auth/claim/claim.service.spec.ts` — 5 tests
- `src/auth/dto/claim-account.dto.ts` — email + password validation

**Phase 6 endpoints (4 total):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/orders` | BUYER | List buyer's orders: status filter, order number search, cursor pagination |
| `GET` | `/orders/:orderId` | BUYER | Full detail: items, timeline, shipping address, payment status (no commission) |
| `POST` | `/orders/:orderId/cancel` | BUYER | Cancel from `PENDING` or `CONFIRMED` with required reason |
| `POST` | `/auth/claim` | Public | Guest account claim: set password, flip `isGuestAccount` (verification stubbed) |

**Buyer cancel vs merchant cancel:**

| Aspect | Buyer | Merchant |
|--------|-------|----------|
| Cancellable states | `PENDING`, `CONFIRMED` | `CONFIRMED`, `PROCESSING` |
| Reason enum | `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `FOUND_CHEAPER`, `OTHER` | `OUT_OF_STOCK`, `CANNOT_FULFILL`, `OTHER` |
| After `PROCESSING` | "Please contact the merchant" | Still allowed |
| After `READY_FOR_DISPATCH` | Not allowed | Not allowed (admin-only) |

**Guest account claim flow (scaffold):**

```
POST /auth/claim { email, password }
 ├── find user by email
 │    ├── not found → 404
 │    └── found + isGuestAccount: false → 409 "already registered"
 ├── hash password (bcrypt, 12 rounds)
 ├── update user:
 │    ├── passwordHash = <hashed>
 │    ├── isGuestAccount = false
 │    └── emailVerified = true (stubbed — real verification later)
 └── return { message: "Account claimed" }
```

**TODO when Notifications module ships:** Add email OTP/link verification step before allowing password set. The `emailVerified = true` stub will be replaced with actual verification.

---

### Phase 7 Decisions — Admin Order Views

**Scope.** Cross-store admin order list, full order detail (including payment internals), admin overrides (force-confirm, cancel from any state, edit order), and refund trigger stub. All routes under `/admin/orders`, guarded by `@Roles(UserRole.ADMIN)`.

| # | Question | Decision |
|---|----------|----------|
| 1 | List orders endpoint? | **`GET /admin/orders`** — dedicated admin namespace, clean separation from buyer/merchant controllers. |
| 2 | Order detail endpoint? | **`GET /admin/orders/:orderId`** — admin sees everything: payment internals, commission, merchant payout, buyer account type. |
| 3 | Filtering? | **Store filter (`storeId`), status filter, order number search, buyer email search, cursor pagination.** Date range deferred. |
| 4 | Sorting? | **Newest first, fixed.** |
| 5 | Admin state transitions? | **Force-confirm (`PENDING → CONFIRMED`) + cancel from any non-terminal state.** Merchants own their forward workflow; admin unblocks stuck orders. |
| 6 | Admin cancel reasons? | **Admin-specific enum:** `FRAUD`, `POLICY_VIOLATION`, `CUSTOMER_REQUEST`, `MERCHANT_REQUEST`, `OTHER`. Stored with `ADMIN:` prefix for auditability. |
| 7 | Admin edit order? | **Yes — shipping address and notes.** Enables ops to fix delivery issues without requiring buyer/merchant involvement. |
| 8 | Refund trigger? | **Stub only.** `POST /admin/orders/:orderId/refund` sets `Order.status = REFUND_REQUESTED`. Real refund processing deferred to Payments module. |
| 9 | Partial refunds? | **Full refund only for MVP.** Partial refunds deferred (which items, commission recalculation). |
| 10 | Authorization? | **`@Roles(UserRole.ADMIN)`** — single admin role. Granular admin permissions deferred. |

**Phase 7 schema changes.** None.

**Phase 7 files created:**

- `src/order/admin-orders/admin-orders.service.ts` — list, detail, force-confirm, cancel, edit, refund stub
- `src/order/admin-orders/admin-orders.controller.ts` — 6 route handlers
- `src/order/admin-orders/admin-orders.service.spec.ts` — 27 tests
- `src/order/dto/admin-order-query.dto.ts` — storeId, status, search, buyerEmail, cursor, take
- `src/order/dto/admin-cancel-order.dto.ts` — `AdminCancelReason` enum + optional notes
- `src/order/dto/admin-edit-order.dto.ts` — optional shipping address fields + notes

**Phase 7 endpoints (6 total):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin/orders` | ADMIN | Cross-store list: store/status/orderNumber/buyerEmail filters, cursor pagination |
| `GET` | `/admin/orders/:orderId` | ADMIN | Full detail: items, buyer (incl. isGuestAccount), store, payment internals, timeline |
| `PATCH` | `/admin/orders/:orderId` | ADMIN | Edit shipping address and/or notes |
| `POST` | `/admin/orders/:orderId/confirm` | ADMIN | Force-confirm a `PENDING` order (manual payment verification) |
| `POST` | `/admin/orders/:orderId/cancel` | ADMIN | Cancel from any non-terminal state with admin-specific reason |
| `POST` | `/admin/orders/:orderId/refund` | ADMIN | Stub: sets `REFUND_REQUESTED` (real processing in Payments module) |

**Admin cancel reason format:** `ADMIN:FRAUD`, `ADMIN:POLICY_VIOLATION`, `ADMIN:CUSTOMER_REQUEST`, `ADMIN:MERCHANT_REQUEST`, `ADMIN:OTHER: <notes>`. The `ADMIN:` prefix distinguishes admin cancels from buyer/merchant cancels in the `cancelReason` column.

**Admin vs buyer vs merchant cancel comparison:**

| Aspect | Buyer | Merchant | Admin |
|--------|-------|----------|-------|
| Cancellable states | `PENDING`, `CONFIRMED` | `CONFIRMED`, `PROCESSING` | All except `DELIVERED`, `REFUNDED`, `CANCELLED` |
| Reason enum | `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `FOUND_CHEAPER`, `OTHER` | `OUT_OF_STOCK`, `CANNOT_FULFILL`, `OTHER` | `FRAUD`, `POLICY_VIOLATION`, `CUSTOMER_REQUEST`, `MERCHANT_REQUEST`, `OTHER` |
| Stored format | `CHANGED_MIND` | `OUT_OF_STOCK` | `ADMIN:FRAUD` |

**Refund stub flow:**

```
POST /admin/orders/:orderId/refund
 ├── find order → 404 if not found
 ├── reject if PENDING (cancel instead)
 ├── reject if already REFUNDED or REFUND_REQUESTED
 └── set status = REFUND_REQUESTED
     └── When Payments module ships: ITN handler picks up REFUND_REQUESTED,
         calls PayFast refund API, updates Payment, sets REFUNDED.
```

---

### Phase 8 Decisions — Cron: Cart & Stock Cleanup

**Scope.** Scheduled cleanup job that runs every 5 minutes. Two tasks: release stock reservations on stale carts (24h) and expire PENDING orders (30 min). Uses `@nestjs/schedule` with `@Cron()` — runs in-process.

| # | Question | Decision |
|---|----------|----------|
| 1 | Stale cart threshold? | **24 hours** since last cart activity (`Cart.updatedAt`). Fixed constant, not env-configurable. |
| 2 | What does cart cleanup do? | **Release stock reservations only.** Cart items are kept — they become unreserved. Re-reserved on next checkout attempt. |
| 3 | Per-item or per-cart staleness? | **Per-cart.** If any item was updated recently, the whole cart is fresh. |
| 4 | Pending order threshold? | **30 minutes** after order creation with no payment. |
| 5 | What does order expiry do? | **Cancel order + release stock.** PaymentGroup and Payments kept for audit. |
| 6 | Cancel reason for expired orders? | **`SYSTEM:PAYMENT_TIMEOUT`** — distinguishes system-initiated from buyer/merchant/admin cancels. |
| 7 | Cron frequency? | **Every 5 minutes.** Single job handles both tasks. |
| 8 | Implementation? | **`@nestjs/schedule`** with `@Cron(CronExpression.EVERY_5_MINUTES)`. In-process. |
| 9 | Batch size? | **100 per batch.** Loop until no more stale items. Per-item error handling — one failure doesn't block the batch. |

**Phase 8 schema changes.** None.

**Phase 8 dependency added:** `@nestjs/schedule` — registered via `ScheduleModule.forRoot()` in `app.module.ts`.

**Phase 8 files created:**

- `src/order/cron/order-cleanup.service.ts` — `@Cron` job with `releaseStaleCartReservations()` and `expirePendingOrders()`
- `src/order/cron/order-cleanup.service.spec.ts` — 10 tests (stale cart release, pending order expiry, batching, error resilience)

**Cleanup behavior summary:**

| Task | Trigger | Action | Side effects |
|------|---------|--------|-------------|
| Stale cart | `Cart.updatedAt` < 24h ago | Release stock for all items, touch `updatedAt` | Items stay in cart (unreserved) |
| Pending order | `Order.createdAt` < 30m ago, status=PENDING | Release stock, set CANCELLED, set `cancelReason=SYSTEM:PAYMENT_TIMEOUT` | PaymentGroup + Payments kept |

**Cancel reason prefix convention (all sources):**

| Source | Format | Examples |
|--------|--------|---------|
| Buyer | `REASON` | `CHANGED_MIND`, `ORDERED_BY_MISTAKE` |
| Merchant | `REASON` | `OUT_OF_STOCK`, `CANNOT_FULFILL` |
| Admin | `ADMIN:REASON` | `ADMIN:FRAUD`, `ADMIN:POLICY_VIOLATION` |
| System | `SYSTEM:REASON` | `SYSTEM:PAYMENT_TIMEOUT` |

---

### Phase 9 — Wishlist

**Scope.** Simple wishlist CRUD — add/remove/list. Product-level bookmarks for authenticated buyers. No variants on wishlist (wishlisting is at the product level, variant selection happens at add-to-cart).

**Phase 9 schema changes.** None. `WishlistItem` model already existed in Phase 1 schema with `@@unique([userId, productId])`.

**Phase 9 files created:**

- `src/order/wishlist/wishlist.service.ts` — list (paginated with product details), add (with P2002 duplicate handling), remove
- `src/order/wishlist/wishlist.controller.ts` — 3 route handlers
- `src/order/wishlist/wishlist.service.spec.ts` — 12 tests

**Phase 9 endpoints (3 total):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/wishlist` | BUYER | Paginated list with product details, price, store, availability status |
| `POST` | `/wishlist/:productId` | BUYER | Add product to wishlist (409 if already wishlisted, 404 if not ACTIVE) |
| `DELETE` | `/wishlist/:itemId` | BUYER | Remove item (204 No Content) |

**Design notes:**
- `isAvailable` flag in response reflects current `ProductStatus.ACTIVE` — wishlisted products that get archived/deactivated show as unavailable but stay in the list.
- `totalCount` included in list response for UI badge display.
- Duplicate add returns 409 (not idempotent 200) — frontend should check before calling or handle the 409.
- Remove uses 404-not-403 ownership pattern.

---

## References

- **YIIVA philosophy:** `docs/about_yiiva.md`
- **Prisma schema:** `prisma/schema.prisma`
- **Auth patterns:** `docs/auth-guide.md`
- **Store module:** `docs/store-module-*.md`
- **Product module:** `docs/product-module/`
