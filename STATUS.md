# STATUS.md — Last updated 2026-04-22

## Where we are

We are building the **Order module** for YIIVA, phase by phase. Phases 1–6 are complete. Phase 7 (Admin Order Views) is next. Nothing is half-finished — Phase 6 landed cleanly and all 174 tests pass.

There are **uncommitted changes** on `main` from this session. They cover Phase 5 (Merchant Order Management), Phase 6 (Buyer Order Views + Guest Account Claim), the shipping restructure from late Phase 4, and the CLAUDE.md file. The user has not asked for a commit yet.

## What was built this session

### Shipping restructure (mid-Phase 4 fix)

The user caught a fundamental design flaw: we were splitting the R110 shipping fee proportionally across Orders and sending shipping money to merchants. But merchants never touch shipping — YIIVA pays The Courier Guy directly. The proportional split was unnecessary complexity.

**What changed:**
- Removed `splitShippingProportional()` from `src/order/checkout/totals.ts` entirely
- Removed `shippingInCents` from `CheckoutStoreGroup` interface — stores no longer carry shipping
- `Order.shippingInCents = 0` always (set in `checkout.service.ts:193`)
- `Order.totalInCents = subtotalInCents` (no shipping mixed in, `checkout.service.ts:195`)
- Added `shippingInCents Int @default(0)` to `PaymentGroup` model in schema (`prisma/schema.prisma:803`)
- `PaymentGroup.shippingInCents = totals.grandShippingInCents` (set in `checkout.service.ts:232`)
- `Payment.amountGrossInCents = storeGroup.subtotalInCents` — merchant's slice only, no shipping (`checkout.service.ts:241`)
- Migration applied: `prisma/migrations/20260416140000_add_shipping_to_payment_group/`
- Updated 8 test expectations across `totals.spec.ts` and `checkout.service.spec.ts`
- Updated Phase 4 decision #4 in `docs/order-module/order-module-foundation.md`

**What we rejected:** The proportional split (each Order gets `round(R110 * subtotal / grandSubtotal)` with rounding pennies to the largest store). It was technically correct but architecturally wrong — it modeled money flow that doesn't exist.

### Phase 5 — Merchant Order Management

Files created:
- `src/order/merchant-orders/merchant-orders.service.ts` — list, detail, status transition, cancel
- `src/order/merchant-orders/merchant-orders.controller.ts` — 4 endpoints under `stores/:storeId/orders`
- `src/order/merchant-orders/merchant-orders.service.spec.ts` — 20 tests
- `src/order/dto/merchant-order-query.dto.ts`
- `src/order/dto/update-order-status.dto.ts`
- `src/order/dto/cancel-order.dto.ts` — `CancelReason` enum: `OUT_OF_STOCK`, `CANNOT_FULFILL`, `OTHER`

