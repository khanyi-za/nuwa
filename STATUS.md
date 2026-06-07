# STATUS.md — Last updated 2026-06-06

## Where we are

**Shipping module is feature-complete for v1; mobile auth implementation guide is shipped.** The full commerce chain works end-to-end on real ShipLogic (buyer pays → ITN → Order CONFIRMED → ShipLogic books the parcel → webhook drives Order status transitions → merchant downloads waybill PDF). The mobile team now has a comprehensive technical wire-up guide for auth (token storage, refresh interceptor, deep-link routing) on top of the UX flows doc.

**Up next:** Notifications module is the largest remaining gap before mobile launch — buyers currently pay and receive no confirmation email.

- **Tests:** 666 across 42 suites, all passing in ~2.8s (unchanged since 2026-06-03 — recent work has been docs-only)
- **Type check:** clean (three pre-existing TS2502 errors only)
- `main` last committed: `6edccf6 pre mobile integration, api docs/contracts`

## Uncommitted on `main`

Three categories — shipping module (Phases 1-6, full source + 2 migrations + foundation doc), mobile auth docs, and small wiring/comment fixes from the auth-guide review.

### Shipping module (all `src/shipping/` is new)
- `src/shipping/` — 27 new source files. Module, controllers, services, DTOs, ShipLogic client + types + address mapping, status mapping. Full breakdown documented in the 2026-06-03 STATUS (still valid).
- `prisma/migrations/20260603155000_shipping_module_phase2/` — `Address.suburb`, `ShipmentEvent` table, `ShipmentEventType` enum
- `prisma/migrations/20260603160209_dispatch_address_soft_delete/` — `StoreDispatchAddress.deletedAt` + index
- `prisma/schema.prisma` — three deltas applied (suburb, comment clarification on `Shipment.waybillNumber`, `ShipmentEvent` model)
- `src/main.ts` — `NestFactory.create({ rawBody: true })` (for the ShipLogic webhook hash)
- `src/app.module.ts` — `ShippingModule` registered
- `src/order/order.module.ts` — imports `ShippingModule`; dropped local stub binding
- `src/order/contracts/shipping-contract.ts` — extended `ShippingRateRequest` with `delivery` + `declaredValueInCents`; legacy fields kept for backwards compat
- `src/order/checkout/totals.ts` — `computeCheckoutTotals` signature: `(items, Map<storeId, number>)`. `CheckoutStoreGroup.shippingInCents` added; `totalInCents = subtotal + shipping`
- `src/order/checkout/totals.spec.ts` — all 7 tests updated to the new Map signature; +1 new test
- `src/order/checkout/checkout.service.ts` — per-store rate quote loop (`quoteShippingPerStore`), `toDeliveryAddress` helper, Order persists per-store shipping fields
- `src/order/checkout/checkout.service.spec.ts` — `storeDispatchAddress.findFirst` added to mock; assertions updated
- `src/order/dto/create-address.dto.ts` + `update-address.dto.ts` — `suburb` field added
- `src/order/address/address.service.ts` — `create` + `update` plumb suburb through
- `src/order/buyer-orders/buyer-orders.service.ts` — constructor takes `ShipmentCancellationService`; cancel-propagation hook after cancel succeeds
- `src/order/buyer-orders/buyer-orders.service.spec.ts` — mock added for the new dep
- `src/payments/payments.module.ts` — imports `ShippingModule` (one-way)
- `src/payments/payments-notify.service.ts` — constructor takes `ShipmentCreationService`; post-ITN hook fires `createShipmentForOrder` outside TX after COMPLETED transition
- `src/payments/payments-notify.service.spec.ts` — mock added for the new dep
- `.env.example` — full ShipLogic section: base URL, API key, defaults, fallback rate, webhook secret, IP allowlist

### Mobile auth documentation
- `docs/Api-mobileapp-contracts/auth-mobile-guide.md` (NEW) — 1,194-line technical implementation companion to `auth-flows.md`. Self-contained: SecureStore token storage with Zustand store, custom `fetch` wrapper with single-flight refresh guard, full API contract duplicated (10 endpoints), code-focused auth flows, error handling reference, rate limits, Expo/expo-router universal-link setup, AppState lifecycle. **Two improvements applied by user** during review: `decodeBase64Url` for JWT payload decoding (atob fails on `-_` chars), and `auth === 'required'` guard on the 401 handler (prevents accidental session-wipe when an `auth: 'optional'` call returns 401).
- `docs/Api-frontend-contracts/auth-module-api.md` — `POST /auth/claim` documented for the first time: added to endpoint summary table + full endpoint section with v1 limitations callout (`emailVerified: true` is auto-set; no real verification yet).

### Shipping foundation doc
- `docs/shipping-module/shipping-module-foundation.md` (NEW, in the new folder) — ~700 lines. Locks Q11–Q26 decisions. Full schema description (what exists vs what we added in Phase 2). Status mapping table. Phase plan. Q24 (webhook auth) still TBD pending TCG support.
- `docs/thecourierguy/` (NEW folder) — Postman collections + research artifacts.

