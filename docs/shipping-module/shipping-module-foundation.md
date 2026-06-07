# YIIVA — Shipping Module: Foundation

> Locked product decisions, schema, architectural patterns, and phase plan for the Shipping module. Companion to [`order-module-foundation.md`](../order-module/order-module-foundation.md) and [`payments-module-foundation.md`](../payments-module/payments-module-foundation.md).

---

## Table of Contents

1. [Context](#1-context)
2. [Provider decision — TCG / ShipLogic](#2-provider-decision--tcg--shiplogic)
3. [Locked decisions](#3-locked-decisions)
4. [Schema — already in place](#4-schema--already-in-place)
5. [Schema — deltas to apply](#5-schema--deltas-to-apply)
6. [Cross-module dependencies](#6-cross-module-dependencies)
7. [Module scaffold](#7-module-scaffold)
8. [Environment variables](#8-environment-variables)
9. [ShipLogic API surface (what we'll actually call)](#9-shiplogic-api-surface-what-well-actually-call)
10. [Address shape mapping](#10-address-shape-mapping)
11. [Status mapping — ShipLogic → YIIVA `OrderStatus`](#11-status-mapping--shiplogic--yiiva-orderstatus)
12. [Webhook design](#12-webhook-design)
13. [Empirical findings — sandbox test on 2026-06-03](#13-empirical-findings--sandbox-test-on-2026-06-03)
14. [Open questions for TCG support](#14-open-questions-for-tcg-support)
15. [Phase plan](#15-phase-plan)
16. [Failure modes and operational concerns](#16-failure-modes-and-operational-concerns)
17. [Reversibility — the Bob Go off-ramp](#17-reversibility--the-bob-go-off-ramp)

---

## 1. Context

The Shipping module is the **third** of three tightly-related modules. Build order was originally **Orders → Shipping → Payments-and-Payouts**, but Payments was built ahead of Shipping because PayFast was unblocking testing. Shipping is now the last commerce-critical module before YIIVA can fulfil real orders.

**Why it matters for v1.** The mobile buyer app (Phase 2 onward in `Api-mobileapp-contracts/`) is built. PayFast checkout is built. Orders flow end-to-end except for the bit where YIIVA actually moves goods. The Shipping module replaces today's `ShippingStubService` (flat R110, deterministic) with real per-cart rate quotes, waybill creation on order confirmation, and tracking-driven status transitions.

**What's already in place.** `IShippingService` contract + `SHIPPING_SERVICE` injection token, full schema for dispatch addresses + per-Order shipping fields, `Product.weightInGrams`. The existing `ShippingStubService` is bound to the token; replacing it with the real implementation is one line in `OrderModule`.

This document captures the decisions, schema, and phase plan up-front. Implementation details for each phase live in per-phase docs after code ships.

---

## 2. Provider decision — TCG / ShipLogic

After comparing TCG/ShipLogic, Aramex SA, and Bob Go (the aggregator alternative), **TCG via the ShipLogic API is the v1 choice.**

Summary of reasoning:

| Dimension | Decision |
|---|---|
| API style | ShipLogic REST + JSON, Bearer-token auth — cleanest of the options |
| Sandbox | Free self-signup at `sandbox.shiplogic.com`; **no business-account gate** |
| Coverage | TCG dominates SA last-mile (170 kiosks, 22 depots, 1100 PUDO lockers) |
| Reputation | Hellopeter 3.0 / 5; 75% of SA businesses rank TCG in their top-3 (2025) |
| Direct vs aggregator | Direct TCG for v1. Bob Go remains a Phase 2 swap if TCG underdelivers — see [§17](#17-reversibility--the-bob-go-off-ramp). |

Rejected:
- **Aramex SA** — SOAP API, ClientInfo block in every call, gated sandbox, 1.7 / 5 Hellopeter.
- **Bob Go aggregator** — strong fit long-term, but adds middleman + new vendor relationship at the launch moment; reversibility argument favours direct TCG now.

---

## 3. Locked decisions

Extending Q11–Q15 from `order-module-foundation.md` §Shipping with the additional questions surfaced while scoping this module.

### Carry-over from order foundation (unchanged)

| # | Question | Decision |
|---|---|---|
| Q11 | ShipLogic env? | **Sandbox/test keys for dev** (free self-signup at `sandbox.shiplogic.com`). Production keys after TCG business account is set up. |
| Q12 | Origin address? | **`StoreDispatchAddress` model** (already in schema). Each merchant sets one primary; can have multiple for multi-location brands. |
| Q13 | Rate caching? | **Locked at order creation.** Stored on `Order.shippingInCents` + `shippingQuoteId`. YIIVA absorbs any delta if re-quote at dispatch differs. |
| Q14 | Service tier? | **Default `ECO`.** Buyer can upgrade to LOF/LOX at checkout in a future iteration. Merchant default in dashboard not in v1. |
| Q15 | Tracking? | **Webhook push** preferred. ShipLogic configured with our notify URL. Polling fallback if webhooks prove unreliable. |

### New v1 decisions

| # | Question | Decision |
|---|---|---|
| Q16 | What if a product has no `weightInGrams`? | **Default 500g per unit (0.5kg).** Documented in code; surfaced to merchants in a future onboarding nudge ("add weights to your products for accurate shipping"). |
| Q17 | What about parcel dimensions? | **Per-product dimensions exist in the schema** (`Product.lengthCm/widthCm/heightCm`), but most products won't have them populated at launch. **When any dimension is null**, fall back to a fixed package size of **20×20×10 cm** for the whole parcel. ShipLogic re-dimensions at the hub if wrong (and may fire a `Parcel dimension changes` webhook — we ignore in v1). |
| Q18 | One quote per cart, or one per store? | **One per store group.** Code today fires a single `getRate({ dispatchAddressId: '' })` — broken. Fix in Phase 3: iterate over store groups, fire one rate request per group, sum into PaymentGroup.shippingInCents. |
| Q19 | When do we create the shipment with ShipLogic? | **On `Order.CONFIRMED` transition** (i.e., when the PayFast ITN flips PaymentGroup → COMPLETED → Order → CONFIRMED). Not at checkout — we don't want to book parcels for orders that fail payment. |
| Q20 | What happens if shipment creation fails post-payment? | **Order stays CONFIRMED, flagged for ops review.** Set `Order.shippingQuoteId = null` and log to a dedicated `shipment_creation_failures` table (Phase 5 schema delta). Don't block the buyer. |
| Q21 | Buyer-cancel timing? | **Buyer can cancel until the parcel is `collected` ShipLogic-side.** Beyond that, buyer is told to contact support (matches existing `buyer-orders` cancel rule — `BUYER_CANCELLABLE_STATES = [PENDING, CONFIRMED]`). |
| Q22 | Account model — who pays ShipLogic? | **YIIVA holds one ShipLogic account.** All shipping bills go to YIIVA. YIIVA recoups shipping cost from each merchant by subtracting it from their payout (Order-level `Payment.merchantPayoutInCents` already supports this — just needs the shipping line item plumbed through). |
| Q23 | Declared value? | **Use `Order.subtotalInCents` converted to rand.** Sets insurance reasonably; YIIVA isn't liable for parcels above this. |
| Q24 | Webhook authentication? | **TBD pending TCG support answer.** See [§14](#14-open-questions-for-tcg-support). Default v1 stance: IP allowlist + path-embedded secret (`POST /shipping/webhook/<random>`) until signing is confirmed. |
| Q25 | What about returns? | **Out of v1 scope.** ShipLogic supports returns (`POST /shipments` with `is_return: true`); we won't expose this surface to buyers in v1. Manual ops process for the rare return until volume justifies it. |
| Q26 | PUDO locker support? | **Out of v1 scope.** Buyer delivery to a fixed address only. PUDO and pickup points become a v2 conversation when buyer demand surfaces. |

---

## 4. Schema — already in place

More of the shipping schema already exists than I'd assumed when I first drafted this doc. Reading `prisma/schema.prisma` end-to-end (Jun 2026) revealed:

### `Shipment` (line 947 — one per Order)
The canonical home for ShipLogic identifiers + lifecycle state.
- `shiplogicShipmentId @unique` — ShipLogic's numeric internal ID (e.g. `115738667`)
- `waybillNumber @unique` — populated from ShipLogic's `short_tracking_reference` (e.g. `"VD3GLQ"`). For TCG-issued shipments this is the same value as the printed waybill number; we use it as the webhook lookup key.
- `trackingUrl` — public buyer-facing tracking page
- `serviceType` — `"ECO"` / `"LOF"` / `"LOX"` / `"NFS"`
- `shiplogicStatus` — raw ShipLogic status string (pre-mapping)
- `status: ShipmentStatus` — our internal enum (PENDING / COLLECTED / IN_TRANSIT / OUT_FOR_DELIVERY / DELIVERED / FAILED_DELIVERY / RETURNED)
- `quoteId`, `rateInCents`, `rateExVatInCents` — rate audit
- `parcelCount`, `totalWeightInGrams`, `parcelDescription` — what we sent to ShipLogic
- `collectionDate`, `estimatedDelivery`, `collectedAt`, `deliveredAt`
- `podUrl`, `deliveryOtp` — proof-of-delivery
- `shiplogicPayload Json?` — raw API response audit
- One-to-one relation back to Order

### `ShipmentTrackingEvent` (line 1003 — many per Shipment)
Buyer-visible tracking history populated by the webhook processor AFTER dedupe via `ShipmentEvent`. Fields: `status, description, location, timestamp`. Read by the buyer's order-detail timeline.

### `ShipmentStatus` enum (line 101)
`PENDING, COLLECTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED_DELIVERY, RETURNED`

### `StoreDispatchAddress` (line 359)
Complete ShipLogic-compatible fields: `contactName`, `contactPhone`, `addressLine1/2`, `suburb`, `city`, `province`, `postalCode`, `country`, optional `latitude`/`longitude`, `isPrimary`. Already mapped to `Store.dispatchAddresses[]`. Missing only a controller (Phase 3 will add).

### Shipping fields on `Order` (line 749)
- `shippingInCents` — locked at order creation
- `shippingQuoteId` — ShipLogic quote reference (audit trail)
- `shippingServiceTier` — `"ECO"` / `"LOF"` / `"LOX"`
- `shippingDispatchAddressId` — FK to `StoreDispatchAddress`; preserved even if merchant later edits the source address (audit-trail rule)

### Product shipping fields (line 510)
- `weightInGrams Int?` — fallback to 500g per Q16
- `lengthCm Float?`, `widthCm Float?`, `heightCm Float?` — fallback to 20×20×10cm per Q17 when null

### `IShippingService` contract (`src/order/contracts/shipping-contract.ts`)
```ts
interface IShippingService {
  getRate(req: ShippingRateRequest): Promise<ShippingRateResponse>;
}
```
Today bound to `ShippingStubService` (flat R110). Will be re-bound to `ShippingService` in Phase 4.

---

## 5. Schema — deltas applied in Phase 2

Three additive changes, no destructive edits. Applied as `prisma/migrations/20260603155000_shipping_module_phase2/`.

### Delta 1 — `Address.suburb` (NEW)

Buyer addresses were missing the suburb component that merchant `StoreAddress` and `StoreDispatchAddress` already have.

```prisma
model Address {
  // ... existing fields ...
  suburb String? @db.VarChar(100) // SA address component — maps to ShipLogic `local_area`
}
```

DTOs updated: `CreateAddressDto` + `UpdateAddressDto` accept an optional `suburb` (max 100 chars, trim). `AddressService.create` + `update` plumb it through to Prisma.

### Delta 2 — Comment clarification on `Shipment.waybillNumber`

The existing field IS the webhook lookup key — we kept the field name + index, just added a clarifying comment explaining the mapping from ShipLogic's `short_tracking_reference`.

### Delta 3 — NEW `ShipmentEvent` table (+ `ShipmentEventType` enum)

Mirrors `PaymentEvent` from the payments module. Audit log of every webhook received from ShipLogic, with `payloadHash @unique` as the idempotency primitive.

```prisma
model ShipmentEvent {
  id            String            @id @default(cuid())
  shipmentId    String?           // FK; nullable for orphaned webhooks
  waybillNumber String            // from payload — used to look up Shipment when shipmentId is null
  payloadHash   String            @unique  // sha256(canonicalize(payload)) — dedupe key
  eventType     ShipmentEventType
  rawStatus     String?           // raw ShipLogic status (debugging)
  payload       Json
  sourceIp      String?

  receivedAt   DateTime @default(now())
  processed    Boolean  @default(false)
  processError String?

  shipment Shipment? @relation(fields: [shipmentId], references: [id], onDelete: SetNull)

  @@index([shipmentId, receivedAt])
  @@index([waybillNumber])
  @@map("shipment_events")
}

enum ShipmentEventType {
  TRACKING_EVENT
  SHIPMENT_NOTE
  ADDRESS_CHANGE
  DIMENSION_CHANGE
}
```

Phase 6 webhook handler writes to this table first (idempotency check), then conditionally projects the subset of buyer-relevant events (`TRACKING_EVENT` only) onto the existing `ShipmentTrackingEvent` table for the order-detail timeline.

### What we deliberately did NOT do

The original (incorrect) draft of this doc proposed adding shipment-lifecycle fields directly to `Order`. That data already has a home — the existing `Shipment` row attached to `Order`. We use what's there instead of duplicating it.

---

## 6. Cross-module dependencies

```
                       ┌────────────────────┐
                       │  ShippingModule    │
                       └────────────────────┘
                              │       ▲
                              ▼       │
       OrderModule ────────► │ │     │ (webhook handler updates Order.status,
       (via IShipping        │ │     │  ShipmentEvent rows)
        contract)            │ │     │
                       ┌─────┴─┴─────┴────┐
                       │   ShipLogic API  │  (external HTTPS, Bearer auth)
                       └──────────────────┘
                              ▲
                              │ webhooks
                       ┌──────┴──────────┐
                       │ Public webhook  │
                       │ POST /shipping/ │
                       │ webhook/...     │
                       └─────────────────┘
```

- **OrderModule → ShippingModule** is via the `SHIPPING_SERVICE` injection token. Order code consumes the `IShippingService` interface; the binding moves from `ShippingStubService` → `ShipLogicService` in one line of `OrderModule`.
- **ShippingModule → OrderModule (write-back)** happens in the webhook handler. The handler matches webhooks to orders by `trackingReference`, writes `ShipmentEvent` rows, and updates `Order.shipmentLastEventStatus` + `Order.status` per the mapping table in [§11](#11-status-mapping--shiplogic--yiiva-orderstatus). It imports `OrderService` directly — no contract token needed (Shipping is a leaf module, doesn't have a stub).
- **ShippingModule → StoreModule** for dispatch-address CRUD authz (`canManageStore`).
- **No circular dependency.** Order uses contract, Shipping uses concrete `OrderService`. Same pattern as Payments.

---

## 7. Module scaffold

```
src/shipping/
  shipping.module.ts
  shipping.service.ts                — implements IShippingService.getRate
  shipping-shipments.service.ts      — creates + cancels shipments, fetches labels
  shipping-webhook.controller.ts     — POST /shipping/webhook/:secret (public)
  shipping-webhook.service.ts        — payload validation, idempotency, status apply
  shipping-status-map.ts             — pure function: ShipLogic status → YIIVA OrderStatus

  dispatch-address/
    dispatch-address.controller.ts   — merchant CRUD on /stores/:storeId/dispatch-addresses
    dispatch-address.service.ts
    dto/
      create-dispatch-address.dto.ts
      update-dispatch-address.dto.ts

  shiplogic/
    shiplogic-config.ts              — boot-validated env vars (mirror PayfastConfig)
    shiplogic-client.service.ts      — thin HTTPS wrapper over api.shiplogic.com
    shiplogic-types.ts               — DTOs for ShipLogic request/response shapes
    shiplogic-address.ts             — pure address-shape mapping helpers

  dto/
    rate-quote.dto.ts                — internal DTO if exposed via a debugging endpoint
```

`shipping.module.ts`:

```ts
@Module({
  imports: [StoreModule],                       // for canManageStore on dispatch-address authz
  controllers: [DispatchAddressController, ShippingWebhookController],
  providers: [
    ShipLogicConfig,
    ShipLogicClientService,
    ShippingService,                            // implements IShippingService
    ShippingShipmentsService,
    ShippingWebhookService,
    DispatchAddressService,
    { provide: SHIPPING_SERVICE, useClass: ShippingService },
  ],
  exports: [SHIPPING_SERVICE, ShippingShipmentsService],
})
export class ShippingModule {}
```

OrderModule's existing binding to `ShippingStubService` gets removed; the new ShippingModule's `SHIPPING_SERVICE` export takes over.

---

## 8. Environment variables

Mirror the `PayfastConfig` pattern — boot-validated, fail-fast in production if missing.

```dotenv
# ============================================================================
# ShipLogic / The Courier Guy
# ============================================================================
# Sandbox vs production:
#   SHIPLOGIC_BASE_URL=https://api.shiplogic.com         (sandbox; free signup at sandbox.shiplogic.com)
#   SHIPLOGIC_BASE_URL=https://api.portal.thecourierguy.co.za  (production; requires TCG business account)
SHIPLOGIC_BASE_URL=""

# Bearer token from ShipLogic dashboard → Settings → API Keys.
# Sandbox key is fine for dev. Production needs a separately-generated production key.
SHIPLOGIC_API_KEY=""

# Default service level code for new shipments. ECO is cheapest; LOF/LOX/NFS are upgrades.
SHIPLOGIC_DEFAULT_SERVICE_LEVEL="ECO"

# Per-product weight fallback in grams (Q16). Applied when Product.weightInGrams is null.
SHIPPING_DEFAULT_WEIGHT_GRAMS="500"

# Fixed parcel dimensions in cm for v1 (Q17). All shipments use these.
SHIPPING_DEFAULT_LENGTH_CM="20"
SHIPPING_DEFAULT_WIDTH_CM="20"
SHIPPING_DEFAULT_HEIGHT_CM="10"

# Webhook path-embedded secret (TBD pending TCG support answer on signing — see Q24).
# Used as defence-in-depth alongside IP allowlist. Subscribe ShipLogic to
# POST {API_PUBLIC_BASE_URL}/shipping/webhook/{SHIPLOGIC_WEBHOOK_SECRET}
# Generated as a 32+ char random string. Rotate when needed.
SHIPLOGIC_WEBHOOK_SECRET=""

# Optional IP allowlist for incoming webhooks. Comma-separated. Empty means no IP gate.
# Populate once TCG confirms outbound IPs (Q24 — open).
SHIPLOGIC_WEBHOOK_IP_ALLOWLIST=""
```

`ShipLogicConfig` reads these at boot, throws on missing required values when `NODE_ENV=production`.

---

## 9. ShipLogic API surface (what we'll actually call)

From the ShipLogic Postman collection (`docs/thecourierguy/shiplogic.postman_collection.json`). Sandbox base URL `api.shiplogic.com`; auth header `Authorization: Bearer <key>`.

### Phase 3 — rate quotes only
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/rates` | Get a shipping quote between two addresses |

### Phase 5 — shipment creation + label
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/shipments` | Create a shipment (returns `id`, `tracking_reference`, parcel IDs) |
| `GET` | `/shipments?tracking_reference={ref}` | Fetch current state (polling fallback) |
| `GET` | `/shipments/label?id={id}` | Waybill PDF as binary |
| `POST` | `/shipments/cancel` | Cancel before collection |

### Phase 6 — tracking polish
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/tracking/shipments?tracking_reference={ref}` | Full tracking event log (used as recovery / polling fallback) |
| `GET` | `/shipments/pod?tracking_reference={ref}` | POD events (delivered, signed) |
| `GET` | `/shipments/pod/images?tracking_reference={ref}` | POD images (signature, photo) |

**Not used in v1:** opt-in rates, pickup-point shipments, billing endpoints, admin endpoints, returns. All available behind the same Bearer token if/when scope expands.

---

## 10. Address shape mapping

Our buyer `Address` and `StoreDispatchAddress` have different shapes from ShipLogic's address structure. Pure mapping helpers live in `src/shipping/shiplogic/shiplogic-address.ts`.

| YIIVA field | ShipLogic field | Notes |
|---|---|---|
| `addressLine1` + `addressLine2` | `street_address` | Concat with `, ` if line 2 is present |
| `suburb` (on `StoreDispatchAddress`, `StoreAddress`, **and now buyer `Address`** as of Phase 2) | `local_area` | Direct |
| `province` | `zone` | Direct |
| `city` | `city` | Direct |
| `postalCode` | `code` | Direct (4 digits) |
| `country: "South Africa"` | `country: "ZA"` | Map literal in code |
| `latitude` / `longitude` (on dispatch only) | `lat` / `lng` | Pass through when present; ShipLogic geocodes otherwise |
| (none) | `type` | Default `"business"` for dispatch, `"residential"` for delivery |
| `recipientName` (buyer) / `contactName` (merchant) | `delivery_contact.name` / `collection_contact.name` | Direct |
| `phone` (normalised `+27...`) | `delivery_contact.mobile_number` | Direct |

---

## 11. Status mapping — ShipLogic → YIIVA `OrderStatus`

ShipLogic has ~22 statuses; YIIVA's `OrderStatus` has 8 (plus `REFUND_*`). Mapping in `shipping-status-map.ts`:

| ShipLogic status | YIIVA `OrderStatus` | Notes |
|---|---|---|
| `submitted` | (no change) | Pre-collection bookkeeping |
| `collection-unassigned`, `collection-assigned` | (no change — stays `CONFIRMED` or `PROCESSING`) | Driver allocation, not a buyer-facing transition |
| `awaiting-dropoff` | (no change) | Locker / kiosk dropoff scenarios; out of v1 scope |
| `collected` | `DISPATCHED` | First real buyer-facing transition. Sets `Order.dispatchedAt`. |
| `at-hub`, `at-destination-hub`, `manifested`, `ready-for-dispatch`, `in-transit` | `IN_TRANSIT` | Multiple ShipLogic statuses → one YIIVA status |
| `out-for-delivery` | `IN_TRANSIT` | Same — UI can show this as a sub-state via `Order.shipmentLastEventStatus` if/when we want |
| `delivered` | `DELIVERED` | Sets `Order.deliveredAt` |
| `collection-rejected`, `collection-exception`, `collection-failed-attempt` | (no change — flag for ops) | Surface in admin tool; not auto-cancelled |
| `delivery-rejected`, `delivery-exception`, `delivery-failed-attempt` | (no change — flag for ops) | Same |
| `on-hold`, `on-hold-internal` | (no change — flag for ops) | |
| `returned-to-hub` | (no change — flag for ops) | Possibly heading back to merchant; manual triage |
| `ready-for-pickup` | (no change — locker scenarios; out of v1 scope) | |
| `cancelled` | `CANCELLED` (with `SYSTEM:SHIPPING_CANCELLED` reason prefix) | If buyer/merchant cancelled via API, the prefix becomes their reason instead |

**Rule of thumb:** if ShipLogic's status doesn't map to a YIIVA transition, **store the raw status on `Order.shipmentLastEventStatus`** so the admin tool can surface it without polluting the buyer-facing `Order.status`.

---

## 12. Webhook design

### Incoming endpoint

```
POST {API_PUBLIC_BASE_URL}/shipping/webhook/{SHIPLOGIC_WEBHOOK_SECRET}
```

- `@Public()` (no JWT)
- Defence-in-depth: path-embedded secret + IP allowlist (when populated)
- Logs every received payload to `ShipmentEvent` regardless of validity
- Returns `200` on success and on idempotency replays
- Returns `404` if path secret mismatches (deliberately not `403` — looks like a missing endpoint to scanners)

### Processing pipeline

```
1. Validate path secret (constant-time compare)
2. (Optional) Check source IP against allowlist
3. Compute SHA-256 of raw body → idempotency key
4. INSERT ShipmentEvent { payload, payloadHash, ... }
   - Unique constraint on payloadHash → replays fail INSERT, ack 200 no-op
5. Parse payload, extract tracking_reference
6. Look up Order by shipmentTrackingReference
   - If no match → ShipmentEvent stays orphaned, no Order update, log warning
7. Compute YIIVA OrderStatus per the mapping table (§11)
8. Update Order with CAS on previous status (avoid back-transitions)
9. Mark ShipmentEvent.processedAt = now()
```

Same shape as the PayFast ITN handler. Webhook is the boundary; everything inside is YIIVA's own domain.

### Outbound webhook subscription

Configured **once** in the ShipLogic dashboard (UI step, not API):
- URL: `https://api.yiiva.co.za/shipping/webhook/<SHIPLOGIC_WEBHOOK_SECRET>`
- Topics: `Tracking event`, `Shipment note`, `Shipment address changes`
- Skip `Parcel dimension changes` and admin webhooks (out of v1 scope)

Sandbox and production each get their own subscription with their own secret.

### Auth model — open question

See [§14](#14-open-questions-for-tcg-support). v1 design assumes no native signing and uses path-embedded secret + IP allowlist. When TCG confirms signing exists, we add a `verifySignature()` step between (1) and (3) in the pipeline above. The slot is reserved in code; flipping it on is a no-op for the rest of the pipeline.

---

## 13. Empirical findings — sandbox test on 2026-06-03

Documented for the record so we don't repeat the test unnecessarily.

**Setup:** webhook receiver on `127.0.0.1:8787`, ngrok forwarding `rigor-shredder-underfoot.ngrok-free.dev → 8787`, subscription configured in sandbox dashboard for "Tracking event".

**Triggers fired:**
1. `POST /shipments` — created shipment `115738667` / `VD3GLQ`. Returned `200`, status `collection-assigned`.
2. `PATCH /shipments` (admin) — to set status `collected`. Returned **`403 — You do not have permission to update a shipment`**. Sandbox role can't drive admin state transitions.
3. `POST /shipments/cancel` — cancelled shipment `VD3GLQ`. Returned `200`, status `cancelled`.
4. `POST /shipments` — created shipment `115738954` / `V4DPJG`. Returned `200`, status `collection-assigned`.

**Receiver log entries:** zero webhook deliveries. Only self-test requests captured.

**Sandbox dashboard:** no "deliveries" / "attempts" history visible against the subscription.

**Conclusion:** ShipLogic sandbox doesn't deliver webhooks for any of the events we triggered. Three possibilities — sandbox-doesn't-fire (most likely), subscription-not-active, or verification-handshake-needed. Cannot disambiguate without TCG support.

**Implication:** production webhook reliability + signing remain unverified. Build the webhook handler defensively (path-embedded secret + IP allowlist), reserve the signature-verification slot for when production confirms.

---

## 14. Open questions for TCG support

Call queued (resolution faster than email per ops preference). Questions, in priority order:

1. **Is webhook delivery enabled in the sandbox at all?** Created shipments + cancelled one on 2026-06-03 (IDs 115738667, 115738954); subscription configured for Tracking event; zero deliveries received over ~10 minutes.
2. **Are production webhooks signed?** If yes — HMAC algorithm, which header carries the signature, what's used as the secret (same API key, or a separate webhook secret)?
3. **What's included in the signature payload** — whole raw body, or canonical form?
4. **Source IP range / hostnames for outbound webhook calls** — for allowlist fallback.
5. **Retry behaviour** on non-2xx responses (cadence, max attempts).
6. **Timestamp / replay-protection header** if signing exists.

The webhook handler code will be written assuming "no signing" as the v1 default. When answers arrive, we wire the verifier in — minimal code change.

---

## 15. Phase plan

Six phases, each shippable independently. Mirrors the payments-module rhythm (phase 1 foundation + phases 2–6 progressively replacing the stub).

| Phase | Name | Status | Key deliverable |
|---|---|---|---|
| 1 | **Foundation** — module scaffold, env config, ShipLogicConfig boot validation, ShipLogicClient with `getJson`/`postJson` primitives | **Complete (2026-06-03)** | Module compiles + boots, no behaviour yet |
| 2 | **Schema deltas** — `Address.suburb`, `Shipment.waybillNumber` doc clarification, NEW `ShipmentEvent` table + `ShipmentEventType` enum, address DTOs + service plumbing | **Complete (2026-06-03)** | Migration `20260603155000_shipping_module_phase2` applied + Prisma client regenerated |
| 3 | **Dispatch addresses CRUD** — merchant endpoints for `StoreDispatchAddress` (list / create / update / delete / set-primary) | Pending | Merchant can configure shipping origin in the dashboard |
| 4 | **Real rate quotes** — `ShippingService.getRate()` implementing `IShippingService`; binding moves from stub to real; **per-store quotes** at checkout (fix the broken single-call) | Pending | `POST /checkout/quote` returns real ShipLogic rates per store |
| 5 | **Shipment creation** — on `Order.CONFIRMED` transition, create the ShipLogic shipment; expose label endpoint (admin/merchant download); buyer-cancel flow propagates to ShipLogic | Pending | Real parcels get booked when buyers pay |
| 6 | **Tracking webhook** — public endpoint, ShipmentEvent persistence, status mapping, `Order.status` transitions; polling fallback for missed/delayed events | Pending | Buyer's order detail in the mobile app shows live status |

Each phase ships as a single commit with its own spec coverage. Phase 4 is the smallest minimum-viable replacement of the stub — everything before is plumbing, everything after is layered.

---

## 16. Failure modes and operational concerns

### What can go wrong in checkout

| Failure | YIIVA behaviour |
|---|---|
| ShipLogic `POST /rates` returns 5xx or times out | Fall back to **a configured default-flat-rate per service tier** stored in env (`SHIPPING_RATE_FALLBACK_CENTS=11000`). Log to error tracker. Buyer never sees a "rates unavailable" error at checkout. |
| ShipLogic `POST /rates` returns 4xx (bad address) | Surface to buyer as a specific validation error: *"We couldn't quote shipping to that address. Check your postal code or contact support."* No fallback — bad input shouldn't be quoted-around. |
| ShipLogic returns a quote but checkout commit later fails | Rate locked on `Order.shippingInCents`; YIIVA absorbs delta if we re-quote (Q13). |

### What can go wrong post-payment

| Failure | YIIVA behaviour |
|---|---|
| ShipLogic `POST /shipments` (Phase 5) fails after Order is CONFIRMED | Order stays CONFIRMED; insert into `shipment_creation_failures` table with full context; alert ops via Slack / email. **Do not** roll back the Order — buyer paid; we owe them a fulfilment. |
| Shipment creation eventually succeeds (manual ops retry) | Phase 5 service exposes an internal `retryShipmentCreation(orderId)` method — idempotent on `Order.shipmentExternalId IS NULL` only. |
| ShipLogic refuses to cancel a "collected" shipment | Surface to admin via the admin tool — no automated retry. Manual ops resolution. |

### What can go wrong with webhooks

| Failure | YIIVA behaviour |
|---|---|
| Webhook arrives for an unknown `tracking_reference` | `ShipmentEvent` stored as orphaned; log warning. Could be a webhook for a shipment created via dashboard, not our API. |
| Two webhooks fire for the same event (retry, replay) | Unique constraint on `payloadHash` rejects the second insert → handler returns 200 no-op. |
| Webhook signature fails (when signing eventually exists) | Reject with 401 (or 404 for stealth); do not insert the event row. |
| Webhook payload schema doesn't match expected shape | Insert with `processError = "schema_mismatch"`, but ack 200 so ShipLogic doesn't retry. Alert ops. |
| Long-running missing webhook (e.g., shipment dispatched 24h ago, we never received the event) | **Phase 6 polling fallback**: cron sweeps Orders with `status: CONFIRMED` and `shipmentCreatedAt > 2h ago and < 7d ago`, polls `/tracking/shipments` and applies the same mapping. |

### Operational

- **Webhook secret rotation** — operationally tractable but not zero-cost: change env var → re-deploy → re-subscribe in ShipLogic dashboard with new URL. Rotation plan documented in CLAUDE.md once Phase 6 ships.
- **Sandbox vs production parity** — sandbox doesn't fire webhooks (as of 2026-06-03 test). Phases 4–5 fully testable in sandbox; **Phase 6 webhook handler is essentially production-only testing**. Plan for a careful first-real-shipment smoke (similar to the PayFast first-refund pattern in payments-foundation).
- **Cost of stale shipments** — TCG bills per booking. Aborted/timed-out checkouts that never create a shipment cost nothing. Once shipment is created, we owe TCG even if Order is later refunded — billing reconciliation lives in the merchant payout flow (Q22).

---

## 17. Reversibility — the Bob Go off-ramp

If TCG underdelivers in v1 (we'll know within ~3 months of going live based on Hellopeter-style buyer complaints, rate volatility, or webhook unreliability), the swap to Bob Go is a **single-service rewrite**:

1. `ShippingService` is the only place that knows ShipLogic exists (plus the webhook controller).
2. The `SHIPPING_SERVICE` injection token shields every consumer.
3. `StoreDispatchAddress` model + `Order.shipping*` fields are courier-agnostic.
4. Bob Go's address shape, auth model, and event types differ from ShipLogic's — those live entirely inside the rewritten `ShippingService`.

**Estimated swap cost:** 1-2 weeks for a single engineer once Bob Go's API is fully understood (which would require a separate research pass). No consumer code changes, no schema changes, no controller signature changes.

**Indicators that would trigger the swap:**
- Buyer complaints in mobile-app reviews specifically about TCG delivery quality
- A specific TCG outage that costs YIIVA >50 orders
- Merchants asking for multi-courier choice
- YIIVA volume crossing ~500 parcels/month (Bob Go's discounted-rate plans start paying for themselves at ~that threshold)

This isn't a hedge — it's a deliberate architectural property of the contract pattern. Same pattern is what let Payments build a full mock + real implementation pair without rework.

---

## Document status

- **Decisions Q11–Q15:** locked in `order-module-foundation.md`, restated here.
- **Decisions Q16–Q26:** locked in this document.
- **Open questions:** Q24 (webhook auth) pending TCG support.
- **Schema deltas:** designed, not yet applied. Migrations in Phase 2.
- **Phase 1 starts:** when the user gives the go-ahead. Foundation doc serves as the contract everyone codes against.
