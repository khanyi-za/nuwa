# STATUS.md — Last updated 2026-04-22

## Where we are

Order module Phases 1–9 are complete. Phase 10 (Consolidated Testing) is the only remaining phase. Nothing is half-finished.

There are **uncommitted changes** on `main` from this session covering Phase 8 (Cron Cleanup), Phase 9 (Wishlist), `@nestjs/schedule` dependency, `ScheduleModule` registration, foundation doc updates for Phases 8 & 9, and the updated CLAUDE.md. The user has not asked for a commit yet.

223 tests across 15 suites, all passing in ~2.5s.

## What was built this session (after Phase 7 commit)

### Phase 7 — Admin Order Views (committed in `460caa1`)

Already committed. Includes admin-orders service/controller/spec, admin DTOs, force-confirm, admin cancel, admin edit (user chose Option A — admin CAN edit orders), refund stub.

### Phase 8 — Cron: Cart & Stock Cleanup (uncommitted)

Files created:
- `src/order/cron/order-cleanup.service.ts` — `@Cron(CronExpression.EVERY_5_MINUTES)`
- `src/order/cron/order-cleanup.service.spec.ts` — 10 tests

Key decisions the user made:
- **A1 — 24h fixed cutoff**, not env-configurable (Option A)
- **A2 — Release stock only, keep cart items** (Option B) — buyers don't lose their cart, items become unreserved, re-reserve on next checkout attempt
- **A3 — 30 min pending order expiry** (Option A) — keep PaymentGroup/Payments for audit trail, just cancel the order and release stock
- **Batch processing** — 100 per batch, `while (true) { findMany take:100; if length < 100 break; }`, per-item try/catch with `this.logger.error()`
- Cancel reason for expired orders: `SYSTEM:PAYMENT_TIMEOUT`

Dependencies added:
- `npm install @nestjs/schedule` (added to package.json)
- `ScheduleModule.forRoot()` added to `src/app.module.ts` imports

### Phase 9 — Wishlist (uncommitted)

Files created:
- `src/order/wishlist/wishlist.service.ts` — list (paginated), add, remove
- `src/order/wishlist/wishlist.controller.ts` — GET /, POST /:productId (201), DELETE /:itemId (204)
- `src/order/wishlist/wishlist.service.spec.ts` — 12 tests

Key decisions:
- Wishlist at product level, not variant level
- `@@unique([userId, productId])` — P2002 Prisma error → 409 ConflictException
- `isAvailable` computed from `ProductStatus.ACTIVE` (shows greyed out in frontend if archived/out of stock)
- `totalCount` included in response for badge display
- Product image: first by `sortOrder`, null if none

## Uncommitted changes

Everything below is uncommitted on `main` (last commit: `460caa1 phase 7 of order module`):

```
Modified:
  CLAUDE.md                                      — Updated for Phases 7-9, ScheduleModule, 223 tests
  docs/order-module/order-module-foundation.md   — Phase 8 + 9 decisions added
  package.json / package-lock.json               — @nestjs/schedule dependency added
  src/app.module.ts                              — ScheduleModule.forRoot() registered
  src/order/order.module.ts                      — OrderCleanupService, WishlistController, WishlistService registered

Untracked:
  src/order/cron/order-cleanup.service.ts
  src/order/cron/order-cleanup.service.spec.ts
  src/order/wishlist/wishlist.service.ts
  src/order/wishlist/wishlist.controller.ts
  src/order/wishlist/wishlist.service.spec.ts
```

## What we tried and rejected

1. **Proportional shipping split** (rejected during Phase 4 shipping restructure, prior session): Was splitting R110 shipping across Orders proportionally to each store's subtotal. Rejected because YIIVA pays The Courier Guy directly — merchants never touch shipping money. Shipping now lives solely on `PaymentGroup.shippingInCents`. `Order.shippingInCents = 0` always.

2. **Configurable stale cart cutoff** (rejected for Phase 8): Could have made the 24h/30min cutoffs env-configurable. User chose fixed values — simpler, no reason to change them per-environment.

3. **Delete cart items on stale cleanup** (rejected for Phase 8): Could have wiped the entire cart on staleness. User chose to keep items and only release stock — less hostile UX, buyer just needs to re-checkout.

4. **Delete PaymentGroup/Payments on order expiry** (rejected for Phase 8): Could have cascaded the delete. User chose to keep them for audit trail.

5. **Variant-level wishlist** (rejected for Phase 9): Could have wishlisted specific variants. User chose product-level — simpler, buyer picks variant at cart time.

## What's fragile

1. **TS2502 errors in spec files**: `$transaction` mock pattern causes `'tx' is referenced directly or indirectly in its own type annotation` in `address.service.spec.ts:55`, `cart.service.spec.ts:77`, `checkout.service.spec.ts:113`, and `order-cleanup.service.spec.ts`. These are harmless — Jest/ts-jest runs fine. Do NOT try to fix them.

2. **Cart compound unique with NULL variantId**: Postgres `NULLS DISTINCT` means `@@unique([cartId, productId, variantId])` doesn't enforce uniqueness when variantId is NULL. A partial unique index migration exists (`20260416120000_cart_item_bare_product_unique`) and cart uses `findFirst + create/update` instead of `upsert`. Any new compound unique with nullable fields will hit this same issue.

3. **Cron Logger output in tests**: The error-resilience tests in `order-cleanup.service.spec.ts` produce expected ERROR log lines. These are intentional — they verify one failure doesn't block the batch.

4. **`$transaction` mock re-binding**: `jest.clearAllMocks()` wipes the `$transaction` mock. Any spec using transactions must re-bind in `beforeEach`: `mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma))`.

5. **Guest checkout stock reservation timing**: Cart clearing at checkout does NOT release stock (uses raw `prisma.cartItem.deleteMany`, not `CartService.clear()`). This is intentional — stock ownership transfers from cart reservation to order at commit time.

## What to do next

### Option A: Commit current work first

Run `git add` for all modified + untracked files above and commit. Suggested message: `"phase 8 & 9 of order module"`.

### Option B: Phase 10 — Consolidated Testing

From `docs/order-module/order-module-foundation.md`:
> **Phase 10 — Consolidated Testing**: Full-module cross-feature tests, edge cases, regression tests.

This phase reviews all existing 223 tests for coverage gaps, adds integration-style tests across module boundaries (e.g., cart → checkout → merchant order flow), and verifies edge cases that individual phase tests may not cover.

### Future work (not part of Order module)

- **Payments module**: Real PayFast integration, ITN webhook, refund API. Replace `PaymentStubService`.
- **Shipping module**: Real Courier Guy integration, tracking. Replace `ShippingStubService`.
- **Notifications module**: Email verification for guest claim, order status emails.
- **CORS config**: Needs to be added before frontend integration.
- **e2e tests**: Only unit tests exist currently.

## Do not touch

- **Do not refactor existing Phase 1–9 code** unless the user asks. It's working, tested, and decisions are documented.
- **Do not fix the TS2502 errors** in spec files. They're a known Prisma generics issue with mock types. Tests pass fine.
- **Do not add CORS, e2e tests, or image upload** — those are separate workstreams.
- **Do not implement real PayFast or Courier Guy integrations** — those are the Payments and Shipping modules respectively, not part of the Order module.
- **Do not change the shipping model** — we deliberately moved shipping to PaymentGroup. `Order.shippingInCents = 0` is correct and intentional.
- **Do not add email verification to the claim flow** — that's blocked on the Notifications module which doesn't exist yet.
- **Do not change cron cutoff values** — 24h for stale carts, 30 min for pending orders. User chose fixed values intentionally.
