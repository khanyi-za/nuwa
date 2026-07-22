# Paystack Migration — Foundation

> Status: **DECIDED, NOT STARTED.** Owner call 2026-07-17 (production phase,
> day one): replace PayFast with Paystack for the live platform. This doc
> captures the research (verified 2026-07-17), what survives from the PayFast
> build, the contract revision, the phase plan, and the open questions —
> so the build can start cold from here.
>
> Companion: `payments-module-foundation.md` (the PayFast build this replaces —
> its architecture largely survives; its wire-format machinery does not).

## §1 Why Paystack (decision record)

Evaluated 2026-07-17 against PayFast (incumbent) and Stitch (stitch.money).

**vs PayFast:**
1. **Cost.** Local cards 2.9% + R1 vs ~3.5% + R2; EFT 2% flat (Ozow/Capitec
   Pay) vs 2% min R2; **free automatic T+1 settlement** vs R8.70–R10 manual
   withdrawals. On a R500 basket: ~R15.50 vs ~R19.50 (~20% cheaper) before
   withdrawal fees. Gateway fees are YIIVA's largest cost line (commission: 5.5% at
   evaluation time; 2.5% since 2026-07-22) — this is margin.
2. **Developer surface.** PayFast required three signature algorithms, a
   PHP-urlencode byte-matcher, insertion-order ITN verification, a DNS-resolved
   IP allowlist, and refunds that are UNTESTABLE in sandbox (the refund-ITN
   field detection shipped as an unverified heuristic). Paystack: Bearer-key
   REST, no outbound signing at all, one HMAC-SHA512 webhook check, and a real
   refunds API that works in South Africa with status webhooks.
3. **Reliability posture.** Stripe-owned, multi-country volume, well-regarded
   webhook reliability. PayFast's documented merchant-experience pattern
   (account flags on growth, withdrawal holds) is specifically bad for a
   marketplace-shaped money flow.
4. **The marketplace ace — split payments.** Paystack subaccounts + multi-split
   settle each merchant's share DIRECTLY to their bank account per transaction.
   YIIVA never holds merchant money: lighter compliance posture, T+1 automatic
   merchant payouts (an onboarding selling point), and the entire unbuilt
   Payout subsystem (payout records, disbursement runs) potentially collapses
   into configuration.

**vs Stitch:** deepest SA method coverage (incl. BNPL) and best-in-class
payouts, but: enterprise/negotiated access (YIIVA has no launch volume),
GraphQL + scoped-client-token ceremony, and — decisive — **no split-settlement
primitive**: their marketplace model is aggregate-then-disburse, which makes
YIIVA the fund-holder (build the payout ledger + TPPP-adjacent compliance).
**Re-evaluation trigger (§11).**

**Method coverage note:** Paystack SA = cards (Visa/MC/Amex), Ozow EFT,
Capitec Pay, SnapScan, Apple Pay. PayFast's longer tail (Mobicred, store
cards) and Stitch's BNPL are the trade-away; acceptable at launch.

## §2 Verified facts (2026-07-17, sources §12)