### Reference materials (also uncommitted)
- TCG support email draft (in conversation history, not committed to repo) — ready to send/use as call prep. Covers webhook delivery in sandbox, signing model, IP range, retry behavior.

## What was completed since the last STATUS update (2026-06-03)

### 2026-06-04 — Mobile auth implementation guide
- Drafted `auth-mobile-guide.md` covering all 7 + 2 sections from agreed outline: storage, token system, custom HTTP wrapper, full API contract (incl. `POST /auth/claim` — the one missing from `auth-module-api.md`), implementation-focused auth flows, error handling, rate limits, Expo setup, app lifecycle.
- Updated `auth-module-api.md` to add `POST /auth/claim` (endpoint summary table row + full section). Cross-links to mobile docs added.
- User reviewed `auth-mobile-guide.md` and applied two correctness improvements (base64url JWT decoding, 401 handler guard) — both real production-grade fixes that would have caused subtle bugs in the original draft.

### 2026-06-05 / 06-06 — housekeeping
- Killed stale process on port 3000 (recurring issue).
- TCG support email drafted, ready to use.

## What's next (when work resumes)

Recommended sequence:

1. **Commit the uncommitted pile** — substantial: shipping module (Phases 1-6), mobile auth guide + `auth-module-api.md` update, foundation doc, migrations. The full state would land in one big commit, or split into "shipping module" + "mobile auth docs" if you prefer cleaner history.
2. **Send / call the TCG support questions** — answers unblock Q24 (webhook auth model). Email draft is ready; calling was your preference per earlier session.
3. **Notifications module** (~3-5 days) — hard blocker for mobile launch. Build in two parts:
   - **Phase A — transactional emails:** order confirmation, order status updates (confirmed/dispatched/in-transit/delivered/cancelled), refund confirmation, payout confirmation. Layer on top of existing `EmailService` (Resend). Hooks into `PaymentsNotifyService` (order confirmed) + `ShippingWebhookService` (status transitions) + buyer-orders cancel + admin refund. Also unblocks proper guest-account-claim email verification.
   - **Phase B — push notifications + inbox:** `POST /me/push-tokens` for Expo push token registration, push delivery pipeline, `GET /me/notifications` for inbox tab. Reads the `Notification` schema model (12 typed events).
4. **`POST /auth/resend-verification`** — quick win to layer onto Phase A. Currently no recovery path for missed verification emails.
5. **PayFast sandbox smoke test** (~1-2 hrs) — still pending per CLAUDE.md. Now the chain is end-to-end real (PayFast → ITN → ShipLogic post-hook → Shipment row), this smoke verifies all of it.
6. **ContentPost / shoppable-media module** (~3-4 days) — the defining mobile UX, schema-only today. Discover feed with positionX/Y product overlays. Could slot before or after Notifications depending on launch theme.
7. **Bank-fields owner-only authz** — Priority 1 security gap. ~1 hour fix.

### Smaller backlog (deferred from before)
- `Order.shippingSuburb` snapshot field — small additive migration; ShipLogic geocodes without it but degrades for outlying SA areas
- Reviews module (schema-only)
- Promotions module (schema-only)
- Support tickets module (schema-only)
- `GET /stores` browse-stores list endpoint
- Multi-status filter on `GET /orders`
- `GET /orders?mPaymentId=<id>` and `?orderNumbers=A,B,C` for clean checkout-success recovery
- "Resume payment" endpoint for PENDING orders
- `GET /auth/me/employments` for employee returning sessions
- AI tagging worker (consumes the `isAiGenerated` + `confidence` flags on `ProductTag`)
- AnalyticsEvent ingestion (`POST /analytics/events`)
- Polling fallback cron for missed ShipLogic webhooks

## What's fragile

(Existing 31-entry fragility list still applies — unchanged. The shipping-related entries 23-31 from 2026-06-03 STATUS are particularly important to read before touching shipping or webhook code.)

No new fragility entries this round — the mobile auth guide and `auth-module-api.md` update are doc-only.

One refinement worth noting: the auth-guide's HTTP wrapper now uses `decodeBase64Url` not `atob` for JWT payload parsing. Standard `atob` will fail on payloads with `-` or `_` characters because JWTs use RFC 4648 §5 (base64url, not standard base64). Any future code touching JWTs from the mobile side should reuse the same helper.

## Backend follow-ups accumulated

(Older Priority 1/2/3 list still applies. No new follow-ups this round.)

The TCG support call/email being queued is the load-bearing pending item — it unblocks Q24 (webhook auth confirmation) which the foundation doc has flagged as TBD since Phase 6 shipped.

## Do not touch

(Existing list still applies — 6 shipping-related entries added on 2026-06-03 are particularly load-bearing.)

No new do-not-touch entries this round.
