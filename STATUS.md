# STATUS.md — Last updated 2026-04-23

## Where we are

**Order module is complete.** All 10 phases are done. 246 tests across 15 suites, all passing in ~2s.

There are **uncommitted changes** on `main` covering:
- Phase 8 (Cron Cleanup) + Phase 9 (Wishlist) — from prior session
- Phase 10 (Consolidated Testing) — from this session
- Bug fix: OrderCleanupService `updatedAt` bump on failure
- `@nestjs/schedule` dependency + `ScheduleModule` registration
- Foundation doc updates for Phases 8, 9, 10
- Updated CLAUDE.md + STATUS.md

The user has not asked for a commit yet.

## What was built this session

### Phase 10 — Consolidated Testing

**Bug fix:** `OrderCleanupService.releaseStaleCartReservations()` was not bumping `cart.updatedAt` when a transaction failed, causing the same broken cart to be re-processed every 5-minute cron cycle indefinitely. Fixed by adding a `cart.update` call in the catch block (`order-cleanup.service.ts:98-105`).

**False alarm:** `MerchantOrdersService.updateStatus()` was flagged as a likely bug (backward transitions causing TypeError), but the code already has `if (!allowed || !allowed.includes(targetStatus))` which handles undefined `ALLOWED_TRANSITIONS` entries correctly.

**23 new tests added across 8 spec files:**

| Suite | Added | What they cover |
|-------|-------|-----------------|
| CheckoutService | +6 | Empty addressId, empty items array, variant validation (not found + wrong product), rollback FK deletion order, order number collision retry |
| CheckoutTotals | +3 | Empty items array, fractional commission rounding, same-store item grouping |
| MerchantOrdersService | +3 | Backward transitions (READY_FOR_DISPATCH, DELIVERED, CANCELLED → throws 400) |
| CartService | +3 | Zero capacity availability, abundant stock cap, variant stock availability |
| AdminOrdersService | +3 | Empty string field values in edit, refund on CANCELLED order, refund on DISPATCHED |
| BuyerOrdersService | +2 | Null payment relation, OTHER reason without notes |
| ClaimService | +2 | Already-verified guest (idempotent), bcrypt.hash failure propagation |
| OrderCleanupService | +1 | Pending order BATCH_SIZE loop termination |

**Phase 10 plan documented** in `docs/order-module/order-module-foundation.md` sections 10.1–10.5.

## Uncommitted changes

Everything below is uncommitted on `main` (last commit: user's Phase 8+9 commit):

```
Modified:
  CLAUDE.md                                      — Phase 10 complete, 246 tests
  STATUS.md                                      — This file
  docs/order-module/order-module-foundation.md   — Phase 8 + 9 + 10 decisions/plan
  package.json / package-lock.json               — @nestjs/schedule dependency
  src/app.module.ts                              — ScheduleModule.forRoot() registered
  src/order/order.module.ts                      — OrderCleanupService, WishlistController, WishlistService
  src/order/cron/order-cleanup.service.ts        — Bug fix: updatedAt bump on failure
  src/order/cron/order-cleanup.service.spec.ts   — Updated test for bug fix + 1 new test
  src/order/checkout/checkout.service.spec.ts    — +6 tests
  src/order/checkout/totals.spec.ts              — +3 tests
  src/order/merchant-orders/merchant-orders.service.spec.ts — +3 tests
  src/order/cart/cart.service.spec.ts             — +3 tests
  src/order/admin-orders/admin-orders.service.spec.ts — +3 tests
  src/order/buyer-orders/buyer-orders.service.spec.ts — +2 tests
  src/auth/claim/claim.service.spec.ts           — +2 tests

Untracked:
  src/order/cron/order-cleanup.service.ts
  src/order/cron/order-cleanup.service.spec.ts
  src/order/wishlist/wishlist.service.ts
  src/order/wishlist/wishlist.controller.ts
  src/order/wishlist/wishlist.service.spec.ts
```

## What's fragile

1. **TS2502 errors in spec files**: `$transaction` mock pattern causes type errors in `address.service.spec.ts:55`, `cart.service.spec.ts:77`, `checkout.service.spec.ts:113`, and `order-cleanup.service.spec.ts`. Harmless — Jest/ts-jest runs fine. Do NOT fix.

2. **Cart compound unique with NULL variantId**: Postgres `NULLS DISTINCT` means `@@unique([cartId, productId, variantId])` doesn't enforce uniqueness when variantId is NULL. Partial unique index migration exists. Any new compound unique with nullable fields hits this.

3. **Cron Logger output in tests**: Error-resilience tests produce expected ERROR log lines. Intentional.

4. **`$transaction` mock re-binding**: `jest.clearAllMocks()` wipes the `$transaction` mock. Must re-bind in `beforeEach`.

5. **Guest checkout stock reservation timing**: Cart clearing at checkout does NOT release stock (uses raw `prisma.cartItem.deleteMany`, not `CartService.clear()`). Intentional — stock ownership transfers from cart to order at commit time.

6. **Admin editOrder accepts empty strings**: `editOrder({ shippingName: '' })` clears the field. The `!== undefined` check is intentional — admin can blank out fields. Documented in Phase 10 test.

7. **Admin refund allows CANCELLED orders**: `requestRefund()` does not reject CANCELLED orders — only PENDING, REFUNDED, and REFUND_REQUESTED are rejected. This may need a policy decision when Payments module ships.

## What to do next

The Order module is complete. Next steps are separate modules:

- **Payments module**: Real PayFast integration, ITN webhook, refund API. Replace `PaymentStubService`. Swap `useClass` in `order.module.ts`.
- **Shipping module**: Real Courier Guy integration, tracking. Replace `ShippingStubService`. Swap `useClass` in `order.module.ts`.
- **Notifications module**: Email verification for guest claim, order status emails.
- **CORS config**: Needs to be added before frontend integration.
- **e2e tests**: Only unit tests exist currently.

## Do not touch

- **Do not refactor existing Order module code** unless the user asks. It's working, tested, and decisions are documented.
- **Do not fix the TS2502 errors** in spec files.
- **Do not add CORS, e2e tests, or image upload** — separate workstreams.
- **Do not implement real PayFast or Courier Guy integrations** — those are the Payments and Shipping modules.
- **Do not change the shipping model** — `Order.shippingInCents = 0` is correct. Shipping lives on PaymentGroup.
- **Do not add email verification to the claim flow** — blocked on Notifications module.
- **Do not change cron cutoff values** — 24h for stale carts, 30 min for pending orders.