| Fact | Detail |
|---|---|
| SA pricing | 2.9% + R1 local cards; 2% EFT (Ozow, Capitec Pay); no monthly/setup; free T+1 settlement to SA bank |
| Init flow | `POST /transaction/initialize` → `{ authorization_url, reference }`; buyer redirected (plain GET); WE may supply our own `reference` (maps 1:1 to `mPaymentId`'s role) |
| Webhook | `x-paystack-signature` = HMAC-SHA512 of RAW body with secret key. nuwa already captures `req.rawBody` (main.ts). Events incl. `charge.success`, refund lifecycle events |
| Refunds | `POST /refund` (full; partial via `amount`), available in SA; statuses pending → processing → processed via webhook; buyer funds in ≤10 business days |
| Splits | Subaccounts (merchant bank accounts) + transaction splits (percentage or FLAT amounts, per-transaction dynamic, multi-subaccount via split groups). First payout to a new subaccount held for one-time verification |
| SDK | Official Node SDK stale (v1.0.1) — hand-roll a typed `PaystackClient` like `PayfastClient` |

## §3 What survives, what dies

**Survives unchanged (provider-agnostic architecture):**
- Schema: `PaymentGroup`, `Payment` (commission math, `merchantPayoutInCents`,
  `refundedAmountInCents`), `PaymentEvent` (audit + idempotency primitive)
- The webhook processing DISCIPLINE: validate → look up group → amount match →
  INSERT PaymentEvent (unique hash = replay shield) → CAS state transition →
  ack. Including **CANCELLED-stays-CANCELLED → RECONCILE_REQUIRED**
- Checkout TX discipline: TX1 (orders) → HTTP (init) → TX2 (clear cart) / TX3
  (rollback); no HTTP inside DB transactions
- Post-payment side-effect hooks: shipment booking + notifications fire on the
  same Order → CONFIRMED transition, outside the TX
- The `PAYMENT_SERVICE` token / `IPaymentService` consumer seam

**Dies (PayFast wire-format machinery — delete at cleanup):**
- `payfast-signature.service.ts` (all three algorithms), `url-encode.ts`
  (phpUrlencode), `field-order.ts`, `payfast-ip-allowlist.service.ts` (+ its
  boot DNS resolution), postback verification, `PAYFAST_SKIP_IP_CHECK`
- The form-flow `{ actionUrl, fields }` response shape (maya auto-submit form)

**Changes deliberately:**
- Contract v3 (§4), webhook controller (§5), maya payment screen (§7),
  small schema deltas (§6)

## §4 Contract v3 (`payment-contract.ts`)

v2 leaked PayFast vocabulary (`actionUrl+fields` form flow, `pfPaymentId`,
`accType`). v3 goes provider-neutral:

```ts
export interface PaymentInitRequest {
  orderIds: string[];
  /** OUR payment reference (was mPaymentId) — persisted on PaymentGroup. */
  reference: string;
  totalAmountInCents: number;
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  buyerCellNumber?: string;
  itemName: string;
  itemDescription?: string;
  returnUrl?: string;   // Paystack callback_url
  cancelUrl?: string;   // client-side (WebView intercept); Paystack has no cancel_url
}

export interface PaymentInitResponse {
  redirect: {
    url: string;                    // Paystack authorization_url
    method: 'GET' | 'POST';         // Paystack GET; PayFast legacy was POST
    fields?: Record<string, string>; // only for POST-form providers
  };
  /** Provider's own id for the init, when returned (Paystack access_code). */
  providerRef?: string;
}

export interface RefundRequest {
  /** Provider transaction id/reference of the ORIGINAL payment. */
  providerPaymentId: string;
  amountInCents: number;
  reason: string;
  // accType REMOVED — PayFast-only concept
}
```

Consumers touched: `CheckoutService.commit` response serializer (web +
`/api/orders` mobile), `AdminOrdersService.requestRefund` (drop accType from
DTO → **frontend handoff**: athena's refund form loses the account-type
field), maya payment screen (§7). Everything else compiles untouched.

## §5 Webhook pipeline (`POST /payments/webhook`)

Mirrors the ITN pipeline shape; simpler at every step:

1. **Verify**: HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY) ==
   `x-paystack-signature` (constant-time compare). No IP allowlist needed for
   v1 (signature is cryptographically sufficient; PayFast needed the allowlist
   because ITN signatures used a shared passphrase + postback dance).
2. **Parse event**: `charge.success` → payment completed; refund events
   (`refund.processed` / `refund.failed` / pending variants) → confirmation
   updates only (refund state is already accumulated synchronously at
   `POST /refund` time, same as PayFast design).
3. **Look up PaymentGroup** by `data.reference` (our reference).
4. **Amount match** `data.amount` vs `amountGrossInCents` (both integer
   subunits — ZAR cents; NO Rand→cents conversion bug surface, unlike PayFast's
   decimal-Rand strings).
5. **INSERT PaymentEvent** — idempotency hash = SHA-256 of rawBody (rename
   `itnHash` semantics; column stays). Replays → unique violation → ack 200.
6. **CAS transition** PaymentGroup PENDING → COMPLETED (`updateMany` guard),
   children Orders → CONFIRMED **with `confirmedAt`** (regression from
   the PayFast build — keep the fix), CANCELLED-stays-CANCELLED →
   RECONCILE_REQUIRED.
