# CLAUDE.md — YIIVA Nuwa API

You are working on **Nuwa**, the backend API for YIIVA — a South African commerce marketplace connecting local merchants (clothing, home, accessories) with buyers. NestJS 11 + Prisma 7 + PostgreSQL. TypeScript. Jest for tests.

## What this project does

YIIVA is a multi-merchant marketplace. Merchants create stores, list products, and fulfill orders. Buyers browse across stores, build multi-brand carts, and check out in a single transaction. YIIVA handles payments (PayFast), shipping (The Courier Guy), and takes a 5.5% commission on subtotals.

The API serves a Next.js frontend (separate repo). This is the backend only.

## Architecture

### Module dependency graph

```
AppModule
 ├── AuthModule        — JWT auth, registration, login, password reset, account claim
 ├── StoreModule       — Store CRUD, admin review, employee invites, store addresses
 ├── ProductModule     — Products, variants, images, collections, tags, categories
 ├── OrderModule       — Cart, checkout, orders (buyer + merchant + admin views), addresses, wishlist, cron cleanup
 ├── PaymentsModule    — PayFast integration: signing, ITN webhook, refunds, reconciliation
 ├── PrismaModule      — Database singleton (global)
 ├── EmailModule       — Transactional email via Resend
 ├── ScheduleModule    — @nestjs/schedule for cron jobs (global)
 ├── ConfigModule      — Environment variables (global)
 └── ThrottlerModule   — Rate limiting (global, 100 req/60s)
```

**Key dependency rules:**
- OrderModule imports StoreModule + ProductModule directly.
- OrderModule imports PaymentsModule and binds `PAYMENT_SERVICE` to the real `PaymentsService` via `useClass`. PaymentsService's deps (`PayfastConfig`, `PayfastSignatureService`) resolve from PaymentsModule's exports.
- OrderModule consumes Shipping via **injection-token contract** (`SHIPPING_SERVICE`). Still on `ShippingStubService` until Shipping module ships.
- AdminOrdersService injects `IPaymentService` via `PAYMENT_SERVICE` token (for refund flow).
- No circular dependencies. PaymentsModule reads from `OrderModule`-owned tables (PaymentGroup, Payment, Order) but does not import OrderModule.
- PrismaModule is global — every module injects PrismaService without importing PrismaModule.

### Why it's structured this way

Each module owns its own controllers, services, DTOs, and specs. Sub-features within a module get their own subdirectory (e.g., `order/cart/`, `order/checkout/`, `order/merchant-orders/`, `payments/payfast/`). This keeps feature boundaries clear and allows parallel development.

The contract/stub pattern (`PAYMENT_SERVICE`, `SHIPPING_SERVICE` tokens) lets the full checkout flow be coded and tested end-to-end without those modules existing. When they ship, only the module-level binding changes — zero consumer code changes. Payments shipped this way; Shipping is still on its stub.

### Global middleware and guards

- **CORS** (global, `main.ts`): `app.enableCors(buildCorsOptions())` from `src/cors.config.ts`. Env-driven `CORS_ORIGINS` allowlist (comma-separated). Production fails to boot if `CORS_ORIGINS` is empty. `credentials: true` to support the refresh-token cookie. PayFast ITN webhook is server-to-server and unaffected.
- **ValidationPipe** (global, `main.ts`): `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. DTOs use class-validator decorators.
- **JwtAuthGuard** (global APP_GUARD): Every route requires JWT unless decorated with `@Public()`. Handles `TokenExpiredError` vs `JsonWebTokenError` distinctly for frontend silent-refresh flow.
- **ThrottlerGuard** (global APP_GUARD): 100 requests per 60 seconds.

### Auth flow

JWT access tokens (15m) + refresh tokens (7d, httpOnly cookie, single-use rotation, stored hashed in DB). `@Public()` bypasses JWT guard. `@Roles(UserRole.MERCHANT)` for role-based access. `@CurrentUser()` injects `request.user`. `OptionalJwtAuthGuard` for endpoints that serve both authenticated and guest users (checkout).

## Conventions and patterns — follow these exactly

### File naming

```
feature.controller.ts      — route handlers
feature.service.ts         — business logic
feature.service.spec.ts    — unit tests (co-located with service)
feature.dto.ts             — input validation (in dto/ subdirectory)
feature.module.ts          — NestJS module declaration
```

### Error handling

- **404-not-403**: When a resource exists but the user doesn't own it, throw `NotFoundException`, not `ForbiddenException`. Prevents enumeration attacks. Used everywhere: addresses, orders, cart items, wishlist items.
- **ConflictException (409)**: Duplicate data, stock race, email collision, duplicate wishlist add.
- **BadRequestException (400)**: Validation failures, invalid state transitions, empty update payloads.
- **ForbiddenException (403)**: Only for account-level issues (suspended, wrong role) or store-level access (`canManageStore` returns false). Never for resource ownership.
- **InternalServerErrorException (500)**: Only for truly unexpected failures (PayFast timeout, order number collision exhaustion).

### Testing patterns

Every service gets a spec file. Follow this exact structure:

```typescript
// 1. Fixtures at top (const, not let)
const USER_ID = 'user-1';
const baseProduct = { id: 'prod-1', ... };

