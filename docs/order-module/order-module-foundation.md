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

---

## References

- **YIIVA philosophy:** `docs/about_yiiva.md`
- **Prisma schema:** `prisma/schema.prisma`
- **Auth patterns:** `docs/auth-guide.md`
- **Store module:** `docs/store-module-*.md`
- **Product module:** `docs/product-module/`