7. Ack 200 always (Paystack retries non-200s — we want replays to hit the
   idempotency shield, not accumulate).

Also: `GET /transaction/verify/:reference` exists — use it in the
reconciliation tool (replaces PayFast transaction-history fetch) AND as a
belt-and-braces check on buyer return (maya polls order status anyway;
optional).

## §6 Schema deltas (small, additive/rename)

- `PaymentGroup.mPaymentId` → semantic reuse as the Paystack `reference`
  (column rename to `providerReference` optional; defer — code can map).
- `PaymentGroup.pfPaymentId` → holds Paystack transaction id (rename to
  `providerPaymentId` in the same optional migration).
- `PaymentEvent.itnHash` → semantics become "webhook payload hash" (rename
  optional). `transactionType PAYMENT | REFUND` unchanged.
- NEW (Phase 6): `Store.paystackSubaccountCode String? @unique` + merchant
  bank-detail fields (or a `MerchantPayoutAccount` model) — splits only.

Rule: no destructive migration until PayFast code is deleted (§9 Phase 5).

## §7 maya changes

- `app/payfast.tsx` → `app/payment.tsx` (or reuse file): WebView does a plain
  **GET** of `redirect.url` — the hidden-form auto-submit HTML dies.
- Keep the **https-sentinel return URL + `onShouldStartLoadWithRequest`
  intercept** pattern unchanged (hard-won 2026-06-22 lesson: custom schemes
  400 at the gateway; Paystack `callback_url` gets the same sentinel).
- Cancel: Paystack has no cancel_url — the hosted page's close/back is
  intercepted the same way (sentinel or WebView back handling). Order stays
  PENDING → existing 30-min cron cancels (SYSTEM:PAYMENT_TIMEOUT) — unchanged.
- api-client types: checkout commit response `payfast:{actionUrl,fields}` →
  `payment:{redirect}` shape (coordinate with contract v3).

## §8 Splits design (Phase 6 — post-launch acceptable)

- One **subaccount per merchant store** (bank details collected at merchant
  onboarding; first-payout verification delay is one-time — set expectations).
- Per checkout: **dynamic multi-split with FLAT amounts** — each child
  Payment's `merchantPayoutInCents` to that store's subaccount; remainder
  (commission + ALL shipping) stays on the main YIIVA account. Flat, not
  percentage: our commission is on subtotal only, shipping is YIIVA's — a
  percentage split can't express that.
- **Refund bearing (PS-3)**: default Paystack behavior refunds from the main
  account — decide clawback policy vs merchant balance before enabling splits.
- Until Phase 6 ships, launch runs aggregate-style exactly like PayFast today
  (payouts manual/off-platform) — splits are an upgrade, not a blocker.

## §9 Phase plan

| Phase | Scope | Notes |
|---|---|---|
| 1 | Foundation: `PaystackConfig` (env fail-fast, test/live keys), `PaystackClient` (typed REST: initialize, verify, refund), module scaffold | Mirrors payfast Phase 1–2 minus ALL signature machinery |
| 2 | Contract v3 + `PaystackService.initializePayment` + checkout serializers + athena refund-DTO trim + maya payment screen | The only cross-repo phase |
| 3 | Webhook: controller + `PaystackWebhookService` pipeline (§5) + reconcile tool on `/transaction/verify` | PaymentEvent/CAS reuse |
| 4 | Refunds: `refundPayment` + refund-event confirmation handling | Verify test-mode refund behavior FIRST (PS-1) |
| 5 | Cutover + cleanup: rebind `PAYMENT_SERVICE`, delete PayFast module + env vars + docs note; optional column renames | Keep PayFast code until after first live Paystack transaction |
| 6 | Splits: subaccounts, onboarding capture, dynamic multi-split, refund clawback policy | CORE BUILT 2026-07-22 (schema, payout-account endpoints, flat multi-split at checkout, all-proportional bearer, graceful degradation). Remaining: athena payout-account UI, live split smoke |

Testing: unit specs per service (existing house pattern); end-to-end smoke =
ngrok + Paystack **test mode** (real webhook delivery works in test mode —
already better than PayFast, where sandbox refunds were impossible); first
LIVE transaction checklist mirrors the PayFast production smoke section of
CLAUDE.md (rewrite that section at Phase 5).