// 2. Mock objects (full Prisma mock with nested methods)
const mockPrisma = {
  order: { findMany: jest.fn(), findUnique: jest.fn(), ... },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

// 3. TestingModule in beforeEach
beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      ServiceUnderTest,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  service = module.get(ServiceUnderTest);
  jest.clearAllMocks();
});

// 4. Describe blocks organized by method
describe('ServiceName', () => {
  describe('methodName', () => {
    it('does the expected thing', async () => { ... });
    it('throws 404 when not found', async () => { ... });
  });
});
```

- Always `jest.clearAllMocks()` in `beforeEach`.
- Use `mockResolvedValue` / `mockResolvedValueOnce` for Prisma mocks.
- For `$transaction`, re-bind after `clearAllMocks`: `mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma))`.
- Mock external modules with `jest.mock()` at module level when needed (e.g., stock.ts).
- Run tests with `npx jest --no-coverage`. Full suite should pass in <3s.

### Database patterns

- **Prisma client** for all queries. Raw SQL (`$executeRaw`) only for atomic stock operations in `src/order/cart/stock.ts`.
- **Transactions** (`$transaction`) for multi-step writes that must be atomic (stock + cart, order creation + payment group, cron cleanup per-item).
- **Never put HTTP calls inside a DB transaction.** The checkout flow does TX1 (create orders) → HTTP (PayFast) → TX2 (clear cart) or TX3 (rollback).
- **Selective queries**: Always use `select` to avoid loading sensitive fields (passwordHash, tokens). Never `findUnique` without narrowing the return shape when it includes sensitive data.
- **Soft deletes**: Addresses use `deletedAt`. Filter with `where: { deletedAt: null }`.

### Store ownership

`StoreService.canManageStore(userId, storeId)` returns true if user is store owner OR active accepted employee. Used by both StoreModule endpoints and OrderModule's merchant-orders. Already exported from StoreModule and imported by OrderModule.

### Shipping and payments

- **Shipping**: Flat R110 per checkout. Lives on `PaymentGroup.shippingInCents`, NOT on individual Orders. `Order.shippingInCents = 0` always. YIIVA pays The Courier Guy directly — merchants never handle shipping money.
- **Commission**: 5.5% of subtotal only (shipping not commissionable). Locked on `Payment` row at order creation time.
- **PaymentGroup**: One PayFast transaction covering N orders. `amountGrossInCents = grandSubtotal + shipping`.
- **Payment**: Per-order slice. `amountGrossInCents = store subtotal` (no shipping). `merchantPayoutInCents = subtotal - commission`.

### Stock model

Independent SKU: bare product has `totalStock`/`reservedStock`, each variant has its own `stock`/`reservedStock`. They are NOT aggregated — a product with variants uses variant stock; a product without variants uses product stock. Stock operations route based on whether `variantId` is null.

- **Reserve**: Optimistic conditional UPDATE (`WHERE reservedStock + delta <= totalStock`). Throws `ConflictException` on race.
- **Release**: Unconditional UPDATE with `GREATEST(0, reservedStock - delta)` floor.
- Cart-add reserves stock. Cart-remove releases stock. Checkout does NOT re-reserve for authenticated buyers (already reserved). Guest checkout reserves in the commit transaction.
- **Stale cart cron** (24h) releases reservations but keeps cart items. **Pending order cron** (30 min) releases reservations and cancels the order.

### Cancel reason prefix convention

All cancel reasons are stored in `Order.cancelReason`. The prefix indicates the source:

| Source | Format | Examples |
|--------|--------|---------|
| Buyer | `REASON` | `CHANGED_MIND`, `ORDERED_BY_MISTAKE`, `FOUND_CHEAPER` |
| Merchant | `REASON` | `OUT_OF_STOCK`, `CANNOT_FULFILL` |
| Admin | `ADMIN:REASON` | `ADMIN:FRAUD`, `ADMIN:POLICY_VIOLATION` |
| System | `SYSTEM:REASON` | `SYSTEM:PAYMENT_TIMEOUT`, `SYSTEM:PAYMENT_FAILED`, `SYSTEM:PAYMENT_CANCELLED` |

### PayFast integration patterns

PayFast uses **two distinct signature algorithms** that must not be confused:

| Mode | Used for | Field ordering | Trim |
|---|---|---|---|
| Form flow | Initiating a redirect payment | Fixed (FORM_FIELD_ORDER) | Yes |
| API flow | Refunds, transaction history, postback | Alphabetical (ksort) | No |
| ITN verify | Verifying incoming webhook | Insertion order, **break at signature** | No |

`PayfastSignatureService` exposes them as separate methods (`signFormPayload`, `signApiRequest`, `verifyItnSignature`, `buildPostbackBody`). Never share code paths. The `phpUrlencode()` helper in `payments/payfast/url-encode.ts` byte-matches PHP's `urlencode()` — any change requires re-running the vector tests.

**ITN webhook (POST /payments/notify):**
1. Validate signature → IP allowlist → look up PaymentGroup → amount match → postback to PayFast → INSERT PaymentEvent (idempotency key: SHA-256 itnHash) → state transition under CAS → return 200.
2. The `PaymentEvent` table is the audit log + idempotency primitive. Replays fail the unique constraint and are acked as 200 no-ops.
3. State transitions use optimistic CAS (`updateMany` with status guard) — no row locks held.
4. **CANCELLED-stays-CANCELLED rule**: a late COMPLETED ITN never resurrects a cancelled order. Sets `PaymentGroup.status = RECONCILE_REQUIRED` for manual ops handling.

**Source IP allowlist** (`PayfastIpAllowlistService`):
- DNS-resolved at boot from `PAYFAST_NOTIFY_HOSTS`, refreshed hourly.
- Fail-closed: empty allowlist rejects all ITNs.
- Dev bypass: `PAYFAST_SKIP_IP_CHECK=true` (refused at boot if `NODE_ENV=production`).
- IPv4-mapped IPv6 (`::ffff:1.2.3.4`) normalized before comparison.

**Refund flow (`AdminOrdersService.requestRefund`):**
- Synchronous on the admin side — calls PayFast, accumulates `Payment.refundedAmountInCents`, transitions Order status (`REFUND_REQUESTED` for partial; `REFUNDED` when cumulative = gross).
- Refund ITN handling is confirmation-only — does NOT mutate `refundedAmountInCents` (already done synchronously).
- **Refunds are sandbox-impossible**: PayFast rejects refund API calls in sandbox. Production smoke test required for first refund.

**Trust proxy:** `app.set('trust proxy', N)` in `main.ts` from `PayfastConfig.trustProxy`. Defaults to 1 (Railway's edge hop). Override via `TRUST_PROXY` env var. Without correct config, `req.ip` is the LB's IP and the allowlist rejects everything.

### Cursor-based pagination

Used in merchant-orders, buyer-orders, admin-orders, and wishlist. Pattern: fetch `take + 1` rows, if `length > take`, trim to `take` and set `nextCursor` to last item's ID. Default page size 20, max 50.

### DTOs

All DTOs live in the module's `dto/` subdirectory. Use class-validator decorators. Enums defined in DTO files when they're DTO-specific (e.g., `CancelReason`, `BuyerCancelReason`, `AdminCancelReason`). Prisma enums used directly when they match (e.g., `OrderStatus`).

## Key files and directories

```
prisma/
  schema.prisma                    — ALL models, enums, relations. Read this first.
  migrations/                      — Chronological SQL migrations
  seed.ts                          — Admin user seeding

