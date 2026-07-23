# CLAUDE.md — YIIVA Nuwa API

You are working on **Nuwa**, the backend API for YIIVA — a South African commerce marketplace connecting local merchants (clothing, home, accessories) with buyers. NestJS 11 + Prisma 7 + PostgreSQL. TypeScript. Jest for tests.

## What this project does

YIIVA is a multi-merchant marketplace. Merchants create stores, list products, and fulfill orders. Buyers browse across stores, build multi-brand carts, and check out in a single transaction. YIIVA handles payments (Paystack), shipping (The Courier Guy), and takes a 2.5% commission on subtotals (dropped from 5.5% on 2026-07-22 — early-adopter acquisition strategy).

The API serves a Next.js frontend (separate repo). This is the backend only.

## Architecture

### Module dependency graph

```
AppModule
 ├── AuthModule        — JWT auth, registration, login, password reset, account claim
 ├── StoreModule       — Store CRUD, admin review, employee invites, addresses, banner media
 ├── ProductModule     — Products, variants, images, collections, tags, categories
 ├── OrderModule       — Cart, checkout, orders (buyer + merchant + admin views), addresses, wishlist, cron cleanup
 ├── PaymentsModule    — Paystack integration: hosted-checkout init, webhook, refunds, reconciliation
 ├── ShippingModule    — ShipLogic/TCG: rate quotes, shipment creation, label download, tracking webhook, dispatch addresses CRUD
 ├── UploadsModule     — Cloudinary signed-upload signing endpoint + IsCloudinaryUrl validator (global)
 ├── MobileModule      — Buyer/mobile `/api` surface for maya (envelope + vocab translation; never touches web/admin routes)
 ├── PrismaModule      — Database singleton (global)
 ├── EmailModule       — Transactional email via Resend (global)
 ├── NotificationsModule — Buyer notifications: inbox rows + Resend email + Expo push (@Global; best-effort dispatch)
 ├── ScheduleModule    — @nestjs/schedule for cron jobs (global)
 ├── ConfigModule      — Environment variables (global)
 └── ThrottlerModule   — Rate limiting (global, 100 req/60s)
```