## §10 Open questions

- **PS-1**: ✅ **ANSWERED YES (2026-07-21).** Test mode supports the full
  refund lifecycle: programmatic test charge via POST /charge with the test
  card (charge 6378181111, R500) → POST /refund accepted (refund 17731581,
  status=pending, confirmed via GET /refund/:id). PayFast could never do
  this in sandbox. **Webhook sub-question also ANSWERED (2026-07-21 smoke):**
  charge.success AND refund.pending events delivered to the tunneled test
  webhook with valid signatures — the full pipeline (delivery → HMAC verify →
  route → unknown-reference ack) verified against real Paystack traffic.
- **PS-2**: International card pricing + whether to enable international
  cards at launch (fraud posture).
- **PS-3**: Refund bearing under splits — **v1 policy (2026-07-22): refunds
  pull from the MAIN balance (Paystack default); clawback from the merchant
  is a MANUAL ops process** (net off a future payout or invoice). Automate
  (negative-balance ledger) only if refund volume warrants it.
- **PS-4**: Merchant bank-detail capture UX (athena onboarding step vs
  admin-entered) + storage (new model vs Store fields) — Phase 6.
- **PS-5**: Optional column renames (mPaymentId/pfPaymentId/itnHash →
  provider-neutral) — do them at Phase 5 or live with mapped semantics?
- **PS-6**: Does Paystack publish webhook source IPs worth allowlisting as
  defense-in-depth, or is HMAC-only the norm? (Signature alone is acceptable
  for v1 either way.)
- **PS-7**: ✅ ANSWERED — `charge.success` carries `fees`; recorded into
  `PaymentGroup.amountFeeInCents` / `amountNetInCents` (Phase 3).
- **PS-8** (NEW, raised by the 2026-07-22 commission drop 5.5% → 2.5%):
  **fee bearing on splits.** Card fees (~2.9% + R1 + VAT ≈ 3.35%) now EXCEED
  the 2.5% commission — if YIIVA bears the full processing fee, every card
  sale is margin-negative. Paystack split `bearer_type` options:
  `account` (YIIVA bears all), `subaccount`, `all-proportional` (each party
  bears fees on their share), `all`. ✅ **DECIDED 2026-07-22:
  `all-proportional`** — merchants pay processing on their 97.5% share
  (market standard); YIIVA's share stays margin-positive. EFT (2%) remains
  commission-positive either way. Implemented in
  `PaystackService.createSplitIfRequested`.

## §11 Stitch re-evaluation trigger

Revisit Stitch (stitch.money) when ANY of: (a) monthly volume supports an
enterprise pricing conversation; (b) BNPL becomes a conversion priority
(Stitch has native 2–6 instalment BNPL); (c) instant/24-7 merchant payouts
become a competitive requirement beyond Paystack's T+1. Migration cost is
bounded by the same `PAYMENT_SERVICE` seam — contract v3 (§4) is already
provider-neutral; Stitch specifics: GraphQL + client tokens, HMAC-SHA256
timestamped webhooks, aggregate-then-disburse money flow (payout ledger +
compliance question MUST be answered before choosing it).

## §12 Sources (retrieved 2026-07-17)

- https://paystack.com/za/pricing (via qwabi.co.za/blog/paystack-fees-south-africa-2026)
- https://cjxstudio.co.za/payfast (PayFast fees)
- https://rebill.co.za/blog/paystack-vs-yoco-vs-payfast-south-africa/
- https://yoros.co.za/blog/paystack-payfast-stripe-south-africa-comparison
- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/payments/refunds/ + https://support.paystack.com/en/articles/2127106
- https://paystack.com/docs/payments/split-payments/ + /docs/payments/multi-split-payments/ + https://support.paystack.com/en/articles/2132802
- https://paystack.com/docs/payments/payment-channels/
- https://www.npmjs.com/package/@paystack/paystack-sdk (staleness)
- Stitch: https://stitch.money/ · /payment-methods · /payouts · https://docs.stitch.money/payment-products/payins/paybybank/integration-process · https://docs.stitch.money/webhooks/using_webhooks · BNPL: dailymaverick.co.za 2026-05-06 · raise: pymnts.com 2025 ($55M)