src/
  main.ts                          — Bootstrap, global ValidationPipe
  app.module.ts                    — Root module, all imports, ThrottlerGuard, ScheduleModule

  auth/
    auth.service.ts                — Register, login, verify, refresh, password reset
    guards/jwt-auth.guard.ts       — Global JWT guard with @Public() bypass
    guards/optional-jwt-auth.guard.ts — For checkout (auth + guest)
    decorators/public.decorator.ts — @Public() decorator
    decorators/roles.decorator.ts  — @Roles() decorator
    claim/claim.service.ts         — Guest account claiming (scaffold, verification stubbed)

  store/
    store.service.ts               — Store CRUD, canManageStore, employee management
    store.module.ts                — Exports StoreService

  product/
    product.service.ts             — Product CRUD, merchant + buyer views
    variant/variant.service.ts     — Variant CRUD
    image/image.service.ts         — Image management

  order/
    order.module.ts                — Registers sub-features, imports PaymentsModule
    contracts/
      payment-contract.ts          — IPaymentService interface + PAYMENT_SERVICE token
      shipping-contract.ts         — IShippingService interface + SHIPPING_SERVICE token
      stubs/                       — Deterministic stub implementations (Shipping only now)
    cart/
      cart.service.ts              — Cart CRUD, stock reservation
      stock.ts                     — reserveStock/releaseStock (raw SQL)
    checkout/
      checkout.service.ts          — Quote + commit (multi-order, PayFast, guest)
      totals.ts                    — Pure computation (group by store, commission)
    merchant-orders/
      merchant-orders.service.ts   — List, detail, status transitions, cancel
    buyer-orders/
      buyer-orders.service.ts      — List, detail, buyer cancel
    admin-orders/
      admin-orders.service.ts      — Cross-store list, detail, force-confirm, cancel, edit, real refund
    cron/
      order-cleanup.service.ts     — @Cron every 5 min: stale carts, pending expiry, summary log
    wishlist/
      wishlist.service.ts          — Add, remove, list with product details
    address/
      address.service.ts           — Buyer address CRUD (soft delete)
    dto/                           — All order-related DTOs (incl. admin-refund-order.dto.ts)
    utils/
      order-number.ts              — YV-YYYY-XXXXXX generator
      phone.ts                     — SA phone normalization (+27...)

  payments/
    payments.module.ts             — Registers controllers + services
    payments.service.ts            — IPaymentService impl: initializePayment, refundPayment
    payments.controller.ts         — POST /payments/notify (public ITN webhook)
    payments-admin.controller.ts   — GET /admin/payments/groups/:id/reconcile (admin-only)
    payments-notify.service.ts     — Four-step ITN validation, state machine, CAS apply
    payments-reconcile.service.ts  — Read-only reconciliation tool
    payfast/
      payfast-config.ts            — Env validation at boot, sandbox toggle, host list
      payfast-signature.service.ts — signFormPayload, signApiRequest, verifyItnSignature, buildPostbackBody
      payfast-client.service.ts    — verifyItnPostback, createRefund, fetchTransactionHistory
      payfast-ip-allowlist.service.ts — DNS-resolved IP allowlist, hourly refresh, fail-closed
      payfast-types.ts             — ItnPayload, status mapping (COMPLETE → COMPLETED)
      url-encode.ts                — phpUrlencode() helper, byte-matches PHP urlencode
      field-order.ts               — Canonical FORM_FIELD_ORDER from PayFast SDK

