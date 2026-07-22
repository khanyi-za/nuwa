# Shopify App — Foundation (research + design sketch)

> Status: **PHASE 1 COMPLETE (1a + 1b + 1c shipped 2026-07-22) — the one-time
> import wizard backend is fully built.** SA-1 decided: nuwa module
> (`src/shopify/`). SA-2 decided: merchant-created custom-app Admin token
> first; OAuth later behind the same ShopifyConnection row.
> Phase 1a = connect/validate/encrypted-storage + GraphQL client (cost-aware
> throttling, API 2026-07). Phase 1b = paginated catalogue pull (ACTIVE
> products/variants/images, collections+membership, locations; nested-
> connection continuations resolved; cost-budgeted page sizes) + the
> importer's mapping heuristics ported to `src/shopify/mapping/` (pure:
> gender inference w/ provenance, 19-rule category tree, option→color/size/
> material, REAL inventoryQuantity with untracked-stock stand-in + oversold
> clamp, weight-unit→grams) + `GET /shopify/import/preview` (read-only
> pull+map+summary; refuses non-ZAR with SHOP_CURRENCY_UNSUPPORTED).
> Phase 1c = async import executor: `POST /shopify/import` (optional
> defaultGenderType for gender-silent products — the regender map made
> self-serve) → ShopifyImportJob (PENDING→RUNNING via CAS; polled at
> `GET /shopify/import/latest`) → pull+map → existing store reused or DRAFT
> store created from shop identity (+ best-effort brand logo) → per-product
> server-side Cloudinary rehost (remote-URL upload, hash-keyed public_ids
> under stores/{id}/import/ so re-runs resume; >10MB Shopify originals retry
> via ?width=2048) → products land ACTIVE w/ real stock, namespaced deduped
> variant SKUs, collection/category/tag links; image-less products skipped;
> per-product failures counted not fatal; re-run = additive refresh (skips
> existing slugs); starter banner seeded for import-created stores.
> **Phase 2 = continuous sync, shipped 2026-07-22:** migration
> `20260722153500_shopify_sync` (ShopifyProductLink one-row-per-variant map
> incl. inventoryItemId, ShopifyWebhookEvent audit+idempotency table,
> connection sync columns: webhookSecret/apiSecretEncrypted/
> primaryLocationId/webhooksRegisteredAt; applied to BOTH DBs).
> Receiver `POST /shopify/webhook/:secret` — per-connection path secret
> (404 stealth) + HMAC-SHA256 verified WHEN the merchant supplied their
> custom app's API secret key at connect (optional `apiSecret` on the
> connect DTO; without it the path secret is the v1 auth boundary since
> admin custom-app webhook signing keys aren't otherwise available to us);
> raw-body SHA-256 idempotency; applier errors recorded on the event row
> and still acked 200 (no retry storms; payload kept for manual replay).
> Registration: auto `webhookSubscriptionCreate` (PRODUCTS_CREATE/UPDATE/
> DELETE + INVENTORY_LEVELS_UPDATE) after each completed import, idempotent,
> callback = `SHOPIFY_WEBHOOK_BASE_URL/shopify/webhook/<secret>` (env
> OPTIONAL — unset skips registration, import unaffected); unsubscribe on
> disconnect (best-effort). Appliers (ShopifySyncService): products/update →
> title/desc/status/price + per-variant price/stock (unlinked new variants
> logged, not created — v1); products/create → GraphQL re-fetch → shared
> ShopifyProductWriterService (same path as bulk import); products/delete →
> ARCHIVED (SA-4 decided); inventory_levels/update → stock SET, primary
> location only. Nightly 03:00 reconcile cron: full pull → stock/price
> drift repair + archive of Shopify-deleted products (missed-webhook safety
> net — ShipLogic lesson). Double-sell prevention: PaystackWebhookService
> post-payment hook now also fires ShopifyStockDecrementService
> (inventoryAdjustQuantities, -qty per linked item at the primary location;
> best-effort, never blocks the order; PaymentsModule→ShopifyModule one-way
> import mirroring shipment booking).
> ⚠ NOTHING verified against a live shop yet — needs the owner's Partner
> dev store + custom app (read_products/read_inventory/read_locations +
> write_inventory for the decrement) + shpat_ token, and a tunnel/public
> URL in SHOPIFY_WEBHOOK_BASE_URL for webhook delivery.
> Remaining for full capacity: live e2e smoke, athena onboarding UI
> ("clicks 1–5"), then later OAuth connect / Phase 3 public listing /
> Phase 4 order push-back (policy-gated).
> Original research status: This doc captures
> the feasibility research (verified against shopify.dev, 2026-07-09) and the
> intended shape so the project can start cold from here.
>
> One-line pitch: a Shopify app that lets a merchant onboard onto YIIVA in
> minutes — OAuth consent → their catalogue, variants, images and REAL
> inventory sync into nuwa automatically — replacing manual re-entry.