**Key dependency rules:**
- OrderModule imports StoreModule + ProductModule directly.
- OrderModule imports PaymentsModule and binds `PAYMENT_SERVICE` to the real `PaystackService` via `useClass`. PaystackService's deps (`PaystackConfig`, `PaystackClient`) resolve from PaymentsModule's exports.
- OrderModule imports ShippingModule and consumes Shipping via the `SHIPPING_SERVICE` injection-token contract. ShippingModule exports the token bound (via `useExisting`) to the real `ShippingService`.
- PaymentsModule imports ShippingModule (one-way) and injects `ShipmentCreationService` into `PaymentsNotifyService` — post-ITN hook books real ShipLogic shipments after Order → CONFIRMED, OUTSIDE the DB transaction.
- BuyerOrdersService injects `ShipmentCancellationService` (via OrderModule's import of ShippingModule) — best-effort ShipLogic cancel after Order.cancelOrder succeeds.
- AdminOrdersService injects `IPaymentService` via `PAYMENT_SERVICE` token (for refund flow).
- No circular dependencies. PaymentsModule reads from `OrderModule`-owned tables (PaymentGroup, Payment, Order) but does not import OrderModule. ShippingModule does not import OrderModule or PaymentsModule.
- PrismaModule is global — every module injects PrismaService without importing PrismaModule.
- UploadsModule is @Global — exports `CloudinaryConfig` and `IsCloudinaryUrlConstraint` so any DTO across modules can use `@IsCloudinaryUrl()` without importing UploadsModule. Imports StoreModule for `canManageStore` in the signing endpoint's per-context authz.
- PaymentsModule must export PaystackConfig AND PaystackClient. OrderModule binds `PAYMENT_SERVICE` via `useClass: PaystackService` — that constructs PaystackService in OrderModule's context, so every constructor dep of PaystackService must be visible there.
- ShippingModule imports StoreModule for `canManageStore` authz (used by dispatch-address CRUD and label download). Exports `SHIPPING_SERVICE`, `ShipLogicConfig`, `ShipLogicClient`, `ShipmentCreationService`, `ShipmentCancellationService`.

### Why it's structured this way

Each module owns its own controllers, services, DTOs, and specs. Sub-features within a module get their own subdirectory (e.g., `order/cart/`, `order/checkout/`, `order/merchant-orders/`, `payments/paystack/`). This keeps feature boundaries clear and allows parallel development.

The contract/stub pattern (`PAYMENT_SERVICE`, `SHIPPING_SERVICE` tokens) lets the full checkout flow be coded and tested end-to-end without those modules existing. When they ship, only the module-level binding changes — zero consumer code changes. **Both Payments and Shipping have now shipped this way** — ShippingModule exports `SHIPPING_SERVICE` bound to the real `ShippingService` (replacing the legacy `ShippingStubService`). The stub class still exists in `src/order/contracts/stubs/` for potential test use, but is no longer bound in production.

### Global middleware and guards

- **CORS** (global, `main.ts`): `app.enableCors(buildCorsOptions())` from `src/cors.config.ts`. Env-driven `CORS_ORIGINS` allowlist (comma-separated). Production fails to boot if `CORS_ORIGINS` is empty. `credentials: true` to support the refresh-token cookie. Payment/shipping webhooks are server-to-server and unaffected.
- **ValidationPipe** (global, `main.ts`): `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. DTOs use class-validator decorators.
- **`useContainer(app.select(AppModule), { fallbackOnErrors: true })`** in `main.ts` — wires class-validator to NestJS DI so custom validators (e.g. `IsCloudinaryUrl`) can inject providers. Required for any DI-based validator going forward.
- **`NestFactory.create(AppModule, { rawBody: true })`** in `main.ts` — captures `req.rawBody` as a `Buffer`. Required by BOTH webhooks: Paystack (`POST /payments/webhook`, HMAC-SHA512 over the exact bytes) and ShipLogic (`POST /shipping/webhook/:secret`, byte hashing for idempotency).
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
- **InternalServerErrorException (500)**: Only for truly unexpected failures (Paystack timeout, order number collision exhaustion).

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
- **Never put HTTP calls inside a DB transaction.** The checkout flow does TX1 (create orders) → HTTP (Paystack init) → TX2 (clear cart) or TX3 (rollback).
- **Selective queries**: Always use `select` to avoid loading sensitive fields (passwordHash, tokens). Never `findUnique` without narrowing the return shape when it includes sensitive data.
- **Soft deletes**: Addresses use `deletedAt`. Filter with `where: { deletedAt: null }`.

### Store ownership

`StoreService.canManageStore(userId, storeId)` returns true if user is store owner OR active accepted employee. Used by both StoreModule endpoints and OrderModule's merchant-orders. Already exported from StoreModule and imported by OrderModule.

### Shipping and payments

- **Shipping**: **Real ShipLogic rates, per-store** (as of shipping-module Phase 4). Each Order gets its own quote based on the store's primary `StoreDispatchAddress` → buyer's delivery address. `Order.shippingInCents = per-store rate`. `Order.totalInCents = subtotal + per-store shipping`. `PaymentGroup.shippingInCents = grand sum across all stores in the cart`. YIIVA pays The Courier Guy directly — merchants never handle shipping money. On ShipLogic 5xx/network → falls back to `SHIPPING_RATE_FALLBACK_CENTS` (default 11000 = R110). On 4xx → `BadRequestException` to caller (e.g. bad address).
- **`computeCheckoutTotals` signature**: `(items, Map<storeId, number>)` — per-store shipping passed in as a Map. Each `CheckoutStoreGroup` has its own `shippingInCents` and `totalInCents = subtotal + shipping`.
- **Commission**: 2.5% of subtotal only (shipping not commissionable; `COMMISSION_RATE` in `order/checkout/totals.ts` — was 5.5% until 2026-07-22). Locked on `Payment` row at order creation time, so historical rows keep their original rate. ⚠ At 2.5%, card processing fees (~2.9%+R1+VAT) exceed commission — fee bearing on split payouts is a business decision (PS-8).
- **PaymentGroup**: One Paystack transaction covering N orders. `amountGrossInCents = grandSubtotal + grandShipping`.
- **Payment**: Per-order slice. `amountGrossInCents = store subtotal` (no shipping). `merchantPayoutInCents = subtotal - commission`. Shipping cost stays on PaymentGroup, not allocated to merchant payouts.
- **Shipment booking**: After `PaymentGroup → COMPLETED` and child `Order → CONFIRMED`, `PaymentsNotifyService` fires `ShipmentCreationService.createShipmentForOrder(orderId)` for each Order **outside** the DB transaction. Idempotent on existing Shipment row. Failures are logged + swallowed; Order stays CONFIRMED for ops review.
- **Shipment cancel propagation**: `BuyerOrdersService.cancelOrder` fires `ShipmentCancellationService.cancelShipmentForOrder(orderId)` best-effort after local cancel succeeds. ShipLogic 4xx (already collected, etc.) logged + swallowed.

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

### Paystack integration patterns

Paystack replaced PayFast in 2026-07 (decision record, verified pricing/API
facts, and full phase history: `docs/payments-module/paystack-migration-foundation.md`).
No request signing exists on this API — outbound calls are Bearer-key REST
(`PaystackClient`: initialize / verify / refund); amounts are **integer ZAR
cents end-to-end** (no decimal-string conversion anywhere).

**Config (`PaystackConfig`)**: `PAYSTACK_SECRET_KEY` (mode is DERIVED from the
`sk_test_`/`sk_live_` prefix; production refuses a test key at boot) +
`PAYSTACK_CALLBACK_URL`. The webhook URL is configured on the Paystack
dashboard per mode, not in env.

**Checkout handoff**: `initializePayment` → hosted checkout `authorization_url`
returned as contract-v3 `redirect { url, method: 'GET' }`. WE generate the
`reference` (persisted as `PaymentGroup.mPaymentId` — legacy column name).
An optional `channels` restriction (`card` | `eft` | `qr`) narrows the hosted
page to the method chosen on maya's Payment step.

**Webhook (POST /payments/webhook, `PaystackWebhookService`):**
1. Verify HMAC-SHA512 of `req.rawBody` against `x-paystack-signature`
   (constant-time) → parse → route by event → look up PaymentGroup by
   reference → EXACT integer amount match → INSERT PaymentEvent (idempotency
   key: SHA-256 of raw body, on the `itnHash` column) → CAS state transition →
   ack 200. No IP allowlist / postback — the HMAC is cryptographically
   sufficient.
2. The `PaymentEvent` table is the audit log + idempotency primitive. Replays
   fail the unique constraint and are acked as 200 no-ops.
3. State transitions use optimistic CAS (`updateMany` with status guard) — no
   row locks held. `charge.success` also records Paystack's `fees` into
   `amountFeeInCents`/`amountNetInCents`.
4. **CANCELLED-stays-CANCELLED rule**: a late `charge.success` never
   resurrects a cancelled order. Sets `PaymentGroup.status =
   RECONCILE_REQUIRED` for manual ops handling.
5. Unknown event types are acked silently; unknown references are acked with a
   CRITICAL log (valid signature + unknown reference = data loss).

**Refund flow (`AdminOrdersService.requestRefund`):**
- Synchronous on the admin side — calls Paystack, accumulates
  `Payment.refundedAmountInCents`, transitions Order status
  (`REFUND_REQUESTED` for partial; `REFUNDED` when cumulative = gross).
- `refund.*` webhooks are confirmation-only — `refund.processed` CASes the
  PaymentGroup to PARTIALLY_REFUNDED/REFUNDED from the child aggregate;
  `refund.failed` flags a money-mismatch for manual ops (local books are
  already ahead).
- **Refunds WORK in test mode** (verified 2026-07-21) — full lifecycle
  exercisable without production credentials, unlike PayFast.

**Merchant payout splits (Phase 6)**: stores with a configured Paystack
subaccount (`Store.paystackSubaccountCode`, onboarded via
`POST /stores/:storeId/payout-account`; bank details live at Paystack, we
store code + display metadata only) get their share (subtotal − commission)
settled DIRECTLY to their bank via a per-transaction flat multi-split
(`bearer_type: all-proportional` — PS-8; at 2.5% commission YIIVA would be
margin-negative on cards otherwise). Unconfigured stores' shares stay on the
main balance for manual payout. Split-creation failure degrades gracefully
(CRITICAL log, checkout proceeds unsplit). Refunds on split orders pull from
the MAIN balance — merchant clawback is manual ops (PS-3 v1 policy).

**Reconciliation**: `GET /admin/payments/groups/:id/reconcile`
(`PaystackReconcileService`) — single-transaction `GET /transaction/verify`
by our reference; verdicts MATCH / MISMATCH / NOT_FOUND / MATCH_PENDING.

**Trust proxy:** `app.set('trust proxy', N)` in `main.ts` from the
`TRUST_PROXY` env var directly. Defaults to 1 (Railway's edge hop). Affects
`req.ip` recorded on webhook audit rows.

### ShipLogic / TCG integration patterns

ShipLogic is the underlying platform — The Courier Guy is one provider on it. We integrate via the customer-facing API, not the courier-operator surface.

| Mode | Used for | Auth |
|---|---|---|
| Outbound REST | rates, shipments, label PDF, cancel | Bearer token (`SHIPLOGIC_API_KEY`) |
| Inbound webhook | tracking events, shipment notes, address changes, dimension changes | Path-embedded secret (`SHIPLOGIC_WEBHOOK_SECRET`) + optional IP allowlist |

**Per-store rate quote** (`POST /rates`): one call per store group in the cart. Looks up the store's primary `StoreDispatchAddress` (soft-delete-aware), sums per-product `weightInGrams` (with 500g fallback when null), fixed parcel dimensions (20×20×10 cm — `Product.lengthCm/widthCm/heightCm` exist but most products won't populate them). On 4xx → `BadRequestException`; on 5xx/network → fallback flat rate; on no matching service tier → `InternalServerErrorException`.

**Shipment creation** (`POST /shipments`): fired from `PaymentsNotifyService` post-ITN, idempotent on existing `Shipment` row. Writes the existing `Shipment` table — `shiplogicShipmentId` is the numeric internal ID (e.g. `"115738667"`); `waybillNumber` is the ShipLogic `short_tracking_reference` (e.g. `"VD3GLQ"`) — same value as the printed TCG waybill. **Both are `@unique` — don't confuse them.** Stores raw response on `Shipment.shiplogicPayload Json?` for audit.

**Webhook** (`POST /shipping/webhook/:secret`):
1. Constant-time secret compare against `SHIPLOGIC_WEBHOOK_SECRET`; mismatch → 404 (stealth)
2. Optional IP allowlist via `SHIPLOGIC_WEBHOOK_IP_ALLOWLIST` (empty = no IP gate). Handles IPv4-mapped IPv6 (`::ffff:1.2.3.4`).
3. SHA-256 hash of `req.rawBody` → idempotency key
4. INSERT `ShipmentEvent` (unique constraint on `payloadHash` catches replays → ack 200 no-op)
5. Detect `eventType` from payload shape (TRACKING_EVENT / SHIPMENT_NOTE / ADDRESS_CHANGE / DIMENSION_CHANGE)
6. Match `short_tracking_reference` → `Shipment.waybillNumber`; orphans still get the audit row written
7. For TRACKING_EVENT: always update `Shipment.shiplogicStatus` (raw); for **mapped** statuses, also update `Shipment.status`, `Order.status` (with CAS guards), and write a buyer-visible `ShipmentTrackingEvent` row

**Status mapping** lives in `src/shipping/shipping-status-map.ts`. Pure function. Mapping table in `docs/shipping-module/shipping-module-foundation.md` §11. Forward-only — non-mapped statuses are no-op on Order (stored raw on Shipment for admin triage). `delivery-failed-attempt` and `returned-to-hub` map to `ShipmentStatus.FAILED_DELIVERY` but do NOT auto-transition Order — ops triage required.

**CAS guards on Order updates** in webhook (`allowedSourceStatusesFor`): prevent backward transitions from delayed webhooks. A delayed `collected` event arriving after `delivered` silently no-ops via `updateMany` matching zero rows. **Never change webhook Order updates to `update` from `updateMany`** — would lose replay protection.

**Webhook auth question still open (Q24 in foundation doc):** TCG support hasn't confirmed whether webhooks are signed. v1 design uses path-secret + IP allowlist; signature-verification slot is reserved in `ShippingWebhookService.ingest` between secret check and ShipmentEvent INSERT.

**Sandbox webhook delivery is unverified** — empirical test on 2026-06-03 received zero webhooks despite three real state changes. Could be sandbox-doesn't-fire (most likely), subscription verification step we missed, or another quirk. Production smoke test will be the first real-world verification.

### Cloudinary integration patterns

Image and video hosting uses **Cloudinary signed direct uploads** — browser uploads files directly to Cloudinary after fetching a backend signature; backend never touches the file. Implemented in `src/uploads/`.

**Architecture:**
- One Cloudinary cloud per environment (`yiiva-dev`, `yiiva-prod`). Seven signed presets per cloud — see `docs/cloudinary-setup.md` for the spec.
- `POST /uploads/cloudinary-signature` issues per-upload signatures after per-context authz (`canManageStore` for store/product/collection contexts; `ADMIN` role for `category_image`).
- `CloudinaryConfig` reads `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` at boot. Fails fast if missing (PayfastConfig pattern).
- Signature algorithm: `sha1(folder + source=uw + timestamp + upload_preset + apiSecret)` — alphabetical key order. **`source=uw` is required** because the frontend uploads via Cloudinary's Upload Widget which injects this param; omitting it produces `401 Invalid Signature` from Cloudinary. Locked in by a regression-guard test in `uploads.service.spec.ts`.

**The `@IsCloudinaryUrl()` validator:**
- Custom class-validator decorator on every DTO field that accepts an image URL. Validates the URL starts with `https://res.cloudinary.com/<configuredCloudName>/`.
- Currently applied to: `UpdateStoreDto.logoUrl`, `AddImageDto.url`, `CreateCollectionDto.imageUrl` / `UpdateCollectionDto.imageUrl`, `CreateCategoryDto.imageUrl` / `UpdateCategoryDto.imageUrl`, `AddBannerMediaDto.url`.
- Defense-in-depth — signed-upload authz is the primary security boundary, but the regex catches mistakes like a frontend bug submitting a placeholder URL.
- Resolves CloudinaryConfig via NestJS DI, enabled by the `useContainer` call in `main.ts`.

**Banner media (multi-item store banner):**
- `Store.bannerUrl` was replaced with `StoreBannerMedia[]` (May 2026). Up to 5 items per store, mix of images and videos. First item by `sortOrder` is the cover (`isPrimary: true`).
- Managed via dedicated endpoints under `/stores/:storeId/banner-media/` (POST, DELETE, PATCH /reorder) — never via `PATCH /stores/:id`.
- Two upload contexts: `store_banner` (image) and `store_banner_video` (video) share the same folder `stores/{storeId}/banner` in Cloudinary.
- Status-aware delete protection: PENDING_GO_LIVE / ACTIVE stores must retain at least one banner item (mirrors the last-image-on-active-product rule).
- Implemented in `src/store/banner-media/`.

### Notifications module patterns

Buyer notifications shipped in two phases (`src/notifications/`, `@Global` like EmailModule):

- **`NotificationsService`** is the orchestrator. Per-event methods (`orderConfirmed`, `paymentFailed`, `orderStatusChanged`, `orderCancelled`, `refund`) each load their own context and call a private `dispatch()` that does three independent **best-effort** things: write a `Notification` inbox row, send a Resend email (via the new generic `EmailService.send({to,subject,html})`), and fire an Expo push (`PushService`). **A failure in any channel is logged and swallowed — it must NEVER break the payment/shipping/cancel flow that triggered it** (same contract as the post-ITN shipment-booking side-effect).
- **`data.orderId` on every notification is the PaymentGroup id** (the maya "order"), so a tap deep-links straight into `GET /api/orders/:id`.
- **Hook points** (each consuming service injects `NotificationsService`; no import wiring needed since it's `@Global`): `PaymentsNotifyService` (order confirmed / payment failed, post-ITN outside the TX), `ShippingWebhookService` (shipped/delivered — fired **only on a real CAS transition**, after commit), `BuyerOrdersService` + `AdminOrdersService` (cancel), `AdminOrdersService.requestRefund`.
- **`PushService`** (Expo): `registerToken`/`removeToken` (upsert by token) + `sendToUser` (POST `https://exp.host/--/api/v2/push/send`, prunes `DeviceNotRegistered`). Reads the new `PushToken` model.
- **Mobile surface** (`src/mobile/notifications/`, on `api/me`): `GET /notifications` (cursor-paginated inbox + `unreadCount`), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `POST`/`DELETE /push-tokens`.
- **Maya caveat:** Expo push **delivery** is untestable in Expo Go / iOS Simulator (no APNs); emails + the in-app inbox work everywhere. Push delivery needs a dev build on a physical device.
- Events map to the existing `NotificationType` enum — **no enum change**. Order-confirmed email fires exactly when the Paystack charge.success webhook flips the order to CONFIRMED.

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
    banner-media/
      banner-media.controller.ts   — POST/DELETE/PATCH /stores/:storeId/banner-media
      banner-media.service.ts      — Gallery cap, sortOrder renumbering, cover maintenance, status-aware delete

  uploads/
    uploads.module.ts              — @Global; exports CloudinaryConfig + IsCloudinaryUrlConstraint
    uploads.controller.ts          — POST /uploads/cloudinary-signature
    uploads.service.ts             — Per-context authz + Cloudinary signature computation (signs source=uw)
    cloudinary-config.ts           — Env-var validation at boot, urlPrefix getter
    validators/is-cloudinary-url.validator.ts — @IsCloudinaryUrl() decorator

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
      checkout.service.ts          — Quote + commit (multi-order, Paystack init, guest)
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
    payments.module.ts             — Registers controllers + services (Paystack-only since 2026-07)
    paystack.service.ts            — IPaymentService impl: initializePayment, refundPayment
    paystack-webhook.controller.ts — POST /payments/webhook (public, HMAC-verified)
    paystack-webhook.service.ts    — Verify → PaymentEvent idempotency → CAS apply → side effects
    paystack-reconcile.service.ts  — Read-only reconciliation via /transaction/verify
    payments-admin.controller.ts   — GET /admin/payments/groups/:id/reconcile (admin-only)
    paystack/
      paystack-config.ts           — Env validation at boot; mode derived from key prefix
      paystack-client.service.ts   — Typed REST client: initialize, verify, refund
      paystack-types.ts            — Wire types (envelope, charge, refund, webhook events)

  shipping/
    shipping.module.ts             — Registers everything; exports SHIPPING_SERVICE + ShipmentCreation + ShipmentCancellation services
    shipping.service.ts            — IShippingService.getRate (real); fallback policy 4xx/5xx
    shipping-status-map.ts         — Pure: raw ShipLogic status → {orderStatus, shipmentStatus, cancelReason}
    shipping-webhook.controller.ts — POST /shipping/webhook/:secret (public; path-secret + IP allowlist; raw-body hash)
    shipping-webhook.service.ts    — Ingest pipeline: idempotency via payloadHash, status-map apply, CAS guards on Order
    shipment-creation.service.ts   — Post-ITN hook from PaymentsNotifyService; books ShipLogic shipment; writes Shipment row
    shipment-cancellation.service.ts — Buyer-cancel hook from BuyerOrdersService; best-effort ShipLogic cancel
    shipment-label.controller.ts   — GET /stores/:storeId/orders/:orderId/shipping-label (PDF binary)
    shipment-label.service.ts      — canManageStore + 404-on-cross-store; ShipLogic /shipments/label fetch
    shiplogic/
      shiplogic-config.ts          — Env validation at boot; fallbackRateInCents, webhookSecret, IP allowlist
      shiplogic-client.service.ts  — getJson, postJson, getBinary; Bearer auth; AbortController timeouts
      shiplogic-types.ts           — Wire-format DTOs (rate request/response, shipment create/cancel, contact)
      shiplogic-address.ts         — Pure helpers: YIIVA → ShipLogic shape (street_address, local_area, zone, code)
    dispatch-address/
      dispatch-address.controller.ts — /stores/:storeId/dispatch-addresses CRUD
      dispatch-address.service.ts    — list/get/create/update/soft-delete/set-primary; canManageStore authz
      dto/                           — Create + Update DTOs (SA province enum, +27 phone, lat/lng)

  notifications/                     — @Global; buyer notifications (inbox + email + push)
    notifications.service.ts         — orchestrator: dispatch() = inbox row + email + push (best-effort)
    push.service.ts                  — Expo push delivery + PushToken registry

  mobile/                            — Buyer `/api` surface for maya (envelope + vocab translation)
    common/                          — MobileController decorator, response interceptor, exception filter, serializers, cursor
    orders/                          — incl. GET /api/orders (consolidated PaymentGroup list = "My Orders")
    notifications/                   — GET/PATCH/POST /api/me/notifications + POST/DELETE /api/me/push-tokens

docs/
  order-module/
    order-module-foundation.md     — ALL phase decisions, schema changes, architecture
  payments-module/
    payments-module-foundation.md  — original PayFast-era design (schema/architecture still apply)
    paystack-migration-foundation.md — Paystack decision record, contract v3, webhook mapping, splits plan
  shipping-module/
    shipping-module-foundation.md  — ShipLogic integration: locked decisions Q11–Q26, schema, phase plan, status mapping table
  thecourierguy/
    shiplogic.postman_collection.json — Sandbox-hosted Shiplogic Postman docs
    tcg.postman_collection.json    — White-labelled TCG version (identical content, prod URLs)
  Api-mobileapp-contracts/         — 5 mobile UX flow docs (auth, catalogue, cart-wishlist-addresses, checkout, orders) + auth-mobile-guide.md (Expo/RN technical implementation companion)
```

## Database schema (key models)

Read `prisma/schema.prisma` for the full schema. Key models:

- **User** — BUYER/MERCHANT/ADMIN, isGuestAccount flag, auth tokens
- **Store** — DRAFT→PENDING_REVIEW→APPROVED→PENDING_GO_LIVE→ACTIVE lifecycle. `bannerUrl` was removed (May 2026); banner is now `StoreBannerMedia[]`.
- **StoreBannerMedia** — Multi-item store banner gallery (max 5, image+video mix). FK on storeId. `sortOrder` ascending; lowest is the cover (`isPrimary: true`).
- **Product** — DRAFT/ACTIVE/OUT_OF_STOCK/ARCHIVED, independent stock per bare+variant
- **Cart/CartItem** — One cart per user, lazy-created on first add
- **Order** — One per store per checkout. Status: PENDING→CONFIRMED→PROCESSING→READY_FOR_DISPATCH→DISPATCHED→IN_TRANSIT→DELIVERED
- **OrderItem** — Snapshot of product details at order time
- **PaymentGroup** — One Paystack transaction, covers N orders. Holds shippingInCents. Status: PENDING→COMPLETED|FAILED|CANCELLED, COMPLETED→PARTIALLY_REFUNDED|REFUNDED, plus RECONCILE_REQUIRED terminal.
- **Payment** — Per-order slice with commission math. One-to-one with Order. `refundedAmountInCents` accumulates per partial refund.
- **PaymentEvent** — Audit log of every received ITN. `itnHash` unique constraint enforces idempotency. `transactionType: PAYMENT | REFUND`.
- **Address** — Buyer delivery addresses, soft delete, max 4, one default
- **WishlistItem** — Product-level bookmark, @@unique([userId, productId])
- **Notification** — In-app inbox row (12-value `NotificationType` enum). **Now written** by NotificationsService (was schema-only). `data` Json carries `{ orderId, orderNumber }` for deep-linking.
- **PushToken** — Expo push token per device (`token` @unique, `platform`, `lastUsedAt`). Migration `20260622122857_add_push_tokens`. Written by `PushService`.

## Constraints and limitations

- **No e2e tests** — only unit tests exist. `test/` directory has config but no test files.
- **Pre-existing TS2502 errors** in spec files (address, cart, checkout, cron) from `$transaction` mock pattern. These don't affect test execution — Jest uses ts-jest which is more lenient.
- **No rate limiting per-endpoint** — only global throttle (100/60s).
- **Paystack end-to-end verified in TEST MODE (2026-07-21)** — full checkout (multi-store), webhook → CONFIRMED, fees recorded, refunds incl. refund webhooks. Remaining production firsts: live-key activation (business KYC) + first live transaction. `refund.*` webhook delivery can lag minutes-to-hours in test mode — it is confirmation-only by design.
- **Live-mode Paystack activation pending** — the dashboard business activation (company docs + bank account) is required before a live key exists; config refuses test keys when NODE_ENV=production.
- **ShipLogic sandbox NEVER delivers tracking webhooks** — CONFIRMED by TCG support (2026-07-23): tracking events are driver-scan-driven and no drivers scan test parcels. Production is the first place delivery can be observed (first-real-shipment smoke); the tracking-reconcile poller (cron :10/:40 + `POST /admin/shipping/reconcile-tracking`) bounds missed-webhook drift to ~45–75 min either way.
- **ShipLogic webhooks are NOT signed** (Q24 effectively closed 2026-07-23: support examples + both Postman collections + api-docs show plain callback URLs, no signing anywhere). Path-embedded secret + optional IP allowlist IS the permanent auth model; the verifier slot stays reserved. Still open from Q24: outbound source-IP range + retry cadence (follow-up email).
- **Notifications module SHIPPED (2026-06-22, Phase A+B)** — `src/notifications/`. Buyers now get order-confirmed / payment-failed / shipped / delivered / cancelled / refund notifications (inbox row + Resend email + Expo push). See "Notifications module patterns" above. Push *delivery* still needs a physical-device dev build to verify (Expo Go has no APNs); emails + inbox are verified.
- **Guest account claim has no email verification** — stubbed with `emailVerified: true`. Needs Notifications module.
- **Image upload mechanism is live** — Cloudinary signed direct uploads via `POST /uploads/cloudinary-signature` (not noted in legacy CLAUDE.md text). ProductImage etc. store the resulting `secure_url`.
- **`Order.shippingSuburb` snapshot** — FIXED 2026-07-23 (migration `20260723170000_order_shipping_suburb`): checkout snapshots the delivery address's suburb onto the Order (auth + guest paths; `GuestAddressDto` gained optional `suburb`), and shipment booking passes it as ShipLogic's `local_area` geocoding anchor. Orders created before the migration have null (geocoded from remaining fields, as before). ⚠ maya's address form should collect suburb for the accuracy win — frontend follow-up.
- **noImplicitAny: false** in tsconfig — some untyped code exists (controller `@Req() req: any`).

## Order module phase status

The order module is built in 10 phases. All decisions documented in `docs/order-module/order-module-foundation.md`.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (schema, stubs, scaffolding) | Complete |
| 2 | Address Management | Complete |
| 3 | Cart (CRUD, stock reservation) | Complete |
| 4 | Checkout (quote, commit, guest, payment init) | Complete |
| 5 | Merchant Order Management | Complete |
| 6 | Buyer Order Views + Guest Claim | Complete |
| 7 | Admin Order Views | Complete |
| 8 | Cron: Cart & Stock Cleanup | Complete |
| 9 | Wishlist | Complete |
| 10 | Consolidated Testing | Complete |

## Payments module phase status

**Provider: Paystack** (migrated from PayFast 2026-07-21; the PayFast code was
deleted at cutover). Migration decisions + phase history:
`docs/payments-module/paystack-migration-foundation.md`. The original PayFast
build history remains in `docs/payments-module/payments-module-foundation.md`
(schema + architecture sections still apply — the PaymentGroup/Payment/
PaymentEvent model and CAS state machine survived the migration unchanged).

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (PaystackConfig env fail-fast, typed REST client) | Complete |
| 2 | Contract v3 (provider-neutral redirect) + PaystackService + maya WebView | Complete |
| 3 | Webhook pipeline (HMAC-SHA512, PaymentEvent idempotency, CAS) | Complete |
| 4 | Refunds (test-mode verified) + Paystack reconcile tooling | Complete |
| 5 | Cutover: PAYMENT_SERVICE rebind + PayFast deletion | Complete |
| 6 | Split payments (subaccounts, per-merchant settlement) | Post-launch (see foundation §8) |

## Shipping module phase status

The shipping module is built in 6 phases. All decisions documented in `docs/shipping-module/shipping-module-foundation.md`.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (ShipLogicConfig boot validation, ShipLogicClient HTTPS wrapper) | Complete |
| 2 | Schema deltas (`Address.suburb`, `ShipmentEvent` table + `ShipmentEventType` enum, `Shipment.waybillNumber` comment clarification) | Complete |
| 3 | Dispatch addresses CRUD (`/stores/:storeId/dispatch-addresses` — list, get, create, update, soft-delete, set-primary) | Complete |
| 4 | Real per-store rate quotes (`ShippingService.getRate`, checkout fires one call per store group, `Order.shippingInCents` now persists per-store rate) | Complete |
| 5 | Shipment creation post-ITN, label PDF download endpoint, buyer-cancel propagation to ShipLogic | Complete |
| 6 | Tracking webhook (`POST /shipping/webhook/:secret`), status mapping → `Order.status` transitions, CAS guards | Complete |

## Commands

```bash
npx jest --no-coverage              # Run all tests (~6s, 776 tests, 53 suites)
npx jest --testPathPatterns="cart"   # Run tests matching pattern
npx tsc --noEmit                    # Type check (expect TS2502 in some specs — harmless)
npx prisma generate                 # Regenerate Prisma client after schema changes
npx prisma migrate dev              # Apply pending migrations
npm run start:dev                   # Dev server with hot reload
```

## Paystack test-mode smoke test

End-to-end verification of the payment chain. Run after any change to
checkout/webhook/refund code. Everything works in TEST MODE — including
refunds (verified 2026-07-21; PayFast never allowed this).

### Prerequisites

- A Paystack test secret key (`sk_test_…`) in `.env` (`PAYSTACK_SECRET_KEY`)
- A public tunnel to the local API. Note: Paystack's dashboard URL validator
  rejected ngrok's `.ngrok-free.dev` domain — `cloudflared tunnel --url
  http://localhost:<port>` (`*.trycloudflare.com`) works.
- Local DB with at least one merchant + product seeded

### Setup

1. Start the tunnel; copy the https URL.
2. Paystack dashboard → Settings → API Keys & Webhooks → **Test Webhook URL**
   = `https://<tunnel>/payments/webhook`.

### Steps

1. Checkout via maya (or curl `POST /api/orders`) → response carries
   `payment.redirect.url` (Paystack hosted page).
2. Open the URL; pay with the test card `4084 0840 8408 4081`, any future
   expiry, CVV `408`.
3. Paystack redirects the buyer to the callback sentinel AND posts
   `charge.success` to the webhook.

### Verify

```sql
SELECT status, "pfPaymentId", "paidAt", "amountFeeInCents" FROM payment_groups
  WHERE "mPaymentId" = '<reference from the commit response>';
-- Expect: COMPLETED, provider tx id set, paidAt + fees populated

SELECT status, "confirmedAt" FROM orders WHERE id IN
  (SELECT "orderId" FROM payments WHERE "paymentGroupId" = '<pg-id>');
-- Expect: all CONFIRMED with confirmedAt set

SELECT "transactionType", status, processed, "processError" FROM payment_events
  WHERE "paymentGroupId" = '<pg-id>';
-- Expect: PAYMENT / COMPLETED / processed=true / null
```

Also expect: shipment rows booked per child order, an ORDER_CONFIRMED
notification, and (log) no webhook warnings.

### Refunds (also test-mode)

1. `POST /admin/orders/:orderId/refund` with `{ amountInCents, reason }` —
   no bank-account type needed (that was PayFast).
2. Expect 200 with `{ refundId, status, cumulativeRefundedInCents }` and the
   Order → REFUND_REQUESTED (partial) immediately.
3. `refund.*` webhooks arrive asynchronously (minutes-to-hours in test mode);
   `refund.processed` flips the PaymentGroup to PARTIALLY_REFUNDED/REFUNDED.
   The webhook is confirmation-only — local accounting is already correct.

### Common failure modes

| Symptom | Likely cause |
|---|---|
| Webhook never arrives | Tunnel died (quick-tunnel URLs change per restart) or dashboard URL not saved for the ACTIVE mode (test vs live have separate URLs) |
| 400 on every webhook | Wrong secret key for the mode, or a body-parsing layer re-serialized the payload (HMAC needs raw bytes) |
| "CRITICAL: unknown reference" | Charge was created outside checkout (fine for delivery tests) or the DB was wiped after init |
| `Required env var PAYSTACK_*` at boot | Missing variable — see `.env.example` |
| Boot refuses test key | `NODE_ENV=production` guard working as designed |

## Session Protocol

Always read `STATUS.md` at the start of every session. Before a session ends, when asked to do a handoff, update `STATUS.md` — not this file.

`STATUS.md` tracks: what was just completed, what's in progress, uncommitted changes, and the immediate next step. This file (`CLAUDE.md`) is the stable reference — only update it when conventions, architecture, or project-wide patterns change.

If `STATUS.md` doesn't exist yet, create it on first handoff request.