docs/
  order-module/
    order-module-foundation.md     — ALL phase decisions, schema changes, architecture
  payments-module/
    payments-module-foundation.md  — PayFast integration design, schema, phase plan
```

## Database schema (key models)

Read `prisma/schema.prisma` for the full schema. Key models:

- **User** — BUYER/MERCHANT/ADMIN, isGuestAccount flag, auth tokens
- **Store** — DRAFT→PENDING_REVIEW→APPROVED→PENDING_GO_LIVE→ACTIVE lifecycle
- **Product** — DRAFT/ACTIVE/OUT_OF_STOCK/ARCHIVED, independent stock per bare+variant
- **Cart/CartItem** — One cart per user, lazy-created on first add
- **Order** — One per store per checkout. Status: PENDING→CONFIRMED→PROCESSING→READY_FOR_DISPATCH→DISPATCHED→IN_TRANSIT→DELIVERED
- **OrderItem** — Snapshot of product details at order time
- **PaymentGroup** — One PayFast transaction, covers N orders. Holds shippingInCents. Status: PENDING→COMPLETED|FAILED|CANCELLED, COMPLETED→PARTIALLY_REFUNDED|REFUNDED, plus RECONCILE_REQUIRED terminal.
- **Payment** — Per-order slice with commission math. One-to-one with Order. `refundedAmountInCents` accumulates per partial refund.
- **PaymentEvent** — Audit log of every received ITN. `itnHash` unique constraint enforces idempotency. `transactionType: PAYMENT | REFUND`.
- **Address** — Buyer delivery addresses, soft delete, max 4, one default
- **WishlistItem** — Product-level bookmark, @@unique([userId, productId])

## Constraints and limitations

- **No e2e tests** — only unit tests exist. `test/` directory has config but no test files.
- **Pre-existing TS2502 errors** in spec files (address, cart, checkout, cron) from `$transaction` mock pattern. These don't affect test execution — Jest uses ts-jest which is more lenient.
- **No rate limiting per-endpoint** — only global throttle (100/60s).
- **Shipping is a stub** — `ShippingStubService` returns deterministic fake data. Real Courier Guy integration not yet built. (Payments is real as of this session.)
- **PayFast refunds are sandbox-impossible** — PayFast's API rejects refunds in test mode. End-to-end refund flow only verifiable in production. Signature/payload structure is fixture-tested.
- **PayFast end-to-end smoke test pending** — Phase 3+4 sandbox checkout (form submit → PayFast page → return → ITN delivered → order CONFIRMED) requires manual verification with ngrok.
- **Refund-ITN field detection is heuristic** — we detect refund ITNs via `transaction_type === 'refund'`. If PayFast uses a different field name, refund ITNs are processed as initial-payment ITNs and rejected. First production refund will reveal the actual field.
- **Guest account claim has no email verification** — stubbed with `emailVerified: true`. Needs Notifications module.
- **No image upload** — ProductImage stores URLs, actual upload mechanism not implemented.
- **noImplicitAny: false** in tsconfig — some untyped code exists (controller `@Req() req: any`).

## Order module phase status

The order module is built in 10 phases. All decisions documented in `docs/order-module/order-module-foundation.md`.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (schema, stubs, scaffolding) | Complete |
| 2 | Address Management | Complete |
| 3 | Cart (CRUD, stock reservation) | Complete |
| 4 | Checkout (quote, commit, guest, PayFast) | Complete |
| 5 | Merchant Order Management | Complete |
| 6 | Buyer Order Views + Guest Claim | Complete |
| 7 | Admin Order Views | Complete |
| 8 | Cron: Cart & Stock Cleanup | Complete |
| 9 | Wishlist | Complete |
| 10 | Consolidated Testing | Complete |

## Payments module phase status

The payments module is built in 6 phases. All decisions documented in `docs/payments-module/payments-module-foundation.md`.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (schema, scaffold, env config) | Complete |
| 2 | Signature primitives (phpUrlencode, signing service) | Complete |
| 3 | Real `initializePayment` + frontend contract change | Complete |
| 4 | ITN webhook (allowlist, notify, controller, trust-proxy) | Complete |
| 5 | Refund API (REST client, admin wiring, refund-ITN handling) | Complete |
| 6 | Reconciliation tooling + cleanup-cron summary | Complete |

## Commands

```bash
npx jest --no-coverage              # Run all tests (~2.6s, 494 tests, 27 suites)
npx jest --testPathPatterns="cart"   # Run tests matching pattern
npx tsc --noEmit                    # Type check (expect TS2502 in some specs — harmless)
npx prisma generate                 # Regenerate Prisma client after schema changes
npx prisma migrate dev              # Apply pending migrations
npm run start:dev                   # Dev server with hot reload
```

## PayFast sandbox smoke test

Manual end-to-end verification of Phases 3 + 4. Run this once before starting any module that depends on Payments (Notifications, Shipping), or after any change to signature/notify code. Catches wire-format bugs that unit tests can't reach.

### Prerequisites

- PayFast public sandbox creds (also documented in `.env.example`):
  ```
  PAYFAST_MERCHANT_ID=10000100
  PAYFAST_MERCHANT_KEY=46f0cd694581a
  PAYFAST_PASSPHRASE=jt7NOE43FZPn
  PAYFAST_SANDBOX=true
  ```
- ngrok or equivalent tunnel exposing local API publicly
- Local dev DB with at least one merchant + product seeded

### Setup

In `.env`:
```
PAYFAST_NOTIFY_URL=https://<your-ngrok-id>.ngrok.io/payments/notify
PAYFAST_SKIP_IP_CHECK=true   # ngrok rewrites the source IP
```

Start tunnel and dev server:
```bash
ngrok http 3000
npm run start:dev
```

### Steps

1. Run a checkout via the frontend (or curl-simulate `POST /checkout/commit` with a valid cart).
2. Confirm the response payload has shape `{ payfast: { actionUrl, fields }, paymentGroupId, mPaymentId, orderNumbers }`.
3. Build an HTML form from `payfast.fields` (or use the frontend's auto-submit page) and POST it to `actionUrl`.
4. Complete the checkout on PayFast's hosted page using the sandbox card flow.
5. PayFast redirects the buyer to `PAYFAST_RETURN_URL` AND posts an ITN to `PAYFAST_NOTIFY_URL`.

### Verify

In the dev server logs, confirm:
- One `payment_cleanup_summary` line per cron tick (`pendingCount` should drop after the ITN)
- No "ITN rejected" warnings (signature, IP, amount, postback)

In the database:
```sql
SELECT id, status, "pfPaymentId", "paidAt" FROM payment_groups
  WHERE "mPaymentId" = '<the m_payment_id from the response>';
