# STATUS.md — Last updated 2026-05-05

## Where we are

**Payments module is complete and committed. CORS config landed (uncommitted).** 494 tests across 27 suites, all passing in ~2.6s.

`main` is up to date with `origin/main`. Last committed work:

- `9a3f54a payment module v1` — All 6 Payments phases + Order/Payments wiring + docs

**Uncommitted on `main`** (to be folded into the next commit):

- `src/cors.config.ts` + `src/cors.config.spec.ts` (NEW) — CORS env-driven allowlist with production guard
- `src/main.ts` — `app.enableCors(buildCorsOptions())` wired after trust-proxy
- `.env.example` — `CORS_ORIGINS` entry with format note + production-required behavior
- `CLAUDE.md`, `STATUS.md` — leftover doc updates from the previous session (PayFast sandbox runbook, Payments handoff state) plus this CORS update

## What's in `9a3f54a`

All decisions documented in [`docs/payments-module/payments-module-foundation.md`](docs/payments-module/payments-module-foundation.md).

| Phase | Name | Tests added |
|-------|------|---|
| 1 | Foundation (schema, scaffold, env config) | +45 |
| 2 | Signature primitives (`phpUrlencode`, signing service) | +74 |
| 3 | Real `initializePayment` + frontend contract change | +18 |
| 4 | ITN webhook (allowlist, notify service, controller, trust-proxy) | +46 |
| 5 | Refund API (REST client, admin wiring, refund-ITN handling) | +28 |
| 6 | Reconciliation tooling + cleanup-cron summary log | +23 |

Schema migration `20260501101905_add_payments_module_foundation` adds `payment_events` table + `ItnTxType` enum + `RECONCILE_REQUIRED` value on `PaymentStatus`.

`OrderModule` now imports `PaymentsModule` and binds `PAYMENT_SERVICE` to the real `PaymentsService` via `useClass`. `PaymentInitResponse` shape is `{ actionUrl, fields }` (replaced the old `payfastRedirectUrl` — breaking change to checkout response, frontend cutover required).

## CORS config (this session)

App-wide CORS via `app.enableCors(buildCorsOptions())` in `main.ts`. Without it, browsers block every cross-origin request from the frontend; the PayFast ITN webhook is server-to-server and unaffected.

- **`CORS_ORIGINS`** — comma-separated origin allowlist (`https://yiiva.co.za,https://staging.yiiva.co.za`). Required in production.
- **Production guard** — boot fails if `NODE_ENV=production` and `CORS_ORIGINS` resolves empty (matches the same fail-closed posture as `PayfastConfig.skipIpCheck`).
- **Dev fallback** — outside production, defaults to `http://localhost:3000,http://localhost:3001`.
- **`credentials: true`** — required for the refresh-token httpOnly cookie. Forces explicit origin listing (browsers refuse `*` with credentials).
- **`maxAge: 86400`** — 24h preflight cache to reduce OPTIONS traffic.

14 tests in `cors.config.spec.ts` cover parsing, dev fallback, production guard, credentials, and maxAge.

## What's fragile

Order-module fragility list (still applies):
1. **TS2502 errors in spec files** — `$transaction` mock pattern. Harmless. Do NOT fix.
2. **Cart compound unique with NULL variantId** — partial unique index migration exists.
3. **Cron Logger output in tests** — error-resilience tests emit expected ERRORs.
4. **`$transaction` mock re-binding** — re-bind in `beforeEach` after `clearAllMocks`.
5. **Guest checkout stock reservation timing** — `cartItem.deleteMany` does NOT release stock; stock transfers to order at commit time.
6. **Admin editOrder accepts empty strings** — intentional.

Payments-specific fragility:
7. **Refund ITN field detection is heuristic.** We detect refund ITNs via `parsedBody.transaction_type === 'refund'`. PayFast's exact field name isn't publicly documented; first production refund will reveal whether this matches. One-line change in `payments-notify.service.ts` if it turns out to be a different field.
8. **Refunds are sandbox-impossible.** `PayfastClient.createRefund` warns when called in sandbox mode but still attempts the call. Production smoke test required for first refund.
9. **`phpUrlencode` is load-bearing.** A single-byte mismatch with PHP's `urlencode()` causes silent signature failures in production. Vector tests in `url-encode.spec.ts` lock this in. Any change requires re-running the vector suite.
10. **The signature trap.** PayFast uses two algorithms with different field-ordering rules: form-flow uses fixed order with trim; API-flow uses ksort alphabetical without trim; ITN verification uses insertion order with break-at-signature. `PayfastSignatureService` exposes them as separate methods — never share code paths.
11. **Source-IP allowlist is fail-closed.** If DNS resolution fails at boot, the allowlist starts empty and rejects all ITNs. Recovery is automatic once DNS recovers, but operators should monitor for the boot-time error log.