## §1 Why (strategic fit)

YIIVA's client-acquisition funnel already has a **pitch tool**: the demo
importer (`tools/demo-importer/`, see `docs/demo-importer/`) pre-loads a
target brand's catalogue from *public* Shopify JSON so the in-person demo is
personalised. The Shopify app is the **conversion tool** — when the brand
says yes, they install the app and onboard with consent + private data:

```
importer (no consent, public data, demo env)  →  pitch
shopify app (OAuth consent, real data, prod)  →  onboard + stay in sync
```

The importer has already de-risked the hardest part: its `transform` stage IS
the Shopify→YIIVA catalogue mapping (products/variants/images/collections,
option + gender + category heuristics). The app productionises that mapping
behind OAuth instead of `products.json`.

What the app adds that public JSON cannot:
- **Real per-variant inventory quantities** (`read_inventory`) — public
  `products.json` has no stock; the importer fabricates it. YIIVA's whole
  reserve/release stock model is only as good as its numbers.
- **Ongoing sync via webhooks** — price/stock/product changes propagate
  automatically. A one-time import goes stale in a week; sync makes YIIVA
  trustworthy as a second sales channel.
- **Double-sell prevention** — decrement the merchant's Shopify stock when a
  YIIVA order lands (`write_inventory`), so the same unit can't sell twice.

Caveat from the 50-brand survey (`data/brand_listing.xlsx`): not every target
is on Shopify — the app complements manual onboarding, it doesn't replace it.
(7/7 of the 2026-07-09 seeding batch were Shopify, so coverage is strong.)

## §2 Research findings (verified 2026-07-09 against shopify.dev)

### Confirmed feasible
| Claim | Finding | Source |
|---|---|---|
| OAuth scopes for catalogue + inventory + orders | `read_products`/`write_products` (Product, ProductVariant, Collection), `read_inventory`/`write_inventory` (InventoryLevel, InventoryItem), `read_orders`/`write_orders`. `read_all_orders` (past 60d window) needs special approval. | shopify.dev/docs/api/usage/access-scopes |
| Webhook topics for sync | `products/create`/`update`/`delete`, `inventory_levels/update`, `orders/create` all exist. Delivery: HTTPS, Pub/Sub, EventBridge. Subscribe via app TOML or `webhookSubscriptionCreate`. | shopify.dev/docs/api/webhooks |
| Review-free distribution at acquisition scale | **Custom distribution** apps skip Shopify review entirely. Mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) apply to **App Store apps only**. | shopify.dev/docs/apps/launch/distribution, /docs/apps/build/privacy-law-compliance |
| Rate limits comfortable | GraphQL Admin API is cost-based: 100 pts/s (standard plan) · 200 (Advanced) · 1000 (Plus); single query ≤ 1,000 pts. A 50–200 product catalogue sync is trivial. | shopify.dev/docs/api/usage/limits |

### Corrections / constraints discovered
1. **⚠ External-checkout order push-back is policy-gated.** New PUBLIC apps
   may NOT run their own checkout and register the order back into Shopify —
   public apps must route buyers through the merchant's Shopify checkout
   (staff answer, community.shopify.dev thread 34413). YIIVA's architecture
   (own cart + PayFast checkout) is exactly that pattern. Marketplace-style
   **sales channels** with their own checkout DO exist as an approved
   category, but approval requires owning the marketplace AND intent to
   onboard "several hundred Shopify merchants in the first year"
   (shopify.dev/docs/apps/build/sales-channels). → Not a v1 concern; a
   someday-negotiation once YIIVA has merchant volume.
2. **Custom distribution is per-store.** One custom app installs on ONE store
   (or stores within one Plus organization) and can't use the Billing API
   (irrelevant — commission is taken YIIVA-side). At ~50 brands that means
   one custom app per merchant (Partner-dashboard scriptable), or the
   integrator-standard alternative: the merchant creates an admin custom app
   in their own Shopify admin and hands YIIVA the Admin API token (no OAuth,
   no review, instant). **Distribution choice is permanent per app** — the
   custom-phase apps and an eventual public app are separate artifacts.
3. **GraphQL-only from day one.** REST Admin API is legacy (Oct 2024); new
   public apps must be exclusively GraphQL since 2025-04-01; product/variant
   REST endpoints were deprecated 2025-02 (GraphQL product APIs support
   2,000 variants). Do not write any REST integration code.
4. **Shopify's Marketplace Kit is dead** (deprecated CLI 2 / old Polaris;
   community told to migrate off — github.com/Shopify/marketplace-kit-feedback
   #16). No prescribed framework to conform to: a plain OAuth + webhook
   receiver + GraphQL sync worker is the current-day correct shape.
