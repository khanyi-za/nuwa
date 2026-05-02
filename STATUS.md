# STATUS.md — Last updated 2026-05-01

## Where we are

**Payments module is complete.** All 6 phases shipped this session. 480 tests across 26 suites, all passing in ~2s.

`main` is up to date with `origin/main`. The session's work is **uncommitted on `main`**:

```
Modified:
  CLAUDE.md
  STATUS.md
  .env.example
  prisma/schema.prisma
  src/app.module.ts
  src/main.ts
  src/order/admin-orders/admin-orders.controller.ts
  src/order/admin-orders/admin-orders.service.ts
  src/order/admin-orders/admin-orders.service.spec.ts
  src/order/checkout/checkout.service.ts
  src/order/checkout/checkout.service.spec.ts
  src/order/contracts/payment-contract.ts
  src/order/contracts/stubs/payment-stub.service.ts
  src/order/cron/order-cleanup.service.ts
  src/order/cron/order-cleanup.service.spec.ts
  src/order/order.module.ts

Untracked:
  docs/payments-module/payments-module-foundation.md
  prisma/migrations/20260501101905_add_payments_module_foundation/
  src/order/dto/admin-refund-order.dto.ts
  src/payments/                                   (full directory)
```

The user has not asked for a commit yet.

## What was built this session

All decisions documented in [`docs/payments-module/payments-module-foundation.md`](docs/payments-module/payments-module-foundation.md).

| Phase | Name | Tests added |
|-------|------|---|
| 1 | Foundation (schema, scaffold, env config) | +45 |
| 2 | Signature primitives (`phpUrlencode`, signing service) | +74 |
| 3 | Real `initializePayment` + frontend contract change | +18 |
| 4 | ITN webhook (allowlist, notify service, controller, trust-proxy) | +46 |
| 5 | Refund API (REST client, admin wiring, refund-ITN handling) | +28 |
| 6 | Reconciliation tooling + cleanup-cron summary log | +23 |

**Schema migration** — `20260501101905_add_payments_module_foundation`:
- New `payment_events` table (audit log; `itnHash` unique constraint = idempotency primitive)
- New `ItnTxType` enum (`PAYMENT`, `REFUND`)
- Added `RECONCILE_REQUIRED` to `PaymentStatus`

**Contract changes** — `IPaymentService`:
- `PaymentInitRequest` now includes `mPaymentId`, `itemName`. Removed `notifyUrl` (sourced from `PayfastConfig`).
- `PaymentInitResponse` rewritten to `{ actionUrl, fields }` — **breaking change** to checkout response shape. The frontend renders the field map as a hidden form and auto-submits to PayFast.
- Added `refundPayment()` method with `RefundRequest` / `RefundResponse` types.

**Wiring**:
- `OrderModule` imports `PaymentsModule` and binds `PAYMENT_SERVICE` to the real `PaymentsService` via `useClass`.
- `main.ts` configures `app.set('trust proxy', N)` from `PayfastConfig.trustProxy` (defaults to 1 for Railway).

## What's fragile

The Order-module fragility list (still applies):
1. **TS2502 errors in spec files** — `$transaction` mock pattern. Harmless. Do NOT fix.
2. **Cart compound unique with NULL variantId** — partial unique index migration exists.
3. **Cron Logger output in tests** — error-resilience tests emit expected ERRORs.
4. **`$transaction` mock re-binding** — re-bind in `beforeEach` after `clearAllMocks`.
5. **Guest checkout stock reservation timing** — `cartItem.deleteMany` does NOT release stock; stock transfers to order at commit time.
6. **Admin editOrder accepts empty strings** — intentional.

New fragility introduced this session:

7. **Refund ITN field detection is heuristic.** We detect refund ITNs via `parsedBody.transaction_type === 'refund'`. PayFast's exact field name isn't publicly documented; first production refund will reveal whether this matches. One-line change in `payments-notify.service.ts` if it turns out to be a different field.

8. **Refunds are sandbox-impossible.** `PayfastClient.createRefund` warns when called in sandbox mode but still attempts the call. Production smoke test required for first refund.

9. **`phpUrlencode` is load-bearing.** A single-byte mismatch with PHP's `urlencode()` causes silent signature failures in production. Vector tests in `url-encode.spec.ts` lock this in. Any change requires re-running the vector suite.

10. **The signature trap.** PayFast uses two algorithms with different field-ordering rules: form-flow uses fixed order with trim; API-flow uses ksort alphabetical without trim; ITN verification uses insertion order with break-at-signature. `PayfastSignatureService` exposes them as separate methods — never share code paths.

11. **Source-IP allowlist is fail-closed.** If DNS resolution fails at boot, the allowlist starts empty and rejects all ITNs. Recovery is automatic once DNS recovers, but operators should monitor for the boot-time error log.

## What to do next

**Open follow-up items**:

- **Live sandbox smoke test for end-to-end checkout** (Phase 3+4 definition of done). Requires:
  - `.env` with PayFast sandbox creds set
  - ngrok tunnel exposing `/payments/notify` publicly
  - `PAYFAST_SKIP_IP_CHECK=true` for dev (ngrok rewrites source IP)
  - `PAYFAST_NOTIFY_URL=https://<ngrok-id>.ngrok.io/payments/notify`
  - Manual checkout via the frontend
  - Verify ITN arrives, order goes PENDING → CONFIRMED in DB

- **Production smoke test for first refund** (Phase 5 definition of done — sandbox doesn't support refunds).

- **Verify the refund-ITN field name** against a real PayFast refund ITN payload.

- **Frontend contract update** — the checkout response now returns `payfast: { actionUrl, fields }` instead of `redirectUrl`. Frontend repo needs to render hidden form + auto-submit.

**Other workstreams** (unchanged):
- Shipping module (real Courier Guy integration; replace `ShippingStubService`).
- Notifications module (email verification for guest claim, order status emails).
- CORS config (needed before frontend integration).
- e2e tests.

**Deferred Phase 7 candidate** — automated daily reconciliation job that iterates all `PENDING > 24h` PaymentGroups and uses the manual reconciliation tool's logic to auto-resolve unambiguous cases. Not blocking v1.

## Do not touch

- **Do not refactor existing Order or Payments code** unless the user asks. Tested, documented.
- **Do not fix TS2502 errors** in spec files.
- **Do not change `phpUrlencode`** without re-running vector tests.
- **Do not change the signature primitives** in `PayfastSignatureService`. The trim/no-trim divergences between form, ITN, and API flows are deliberate and source-cited.
- **Do not change the CANCELLED-stays-CANCELLED rule.** A late COMPLETED ITN must never resurrect a CANCELLED order — it goes to `RECONCILE_REQUIRED` for manual ops.
- **Do not change cron cutoff values** — 24h for stale carts, 30 min for pending orders.
- **Do not enable `PAYFAST_SKIP_IP_CHECK=true` in production.** `PayfastConfig` refuses to boot if `NODE_ENV=production` and skip is true.
- **Do not implement Shipping or Notifications integrations** — separate workstreams.