Key decisions:
- Authorization via `StoreService.canManageStore()` — owner + active employee, already existed
- `PENDING→CONFIRMED` is NOT a merchant action (that's a payment event from ITN)
- Merchant transitions: `CONFIRMED→PROCESSING→READY_FOR_DISPATCH` only, sequential
- Cancel from `CONFIRMED` or `PROCESSING` only. After `READY_FOR_DISPATCH`, admin needed.
- Cancel reason stored as `"OUT_OF_STOCK"` or `"OTHER: <freetext>"` on `Order.cancelReason`

### Phase 6 — Buyer Order Views + Guest Account Claim

Files created:
- `src/order/buyer-orders/buyer-orders.service.ts` — list, detail, cancel
- `src/order/buyer-orders/buyer-orders.controller.ts` — 3 endpoints under `/orders`
- `src/order/buyer-orders/buyer-orders.service.spec.ts` — 13 tests
- `src/order/dto/buyer-order-query.dto.ts`
- `src/order/dto/buyer-cancel-order.dto.ts` — `BuyerCancelReason` enum: `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `FOUND_CHEAPER`, `OTHER`
- `src/auth/claim/claim.service.ts` — guest account claim (password set, verification stubbed)
- `src/auth/claim/claim.controller.ts` — `POST /auth/claim` (public endpoint)
- `src/auth/claim/claim.service.spec.ts` — 5 tests
- `src/auth/dto/claim-account.dto.ts`

Key decisions:
- `GET /orders` not `GET /users/:userId/orders` — JWT already identifies the buyer
- Flat list across all stores, frontend groups if desired
- Buyer cancel from `PENDING` or `CONFIRMED` only (once `PROCESSING`, contact merchant)
- Buyer detail includes status timeline (`placedAt`, `confirmedAt`, `dispatchedAt`, `deliveredAt`, `cancelledAt`) but NOT commission/payout fields
- `paymentStatus` exposed as simple string (PENDING/COMPLETED/FAILED), not the full Payment object
- Guest claim is a scaffold: `POST /auth/claim { email, password }` sets password + flips `isGuestAccount: false` + stubs `emailVerified: true`. Real OTP verification deferred to Notifications module.
- Guest order view deferred — guests get order status via transactional email (future), not via API

Modified files:
- `src/order/order.module.ts` — registered `BuyerOrdersController` + `BuyerOrdersService`
- `src/auth/auth.module.ts` — registered `ClaimController` + `ClaimService`
- `docs/order-module/order-module-foundation.md` — added Phase 5 + Phase 6 decision logs

## What's working

- 174 tests, 12 suites, all green (<2.5s)
- `npx tsc --noEmit` shows only the 3 pre-existing TS2502 errors in spec files (from the `$transaction` mock pattern). These have been there since Phase 2 and don't affect test execution. They are in `address.service.spec.ts:55`, `cart.service.spec.ts:77`, `checkout.service.spec.ts:113`. Do not try to fix them — they're a Prisma type inference quirk with `jest.fn((fn) => fn(mockPrisma))`.

## Uncommitted changes

Everything below is uncommitted on `main`:

```
Modified:
  docs/order-module/order-module-foundation.md   — Phase 5 + 6 decisions added
  src/auth/auth.module.ts                        — ClaimController + ClaimService registered
  src/order/order.module.ts                      — BuyerOrdersController + BuyerOrdersService registered

Untracked:
  CLAUDE.md
  STATUS.md
  src/auth/claim/claim.controller.ts
  src/auth/claim/claim.service.ts
  src/auth/claim/claim.service.spec.ts
  src/auth/dto/claim-account.dto.ts
  src/order/buyer-orders/buyer-orders.controller.ts
  src/order/buyer-orders/buyer-orders.service.ts
  src/order/buyer-orders/buyer-orders.service.spec.ts
  src/order/dto/buyer-cancel-order.dto.ts
  src/order/dto/buyer-order-query.dto.ts
```

Note: Phase 5 files (merchant-orders, cancel-order.dto, update-order-status.dto, merchant-order-query.dto) were committed in `a029f52` along with Phase 4 checkout. The shipping restructure (totals.ts simplification, checkout.service.ts changes, PaymentGroup migration) was also in that commit. Only Phase 6 + CLAUDE.md + this file are uncommitted.

Wait — let me verify. The git status shows `order.module.ts` as modified. That file has both Phase 5 (MerchantOrders) and Phase 6 (BuyerOrders) registrations. Let me check: `a029f52` was the last commit message "phase 4 & 5 work on the order module". So Phase 5 merchant-orders code IS committed, but the `order.module.ts` modification adding BuyerOrders is not. The merchant-orders files themselves may or may not be committed — the user should verify with `git diff HEAD` if unsure.

## Lessons learned the hard way

These are things that bit us during implementation and aren't obvious from reading the code:

1. **Prisma compound unique with nullable fields**: `@@unique([cartId, productId, variantId])` does NOT enforce uniqueness when `variantId` is NULL. Postgres treats each NULL as distinct (NULLS DISTINCT default). We had to add a partial unique index migration (`20260416120000_cart_item_bare_product_unique`) and rewrite cart `upsert` to `findFirst + create/update`. If you add any new compound unique with nullable fields, you'll hit this same issue.

2. **`let x = null` type narrowing**: In `checkout.service.ts`, `let variant = null; if (cond) { variant = await prisma... }` narrows `variant` to `never` after the if-block because TS infers `null` as the literal type. Fix: destructure into separate `let` variables (`let variantName: string | null = null; let variantPrice: number | null = null;`).

3. **`$transaction` mock and test chaining**: `jest.clearAllMocks()` in `beforeEach` wipes the `$transaction` mock. Must re-bind: `mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma))`. Also, `user.findUnique` is called multiple times in guest checkout (email collision check inside TX + buyer info fetch after TX) — need `mockResolvedValueOnce(null).mockResolvedValueOnce({...})` chaining, and tests that re-mock need `.mockReset()` first.

4. **Cart clearing at checkout must NOT release stock**: `CartService.clear()` releases stock reservations, but at checkout the reservations become order reservations. Cart clearing uses raw `prisma.cartItem.deleteMany` instead of `CartService.clear()`. This is intentional — `checkout.service.ts:306`.

5. **`OptionalJwtAuthGuard` handleRequest signature**: Must accept `(err: any, user: any, info: any)` — not `(unknown, unknown)`. The third `info` param is required to match the parent class signature even though we don't use it.

6. **availableQuantity formula in cart view**: Original formula `Math.max(0, stockPool + item.quantity)` could return values larger than `item.quantity` in healthy state. Correct formula: `Math.max(0, Math.min(item.quantity, totalCapacity - otherReservations))`.

## What to do next

### First: Phase 7 — Admin Order Views

From the phase breakdown in `docs/order-module/order-module-foundation.md`:
> **Phase 7 — Admin Order Views**: Admin cross-store order list, admin overrides, refund trigger point (stub). Steps 23–24.

This needs planning questions answered by the user. Key decisions to ask:

- Admin order list: cross-store, filterable by store/status/date?
- Admin overrides: which state transitions can admin force? (e.g., cancel from any state, force refund)
- Refund trigger: stub only (like payment/shipping) or actual implementation?
- Admin guard: new `@Roles(UserRole.ADMIN)` guard or something more granular?
- Should admin be able to edit order details (shipping address, notes)?

Create the controller/service/spec under `src/order/admin-orders/`. Follow the exact same patterns as `merchant-orders` and `buyer-orders`.

### Second: Phase 8 — Cron: Cart & Stock Cleanup

- Release reservations on stale carts (24h inactivity)
- Expire PENDING orders after 30 min (no PayFast ITN received)
- This is a scheduled task, probably using `@nestjs/schedule` with `@Cron()`

### Third: Phase 9 — Wishlist

- Simple CRUD on `WishlistItem` (model already exists in schema)
- `src/order/wishlist/` directory already exists (empty)
- Comment in `order.module.ts:47` says "WishlistController — added in Phase 9"

## Do not touch

- **Do not refactor existing Phase 1–6 code** unless the user asks. It's working, tested, and decisions are documented.
- **Do not fix the TS2502 errors** in spec files. They're a known Prisma generics issue with mock types. Tests pass fine.
- **Do not add CORS, e2e tests, or image upload** — those are separate workstreams.
- **Do not implement real PayFast or Courier Guy integrations** — those are the Payments and Shipping modules respectively, not part of the Order module.
- **Do not change the shipping model** — we deliberately moved shipping to PaymentGroup. `Order.shippingInCents = 0` is correct and intentional.
- **Do not add email verification to the claim flow** — that's blocked on the Notifications module which doesn't exist yet.