5. **Compliant double-sell workaround** (until sales-channel approval): on a
   YIIVA sale, do NOT create a Shopify order — decrement stock via
   `write_inventory` (`inventoryAdjustQuantities`). Stock stays true (the
   part that actually prevents double-selling); the merchant fulfils from
   athena rather than their Shopify orders screen.
6. Future-relevant channel tooling if/when approved: Contextual Product
   Feeds, `channelCreate`, and (API 2026-07) channel markets + order
   attribution definitions.

## §3 Intended architecture (sketch — not locked)

A contained new domain, either `nuwa/src/shopify/` or a small separate
service. Three parts:

1. **OAuth + token storage** — per-merchant Shopify access token, encrypted
   at rest, linked to `Store`. (Custom-app-token variant for the acquisition
   phase: merchant pastes an admin-created token instead of OAuth.)
2. **Webhook receiver** — `POST /shopify/webhook/...`. Crib from the two
   hardened webhook patterns in nuwa: PayFast ITN (idempotency table +
   signature verify) and ShipLogic (raw-body hash + CAS guards). Shopify
   webhooks are HMAC-signed (`X-Shopify-Hmac-Sha256` over the raw body) —
   `rawBody: true` is already enabled in `main.ts`.
3. **Sync worker** — GraphQL Admin API pulls + webhook-driven deltas →
   reuse/port the importer's `transform` mapping. Images re-hosted to
   Cloudinary (keeps the `@IsCloudinaryUrl` invariant; the importer's
   `rehost` stage is the reusable prior art) rather than hot-linking
   Shopify's CDN.

Inventory ownership: **Shopify is the source of truth** for merchants using
the app. YIIVA syncs down (webhooks + periodic reconcile) and pushes
decrements up on YIIVA sales. Two-way conflict resolution beyond that is
explicitly out of scope until it hurts.

## §4 Phase plan

| Phase | Name | Scope | Gate |
|---|---|---|---|
| 1 | One-time import wizard | OAuth (or pasted admin token) → pull catalogue via GraphQL → transform → rehost → create Store/Products/Variants/Images. Essentially the importer with consent + real stock. | none — custom distribution, no review |
| 2 | Continuous sync | Webhook receiver (`products/*`, `inventory_levels/update`) + periodic reconcile job + `inventoryAdjustQuantities` decrement on YIIVA order CONFIRMED (post-ITN hook, best-effort, same contract as shipment booking). | none |
| 3 | Public App Store listing | Same app, public distribution: app review, GDPR webhooks, Billing API if ever needed. | Shopify app review |
| 4 | Sales-channel order push-back | YIIVA orders appear in the merchant's Shopify admin; fulfil from their existing workflow. | Sales-channel approval — needs "several hundred merchants in year 1" credibility; blocked by current external-checkout policy for new public apps |

## §5 Open questions (unresolved — answer before Phase 1)

- SA-1: nuwa module vs separate service? (Leaning nuwa module — reuses
  Prisma/Cloudinary/notification plumbing; the sync worker is light.)
- SA-2: OAuth app per merchant (Partner dashboard, scriptable) vs
  merchant-created admin tokens for the acquisition phase? (Token variant is
  zero-friction but scatters secrets; decide with the first real onboarding.)
- SA-3: Variant-option mapping edge cases the importer punts on (3-option
  products, 100+ variants) — GraphQL supports 2,000 variants; YIIVA's
  variant model needs a look before promising fidelity.
- SA-4: What happens on `products/delete` / unpublish for a product with
  YIIVA order history? (Probably ARCHIVED, mirroring the existing rule that
  ordered products archive rather than delete.)
- SA-5: Price drift during an open YIIVA cart/checkout — accept (stock model
  already tolerates races) or re-quote on webhook?
- SA-6: Which store fields sync ongoing vs import-once (title/description
  yes; collections/nav — probably import-once + `renav`-style refresh)?

## §6 Sources

- https://shopify.dev/docs/apps/launch/distribution
- https://shopify.dev/docs/api/usage/access-scopes
- https://shopify.dev/docs/api/webhooks
- https://shopify.dev/docs/apps/build/sales-channels
- https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- https://shopify.dev/docs/api/usage/limits
- https://shopify.dev/docs/apps/build/privacy-law-compliance
- https://community.shopify.dev/t/clarification-on-sales-channel-requirements-for-external-marketplace-checkout-order-creation-in-shopify/34413
- https://github.com/Shopify/marketplace-kit-feedback/discussions/16
- https://www.lazertechnologies.com/insights/shopifys-rest-api-deprecation-and-graphql-migration-guide