## What to do next

CORS just landed — the gate to frontend integration is open. Reordered path:

### 1. Frontend integration begins (out of repo)

Next.js can now make cross-origin requests against the API once `CORS_ORIGINS` is set. First wire-up tasks the frontend repo will tackle:
- Auth flows (login/register/refresh) with `credentials: 'include'` on fetch
- Product browsing
- Cart operations
- Checkout — render `payfast.fields` as a hidden form and auto-submit to `payfast.actionUrl` (the v2 contract from Phase 3)

### 2. PayFast sandbox smoke test (~30 min, organic)

Folded into frontend integration: the smoke test naturally happens when the frontend wires up the checkout flow. Run a checkout end-to-end via the integrated frontend with sandbox creds + ngrok and verify:
- Form submit lands the buyer on PayFast's hosted checkout page
- ITN arrives at our `/payments/notify` endpoint
- All four validations pass (signature, IP via skip, postback, amount)
- `PaymentGroup.status` flips PENDING → COMPLETED
- Each child `Order.status` flips PENDING → CONFIRMED
- A `PaymentEvent` row is recorded with `processed: true`

The full pre-flight runbook is still in `CLAUDE.md` under "PayFast sandbox smoke test" if a discrete check is wanted before frontend work begins.

### 3. Notifications module (medium build)

Unblocks downstream features that are currently stubbed or absent:
- Email verification for guest account claim (currently stubbed `emailVerified: true` in `claim.service.ts`)
- Order confirmation email on `PaymentGroup` → COMPLETED transition (no firing yet; the foundation doc's Pattern 6 explicitly defers this to Notifications)
- Order status emails (CONFIRMED, DISPATCHED, DELIVERED)
- Refund confirmation emails (Phase 5 hint — PayFast emails the buyer if `notifyBuyer: true`, but our own confirmation is still owed)

Already has `EmailModule` scaffold + Resend wired. The work: `NotificationsService` owning templates + dispatch, a contract pattern similar to `IPaymentService` so OrderModule and PaymentsModule can fire `notifications.send(...)` events without direct coupling.

### Recommended path

**Frontend integration → smoke test (organic) → Notifications.** That gets us to "frontend can integrate, real money flows, real emails go out" without doing the bigger Shipping rebuild.

### Lower priority follow-ups

- **Shipping module** — real Courier Guy integration. Replaces R110 flat fee with real rates. Bigger piece; current stub works for v1.
- **e2e tests** — now that CORS is in, can be set up against a real running API instance.
- **Production smoke test for first refund** — sandbox doesn't support refunds; do this on first real refund.
- **Verify the refund-ITN field name** against a real PayFast refund ITN payload (heuristic check).
- **Frontend contract update** (out of repo) — Next.js needs to render `payfast.fields` as a hidden form and auto-submit instead of consuming `redirectUrl`.
- **Phase 7 candidate** — automated daily reconciliation worker. Iterates `PENDING > 24h` PaymentGroups with the manual reconciliation tool's logic. Skip until real-world misses surface.

## Do not touch

- **Do not refactor existing Order or Payments code** unless the user asks. Tested, documented, committed.
- **Do not fix TS2502 errors** in spec files.
- **Do not change `phpUrlencode`** without re-running vector tests.
- **Do not change the signature primitives** in `PayfastSignatureService`. The trim/no-trim divergences between form, ITN, and API flows are deliberate and source-cited.
- **Do not change the CANCELLED-stays-CANCELLED rule.** A late COMPLETED ITN must never resurrect a CANCELLED order — it goes to `RECONCILE_REQUIRED` for manual ops.
- **Do not change cron cutoff values** — 24h for stale carts, 30 min for pending orders.
- **Do not enable `PAYFAST_SKIP_IP_CHECK=true` in production.** `PayfastConfig` refuses to boot if `NODE_ENV=production` and skip is true.
- **Do not leave `CORS_ORIGINS` unset in production.** `buildCorsOptions` refuses to boot. Use the env var for every environment that's not local dev.
- **Do not use `origin: '*'` for CORS** — the refresh-token cookie requires `credentials: true`, which is incompatible with wildcard origins.
- **Do not implement Shipping or Notifications integrations** — separate workstreams.