-- Expect: status=COMPLETED, pfPaymentId set, paidAt populated

SELECT id, status FROM orders
  WHERE id = ANY ((SELECT array_agg("orderId") FROM payments WHERE "paymentGroupId" = '<pg-id>'));
-- Expect: all status=CONFIRMED

SELECT "transactionType", status, processed, "processError" FROM payment_events
  WHERE "paymentGroupId" = '<pg-id>';
-- Expect: one row, transactionType=PAYMENT, status=COMPLETED, processed=true, processError=null
```

### Common failure modes

| Symptom | Likely cause |
|---|---|
| All ITNs rejected, "source IP not in allowlist" | `PAYFAST_SKIP_IP_CHECK` not set, or `TRUST_PROXY` mismatch |
| All ITNs rejected, "invalid signature" | Passphrase mismatch, or `phpUrlencode` regression |
| Postback returns INVALID | Body reconstruction lost a field — verify `buildPostbackBody` against received payload |
| `Required env var PAYFAST_*` at boot | Missing variable — see `.env.example` |
| No ITN ever arrives | ngrok URL incorrect, or PayFast notify URL not set |

### Refund flow (production-only)

PayFast's REST refund API rejects sandbox calls — `PayfastClient.createRefund` logs a warning and the call returns 400-shaped errors. Refund flow is verifiable only against real merchant credentials in production. Do this manually on the first real refund:

1. `POST /admin/orders/:orderId/refund` with `{ amountInCents, reason, accType: 'savings' | 'current' }`.
2. Confirm 200 response with `{ refundId, status: 'PROCESSING', cumulativeRefundedInCents }`.
3. Watch for the refund ITN — verify it arrives and the assumed field name (`transaction_type === 'refund'`) actually matches PayFast's payload. If not, adjust `PaymentsNotifyService.handle()` accordingly.
4. Verify `PaymentGroup.status` transitions COMPLETED → PARTIALLY_REFUNDED or REFUNDED based on cumulative.

## Session Protocol

Always read `STATUS.md` at the start of every session. Before a session ends, when asked to do a handoff, update `STATUS.md` — not this file.

`STATUS.md` tracks: what was just completed, what's in progress, uncommitted changes, and the immediate next step. This file (`CLAUDE.md`) is the stable reference — only update it when conventions, architecture, or project-wide patterns change.

If `STATUS.md` doesn't exist yet, create it on first handoff request.
