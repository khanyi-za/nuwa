# YIIVA — Payments Module: Foundation

> Locked architectural decisions, schema changes, integration patterns, and phase breakdown for the PayFast Payments module.
> Stack: NestJS + Prisma + PostgreSQL + PayFast (South African gateway)
> Status: Decisions locked. Implementation pending.

---

## Table of Contents

1. [Context](#context)
2. [Locked Architectural Decisions](#locked-architectural-decisions)
3. [Schema Changes](#schema-changes)
4. [Cross-Module Dependencies](#cross-module-dependencies)
5. [PayFast Integration Patterns](#payfast-integration-patterns)
6. [Module Scaffold](#module-scaffold)
7. [Configuration Surface](#configuration-surface)
8. [Phase Breakdown](#phase-breakdown)
9. [Things Worth Flagging](#things-worth-flagging)
10. [Phase Decisions Log](#phase-decisions-log)

---

## Context

The Payments module is the third of the three tightly-related commerce modules (Orders → Payments → Shipping). The Order module shipped with `PaymentStubService` bound to the `PAYMENT_SERVICE` injection token; this module replaces that stub with a real PayFast integration.

**What Payments owns:**
- All PayFast-specific code: signature generation, ITN webhook validation, refund API
- The `PaymentEvent` audit log (new in this module)
- Reconciliation tooling (admin endpoint + structured logging)

**What Payments reads from / triggers (but does not own):**
- Reads `PaymentGroup`, `Payment` — populated by `OrderModule` at checkout
- Reads `Order` — for state transitions on ITN receipt
- Provides `IPaymentService` to `OrderModule` (`CheckoutService.commit()`, `AdminOrdersService.requestRefund()`)

**Why now.** Order module is complete and tested. Stubs are clean drop-in replacements via the `useClass` swap pattern. Frontend is preparing checkout integration; real PayFast is the last blocker on real money flowing.

**PayFast documentation reference.** PayFast's developer portal is a JavaScript-rendered SPA that does not return content via standard HTTP fetch. The canonical reference for integration details is the official PHP SDK: `https://github.com/Payfast/payfast-php-sdk`. Specifically:
- `lib/Auth.php` — signature algorithms (form vs API flows differ)
- `lib/PaymentIntegrations/Notification.php` — ITN four-step validation
- `lib/PaymentIntegrations/CustomIntegration.php` — redirect form flow
- `lib/Services/Refunds.php` — refund API surface

---

## Locked Architectural Decisions

Five decisions, each settled after focused review. All locked.

### 1. Frontend handoff — JSON `{ actionUrl, fields }`

The backend returns the signed PayFast field map as JSON; the frontend renders a hidden form and auto-submits. The previous stub returned a single `redirectUrl` — **this is a breaking change to the checkout response shape.**

**New `PaymentInitResponse` shape:**
```typescript
{
  paymentGroupId: string;
  mPaymentId: string;
  payfast: {
    actionUrl: string;             // sandbox or live /eng/process URL
    fields: Record<string, string>; // every signed field including signature
  };
}
```

**Why this over backend-rendered HTML:** keeps the API JSON-only, no template engine, forward-compatible with PayFast's onsite mode (which is JSON-shaped), one less HTTP endpoint and one less rendering surface to test.

**Frontend contract change is in lockstep.** No dual-shape transition; the frontend has not shipped a real PayFast integration yet, so the breaking change has no production impact.

### 2. Raw body parsing — Pattern A (reparse via `req.body`)

The ITN webhook reparses `req.body` (already populated by Express's default `urlencoded` body parser) and rebuilds the signature input string using a custom `phpUrlencode()` helper that byte-matches PHP's `urlencode()`.

**Why not raw body access:** PayFast's signature algorithm operates on URL-decoded values that get re-encoded via their own `urlencode()`. As long as our encoder matches theirs, comparison is byte-perfect. Raw-body surgery (locating and excising the `signature=...` segment) is more error-prone and offers no real advantage.

**The encoder helper:**
```typescript
function phpUrlencode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/%20/g, '+');
}
```

This matches PHP's `urlencode()` for ASCII and UTF-8. Validated by vector tests against known PayFast sandbox payloads.

**No bootstrap changes required.** Express's default body parser preserves insertion order; the global `ValidationPipe` is a no-op without a DTO target; `JwtAuthGuard` is bypassed via `@Public()`.

### 3. Idempotency — `PaymentEvent` log + state machine

A new `PaymentEvent` table records every received ITN. The unique constraint on `itnHash` (sha256 of canonical payload including signature) enforces dedupe at the database layer. The `PaymentGroup.status` materialized projection is updated via optimistic-CAS (`updateMany` with status guard) so concurrent ITN handlers cannot corrupt state.

**Allowed state transitions (PaymentGroup):**
```
PENDING            → COMPLETED, FAILED, CANCELLED
COMPLETED          → PARTIALLY_REFUNDED, REFUNDED
PARTIALLY_REFUNDED → PARTIALLY_REFUNDED, REFUNDED
REFUNDED, FAILED, CANCELLED → terminal (no transitions)
```

**The CANCELLED-stays-CANCELLED rule:** if a `COMPLETED` ITN arrives for a `PaymentGroup` whose orders are already CANCELLED (e.g., the 30-min cleanup cron fired before the ITN), the order is **not** resurrected. Instead:
- The `PaymentGroup.status` is set to `RECONCILE_REQUIRED`
- The PaymentEvent is recorded with `processed: false, processError: 'ORDER_ALREADY_CANCELLED'`
- A critical structured-log alert is emitted
- Operations resolves manually (refund or contact buyer)

**Why:** integrity. Orders may be cancelled by buyer, merchant, admin, or cron; once cancelled, money flow goes through refund — never silent un-cancel.

### 4. Source verification — IP allowlist

The PHP SDK's `pfValidIP()` resolves the incoming `Referer` header server-side, which is trivially spoofable. We replace it with a real source-IP check.

**At boot:** resolve PayFast's four hostnames (`www.payfast.co.za`, `sandbox.payfast.co.za`, `w1w.payfast.co.za`, `w2w.payfast.co.za`) to a Set of IPs.
**Every hour:** refresh the cache. If refresh produces an empty set, keep the previous cache and log a critical error.
**Per request:** compare `req.ip` (after trust-proxy normalization) to the cached set. Reject if not present.

**Failure mode:** fail-closed. If DNS is unreachable at boot, the allowlist is empty and every ITN is rejected (PayFast retries up to 11 times over ~2 days, so transient DNS outages self-heal).

**Dev bypass:** `PAYFAST_SKIP_IP_CHECK=true` skips the check. Boot-time guard refuses to start if `NODE_ENV=production && PAYFAST_SKIP_IP_CHECK=true`.

**Trust proxy:** `app.set('trust proxy', 1)` in `main.ts`. Railway adds one edge proxy hop. Override via `TRUST_PROXY` env var if topology changes (e.g., Cloudflare added in front).

**Configurable hostname list:** `PAYFAST_NOTIFY_HOSTS` env var (comma-separated) overrides the four defaults. Allows ops to add a new PayFast egress host without a code deploy if PayFast ever expands their fleet.

**IPv6 normalization:** `req.ip` may return `::ffff:1.2.3.4` (IPv4-mapped IPv6) depending on platform. Strip the `::ffff:` prefix before comparison.

### 5. Reconciliation — trust retries + manual tool

PayFast has no single-transaction status query (their `transactions/history` API returns date ranges only). For v1 we accept this gap, with mitigations:

**v1 ships:**
1. **Trust PayFast's retry policy** — 11 retries over ~2 days handles 99%+ of cases.
2. **Manual reconciliation tool** — `GET /admin/payments/groups/:id/reconcile` (admin-only, read-only). Calls `transactions/history` with a 7-day window around `PaymentGroup.createdAt`, finds the matching `m_payment_id`, returns the PayFast record + verdict (`MATCH | MISMATCH | NOT_FOUND | MATCH_PENDING`). Does not mutate state.
3. **Cleanup-cron summary log** — `OrderCleanupService` emits one structured log line per cycle:
   ```json
   { "event": "payment_cleanup_summary", "pending": N, "reconcileRequired": N, "cancelledThisCycle": N, "olderThan30Min": N }
   ```
   Ops sets up alerts on Datadog/Logflare.
4. **Documented playbook** — when a buyer reports being charged with no order, ops uses the manual tool to investigate.

**Deferred to a follow-up phase:**
5. **Automated daily reconciliation job** (Option C from design review). Iterates the manual tool's logic across yesterday's PaymentGroups; auto-resolves unambiguous cases. Skip in v1; revisit if real-world misses surface.

**Skipped entirely:**
6. **Pre-cancel verification in the cleanup cron** (Option B from design review). Couples the hot-path cron to PayFast's API uptime. Marginal gain over Option C; rejected.

---

## Schema Changes

One Prisma migration: `add_payments_module_foundation`. No data backfill needed.

### Change 1 — New `PaymentEvent` model

The audit log for every received ITN. Idempotency is enforced at the database layer via the `itnHash` unique constraint.

```prisma
model PaymentEvent {
  id              String        @id @default(cuid())
  paymentGroupId  String
  itnHash         String        @unique // sha256(canonicalize(payload)) — dedupe key
  pfPaymentId     String?
  status          PaymentStatus // status carried by this ITN
  transactionType ItnTxType     // PAYMENT or REFUND

  payload         Json          // full ITN body, parsed
  signature       String        // PayFast's signature on this ITN
  sourceIp        String?

  receivedAt      DateTime      @default(now())
  processed       Boolean       @default(false)
  processError    String?       // null if processed; reason string if rejected/skipped

  paymentGroup    PaymentGroup  @relation(fields: [paymentGroupId], references: [id], onDelete: Cascade)

  @@index([paymentGroupId, receivedAt])
  @@index([pfPaymentId])
  @@map("payment_events")
}

enum ItnTxType {
  PAYMENT
  REFUND
}
```

**Why `itnHash` and not `[pfPaymentId, status]`:** handles partial refunds (multiple `PARTIALLY_REFUNDED` events on same `pfPaymentId` → distinct hashes), pure replays (identical payload → identical hash → blocked), and any future event types without baking PayFast field semantics into the constraint.

**Retention:** indefinite for v1. Marketplace finance compliance argues for permanence; volume is low (1–3 events per checkout).

### Change 2 — Extend `PaymentStatus` enum

Add one value:

```prisma
enum PaymentStatus {
  PENDING
  COMPLETED
  FAILED
  CANCELLED
  REFUNDED
  PARTIALLY_REFUNDED
  RECONCILE_REQUIRED  // NEW — late ITN after local cancel; ops must resolve manually
}
```

`PARTIALLY_REFUNDED` and `REFUNDED` already exist; no change needed there.

**Note on naming:** PayFast's ITN sends `payment_status=COMPLETE` (no D). Our enum is `COMPLETED`. The signature service maps `COMPLETE → COMPLETED` and `FAILED → FAILED` and so on at parse time. The mapping table lives in `payfast/payfast-types.ts`.

### What does NOT change

`PaymentGroup` and `Payment` already carry every field PayFast needs:
- `pfPaymentId`, `pfSignature`, `itnPayload`, `pfToken`, `pfNameFirst/Last`, `pfEmailAddress`, `paidAt`, `failedAt`, `method` on `PaymentGroup`
- `refundedAmountInCents`, `refundedAt` on `Payment`

No migrations on these tables.

---

## Cross-Module Dependencies

```
┌─────────────────┐   provides IPaymentService   ┌──────────────────┐
│   OrderModule   │ ──────────────────────────►  │  PaymentsModule  │
│                 │                              │                  │
│ CheckoutService ├────► initializePayment() ────┤ PaymentsService  │
│ AdminOrdersSvc  ├────► refundPayment()    ────┤                  │
└─────────────────┘                              │                  │
                                                 │ PaymentsCtrl     │
                                                 │  POST /notify    │  ◄── PayFast
                                                 │                  │
                                                 │ PaymentsAdminCtrl│
                                                 │  GET .../reconcile│ ◄── Admin
                                                 └──────────────────┘
```

**OrderModule continues to depend only on the `PAYMENT_SERVICE` injection token.** No direct import of PaymentsModule. The contract pattern is preserved.

**`IPaymentService` extends with one method:**

```typescript
export interface RefundRequest {
  pfPaymentId: string;          // PayFast's UUID, captured from ITN
  amountInCents: number;        // partial-refund supported
  reason: string;
  accType: 'current' | 'savings';
  notifyBuyer?: boolean;
}

export interface RefundResponse {
  refundId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  raw: unknown;                 // store on Payment for audit
}

export interface IPaymentService {
  initializePayment(req: PaymentInitRequest): Promise<PaymentInitResponse>;
  refundPayment(req: RefundRequest): Promise<RefundResponse>;
}
```

`PaymentInitResponse` shape changes per Decision 1. `PaymentInitRequest` is unchanged.

**`AdminOrdersService.requestRefund()`** is rewired in Phase 5 to call through the contract. The current stub (sets `Order.status = REFUND_REQUESTED`) is replaced by a real PayFast API call followed by status update on success.

---

## PayFast Integration Patterns

### Pattern 1 — Two signature schemes, one helper

PayFast uses two distinct signature algorithms and they must not be confused:

| Mode | Used for | Field ordering | Base URL |
|---|---|---|---|
| Form flow | Initiating a redirect payment | **Fixed** SDK-defined order | `sandbox.payfast.co.za` / `www.payfast.co.za` |
| API flow | Refunds, transaction history, postback | **Alphabetical** (`ksort`) | `api.payfast.co.za` (`?testing=true` for sandbox) |

The signature primitives are shared (MD5 of urlencoded params, passphrase appended URL-encoded, `phpUrlencode()` semantics). `PayfastSignatureService` exposes:

```typescript
signFormPayload(fields: Record<string, string>, passphrase: string): string;
signApiRequest(headers: Record<string, string>, query: Record<string, string>, body: Record<string, unknown>, passphrase: string): string;
verifyItnSignature(parsedBody: Record<string, string>, passphrase: string): boolean;
buildPostbackBody(parsedBody: Record<string, string>): string;
```

The fixed field order for form flow lives in `payfast/field-order.ts` as a frozen array. Empty values are excluded; remaining values are urlencoded with `phpUrlencode()`, joined `&`, and the passphrase is appended as `passphrase=<urlencoded>` before MD5.

### Pattern 2 — ITN four-step validation

Every incoming ITN runs through four checks. All must pass.

```
1. Verify signature              [pure crypto, ~100µs]
2. Verify source IP              [Set membership, O(1)]
3. Verify amount match           [pure arithmetic, 0.01 tolerance per PayFast spec]
4. Postback to /eng/query/validate [HTTP, ~200ms, expects literal "VALID"]
```

The full flow in `PaymentsNotifyService.handle()`:

```
1. Parse body (already done by Express)
2. Verify signature
3. Verify source IP
4. Compute itnHash (sha256 of canonical body)
5. Look up PaymentGroup by m_payment_id
6. Verify amount match (with 0.01 tolerance)
7. Postback to /eng/query/validate
8. INSERT PaymentEvent (unique itnHash)
   - On unique violation: idempotent ack, return 200
9. Open transaction:
   a. Re-read PaymentGroup status
   b. Decide if transition is valid
   c. updateMany with status guard (CAS)
   d. Update child Payments + Orders
   e. UPDATE PaymentEvent SET processed = true
10. Return 200
```

### Pattern 3 — HTTP response policy

| Situation | Response | Reason |
|---|---|---|
| Bad signature | `400` + log security event | Reject; PayFast doesn't send bad sigs. Surfaces in PayFast retry counts. |
| Bad source IP | `400` + log security event | Same. |
| Postback returns non-VALID | `400` | PayFast's own server denies the event. |
| Unknown `m_payment_id` (sig valid) | `200` + critical alert | Sig valid → genuinely from PayFast → we lost data. Retrying won't fix. |
| Amount mismatch | `400` + critical alert | Tampering or our calculation is wrong. |
| Replay (`itnHash` exists) | `200` | Idempotent ack. |
| Valid + transition applied | `200` | Happy path. |
| Valid but invalid transition | `200` + log warning | Already-terminal or out-of-order; retry won't help. |
| CANCELLED → COMPLETED (late ITN) | `200` + RECONCILE alert | Event recorded; manual handling. |
| Internal exception | `500` | Transient — invite retry. |

### Pattern 4 — Optimistic CAS for concurrent ITN handling

Two ITNs racing on the same `paymentGroupId` (e.g., a retry hits while the previous attempt is still processing) cannot corrupt state. We use Postgres's atomic UPDATE-with-WHERE rather than row locks:

```typescript
const result = await tx.paymentGroup.updateMany({
  where: { id: groupId, status: expectedFromStatus },  // CAS guard
  data: { status: targetStatus, pfPaymentId, paidAt },
});
if (result.count === 0) {
  // Someone transitioned us. Reload + re-evaluate.
}
```

Single SQL `UPDATE ... WHERE status = ?`. Atomic, no locks held. If two transitions try at once, only one's `WHERE` matches; the other re-evaluates cleanly.

### Pattern 5 — Event log before action

Every action (state transition, child Order update, refund-amount accumulation) happens **after** the corresponding `PaymentEvent` is recorded. The flow guarantees:

- An action without an event row is impossible (event row inserts first).
- A duplicate event (same `itnHash`) is rejected at INSERT time, before any DB mutation.
- Forensics: every "what did PayFast tell us, when, and what did we do about it" answer lives in one table.

### Pattern 6 — Side-effect scope (the same-transaction rule)

When a `PaymentGroup` transitions `PENDING → COMPLETED`, the side effects happen in **one Prisma transaction** with the status update:

1. `PaymentGroup.status = COMPLETED`, `pfPaymentId`, `paidAt`, buyer fields populated
2. All child `Payment.status = COMPLETED`, `paidAt` set per Payment
3. All child `Order.status = CONFIRMED` (only where currently `PENDING` — `updateMany` guard)
4. `PaymentEvent.processed = true`

What we do **not** do in that transaction:
- Send emails (deferred to Notifications module)
- HTTP calls (postback already happened pre-transaction)
- Webhook fan-out (none for v1)

### Pattern 7 — Stub → real swap is single-line

The Order module imports `PAYMENT_SERVICE` as an injection token, never the concrete class. Phase 3 swaps the binding in `order.module.ts`:

```typescript
// Before
{ provide: PAYMENT_SERVICE, useClass: PaymentStubService },

// After
{ provide: PAYMENT_SERVICE, useClass: PaymentsService },
```

Zero changes in `CheckoutService`, `AdminOrdersService`, or any other consumer. The contract pattern is preserved.

---

## Module Scaffold

```
src/payments/
  payments.module.ts                 — registers controllers + services + binds PAYMENT_SERVICE
  payments.controller.ts             — POST /payments/notify (public), GET /payments/health
  payments-admin.controller.ts       — GET /admin/payments/groups/:id/reconcile (admin-only)
  payments.service.ts                — implements IPaymentService (initialize + refund)
  payments-notify.service.ts         — ITN four-step validation + state machine
  payments-reconcile.service.ts      — manual reconciliation logic (admin endpoint)

  payfast/
    payfast-config.ts                — env loading, sandbox toggle, base URL resolution
    payfast-signature.service.ts     — pure signing primitives + ITN verification
    payfast-client.service.ts        — axios wrapper for api.payfast.co.za + postback
    payfast-ip-allowlist.service.ts  — DNS-resolved IP allowlist with refresh
    payfast-types.ts                 — ITN payload, refund response, status mapping
    field-order.ts                   — canonical fixed field order for form flow
    url-encode.ts                    — phpUrlencode() helper

  dto/
    initiate-payment.dto.ts          — internal types for initialize call
    refund.dto.ts                    — admin refund request DTO
    reconcile.dto.ts                 — admin reconcile response DTO

  payments.service.spec.ts
  payments-notify.service.spec.ts
  payments-reconcile.service.spec.ts
  payfast/
    payfast-signature.service.spec.ts  — vector tests against known PayFast payloads
    payfast-client.service.spec.ts
    payfast-ip-allowlist.service.spec.ts
    url-encode.spec.ts                 — phpUrlencode helper tests
```

`PaymentsModule` is imported by `AppModule`. Binds `PAYMENT_SERVICE` token internally (Phase 3 swap).

---

## Configuration Surface

Env vars validated at boot. Module fails fast if any required var is missing or malformed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PAYFAST_MERCHANT_ID` | yes | — | PayFast merchant ID |
| `PAYFAST_MERCHANT_KEY` | yes | — | PayFast merchant key |
| `PAYFAST_PASSPHRASE` | yes | — | PayFast passphrase, trimmed at use |
| `PAYFAST_SANDBOX` | yes | — | `true` or `false`. Toggles form-flow base URL + `?testing=true` on API |
| `PAYFAST_RETURN_URL` | yes | — | Buyer redirected here on successful payment |
| `PAYFAST_CANCEL_URL` | yes | — | Buyer redirected here on cancel |
| `PAYFAST_NOTIFY_URL` | yes | — | PayFast posts ITN here. Already wired in `CheckoutService`. |
| `PAYFAST_API_VERSION` | no | `v1` | PayFast REST API version header |
| `PAYFAST_NOTIFY_HOSTS` | no | the four canonical hosts | Comma-separated allowlist hostnames |
| `PAYFAST_SKIP_IP_CHECK` | no | `false` | Dev-only bypass. Refused at boot if `NODE_ENV=production`. |
| `TRUST_PROXY` | no | `1` | Express trust-proxy hop count for `req.ip` |

**Sandbox creds for development:** PayFast's public sandbox accepts `merchant_id=10000100`, `merchant_key=46f0cd694581a`, `passphrase=jt7NOE43FZPn`. Useful for local + CI; production uses real merchant credentials.

---

## Phase Breakdown

Six phases. Each ships independently with tests passing. Phases 1–2 are pure (no PayFast contact). Phases 3–5 require sandbox credentials. Phase 5 has a sandbox limitation (refunds are live-only).

### Phase 1 — Foundation

**Scope:**
- Prisma migration `add_payments_module_foundation`: `PaymentEvent` model, `ItnTxType` enum, `RECONCILE_REQUIRED` value on `PaymentStatus`
- Module scaffolding: `src/payments/` directory tree with empty service classes
- `PaymentsModule` registered in `AppModule`
- `payfast-config.ts` with env validation at boot
- `payfast-types.ts` with PayFast → Prisma status mapping
- No behavior change yet — `PAYMENT_SERVICE` still bound to `PaymentStubService`

**Tests:**
- Config service tests: missing env var fails boot
- Status mapping tests: `COMPLETE → COMPLETED`, `FAILED → FAILED`, etc.

**Definition of done:** migration applies cleanly, `npm run start:dev` boots with sandbox env, no behavior changes for buyers/merchants.

### Phase 2 — Signature primitives

**Scope:**
- `phpUrlencode()` helper in `payfast/url-encode.ts`
- `PayfastSignatureService` with all four methods: `signFormPayload`, `signApiRequest`, `verifyItnSignature`, `buildPostbackBody`
- `field-order.ts` with the canonical fixed array
- Vector test fixtures from PayFast sandbox payloads

**Tests:**
- `url-encode.spec.ts`: helper output matches PHP's `urlencode()` for ASCII, UTF-8 (Müller), spaces, special chars
- `payfast-signature.service.spec.ts`: 
  - Form-flow signature on a known payload matches a known-good MD5
  - API-flow signature on a known request matches a known-good MD5
  - ITN signature verification accepts a real PayFast payload, rejects tampered ones
  - Postback body construction matches PHP SDK's output

**Definition of done:** ~30 unit tests pass. Pure functions, no external calls.

### Phase 3 — Real `initializePayment()` + frontend contract change

**Scope:**
- `PaymentsService implements IPaymentService` with `initializePayment()` only (refund stub)
- Updated `PaymentInitResponse` shape: `{ paymentGroupId, mPaymentId, payfast: { actionUrl, fields } }`
- `CheckoutService.commit()` updated to surface the new shape (replaces `redirectUrl`)
- Swap `useClass: PaymentStubService` → `PaymentsService` in `order.module.ts`
- Existing `CheckoutService` tests updated for the new response shape

**Frontend coordination:** the frontend repo updates its checkout integration to consume `payfast.actionUrl + payfast.fields`, build a hidden form, and auto-submit. Coordinated cutover; no dual-shape transition.

**Tests:**
- `payments.service.spec.ts`: `initializePayment()` produces a valid signed payload for a sample order
- Integration check: `CheckoutService.commit()` returns the new shape end-to-end
- `CheckoutService` existing tests updated

**Definition of done:** real PayFast sandbox integration confirms signed redirect submission yields a PayFast checkout page.

### Phase 4 — ITN webhook

**Scope:**
- `PayfastIpAllowlistService` with boot-time DNS resolve + 1h refresh + fail-closed
- `app.set('trust proxy', 1)` in `main.ts` driven by `TRUST_PROXY` env var
- `PaymentsController.notify()` (`@Public`, `@HttpCode(200)`)
- `PaymentsNotifyService` implementing the full four-step + state machine + side effects
- `PayfastClient.verifyItnPostback()` for the postback step

**Tests** (covering the response policy table):
- Replay (same `itnHash`) → 200, no double-apply
- PENDING → COMPLETED progression → orders go CONFIRMED
- COMPLETED → COMPLETED (different `itnHash`) → second logged as no-op
- Out-of-order: COMPLETED first, PENDING second → second logged as illegal transition
- Concurrent COMPLETED × 2 → CAS guard keeps state consistent
- Bad signature → 400
- Bad source IP → 400
- Postback non-VALID → 400
- Amount mismatch → 400 + critical log
- Unknown `m_payment_id` (sig valid) → 200 + critical alert
- CANCELLED-stays-CANCELLED → status becomes RECONCILE_REQUIRED, orders untouched
- Partial refund → COMPLETED → PARTIALLY_REFUNDED, refundedAmountInCents accumulates
- Refund completing total → REFUNDED
- IPv6-mapped source IP normalization
- Dev bypass env var

**Definition of done:** sandbox checkout end-to-end works: form submit → PayFast page → return → ITN delivered → order CONFIRMED.

### Phase 5 — Refund API

**Scope:**
- `IPaymentService.refundPayment()` added to contract
- `PayfastClient.createRefund()` with API-flow signing
- `AdminOrdersService.requestRefund()` rewired to call through `PAYMENT_SERVICE`
- Refund-ITN handling in `PaymentsNotifyService` (transitions COMPLETED → PARTIALLY_REFUNDED / REFUNDED, accumulates `Payment.refundedAmountInCents`)
- Sandbox limitation documented: refunds are live-only

**Tests:**
- `payfast-client.service.spec.ts`: refund request payload + headers + signature match expected
- `payments.service.spec.ts`: `refundPayment()` propagates errors correctly
- `admin-orders.service.spec.ts` updated: refund flow now invokes the contract
- `payments-notify.service.spec.ts`: refund ITN paths

**End-to-end refund testing is deferred** — sandbox does not support refunds. Production smoke test on first real refund.

**Definition of done:** signature/payload fixtures verified against known-good values; admin refund endpoint returns success path through the new flow.

### Phase 6 — Reconciliation tooling + documentation

**Scope:**
- `GET /admin/payments/groups/:id/reconcile` (admin-only, read-only)
- `PayfastClient.fetchTransactionHistory()` with date-range pagination
- `PaymentsReconcileService` orchestrates lookup + comparison + verdict
- Cleanup-cron summary log line in `OrderCleanupService`
- This foundation doc finalized, `STATUS.md` updated, `CLAUDE.md` updated for Payments module status

**Tests:**
- `payments-reconcile.service.spec.ts`: MATCH / MISMATCH / NOT_FOUND / MATCH_PENDING verdict logic
- Admin endpoint returns correct shape, requires admin role

**Definition of done:** ops can investigate any PaymentGroup via the admin endpoint; cleanup cron emits structured summary.

---

## Things Worth Flagging

### 1. Status name divergence: `COMPLETE` vs `COMPLETED`

PayFast's ITN sends `payment_status=COMPLETE` (no D). Our Prisma enum is `COMPLETED`. Mapping happens in `payfast-types.ts`. Anyone reading raw ITN logs sees `COMPLETE`; anyone reading our DB sees `COMPLETED`. Document in code comments to prevent confusion.

### 2. Refunds are live-only

PayFast's sandbox does not support the refund API; the SDK explicitly throws if `testMode === true`. We can verify request structure (headers, signature, payload) via fixture tests, but end-to-end refund flow is only testable in production with real merchant credentials. First refund in production warrants a manual smoke test.

### 3. Reconciliation gap is real

If PayFast's ITN delivery fails entirely (all 11 retries exhausted) and the buyer was charged, the local 30-min cron will cancel the order. Money is taken; no order exists. The `RECONCILE_REQUIRED` status is for ITN-arrives-late; it does NOT cover ITN-never-arrives. Mitigation for v1 is the manual admin tool. Phase 7 (deferred) adds an automated daily reconciliation pass.

### 4. The signature trap

PayFast uses two signature algorithms with different field-ordering rules (form flow = fixed order; API flow = alphabetical `ksort`). Mixing these silently breaks integration. `PayfastSignatureService` exposes them as separate methods (`signFormPayload` vs `signApiRequest`); never share code paths between them.

### 5. Trust proxy on Railway

Railway's edge adds one proxy hop. `app.set('trust proxy', 1)` is correct for current topology. If Cloudflare or another proxy is added in front, `TRUST_PROXY` env var can be raised without a code deploy. **Verify in staging by curl-hitting `/payments/notify` and logging `req.ip`** — should be the curl machine's public IP, not a Railway internal address.

### 6. PaymentEvent grows unbounded

No retention policy in v1. ~1–3 rows per checkout. At scale (10k checkouts/day), ~1M rows/year. Fine for Postgres but worth revisiting if storage becomes an issue. Compliance may argue for permanent retention; defer the decision.

### 7. Frontend contract break is one-shot

The new `payfast.actionUrl + payfast.fields` shape replaces `redirectUrl` in the checkout response. Frontend has not shipped a real PayFast integration, so no production breakage — but coordinate the cutover carefully. Phase 3 cannot ship to staging until the frontend repo has the consumer change ready.

### 8. The `phpUrlencode()` helper is load-bearing

A single-byte mismatch between our encoding and PHP's `urlencode()` causes silent signature failures in production. Vector tests against known PayFast sandbox payloads are non-negotiable. Any change to `url-encode.ts` requires re-running the full vector suite.

### 9. ITN cannot use DTOs

The notify endpoint accepts `@Req() req` directly, not `@Body() dto: SomeDto`. PayFast may add new fields without notice; `forbidNonWhitelisted` would reject legitimate ITNs. Validate inside the service (presence checks on required fields), not via the global pipe.

### 10. Refund ITN is a separate event type

When a refund completes, PayFast sends an ITN with `transaction_type=refund` (or similar field — verify on first refund). This is a distinct PaymentEvent (`transactionType: REFUND`), not an update to the original payment event. Multiple partial refunds → multiple events, all on the same `pfPaymentId`. The `itnHash` differs because the payload differs (different `amount`, timestamps, refund IDs).

---

## Phase Decisions Log

> Per-phase decisions and trade-offs are recorded here as each phase ships. This section grows over time.

(No phases shipped yet. First entry expected after Phase 1 lands.)
