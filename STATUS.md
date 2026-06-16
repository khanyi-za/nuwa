# STATUS.md — Last updated 2026-06-16

> 🟢 **HANDOFF — next session start here.** Active work is the **Demo Catalogue
> Importer** — a tool to pre-load target brands' Shopify catalogues (+ manually
> supplied IG videos) into a LOCAL demo env, for personalised in-person sales
> demos (client-acquisition strategy, ~50 brands). Design + locked decisions:
> `docs/demo-importer/demo-importer-foundation.md`. Business case:
> `deploy_yiiva/business case/`.
>
> **✅ ALL 5 INITIAL BRANDS LIVE (2026-06-16).** sakanya, suhu, madebyfade,
> embedded, tolthema all ACTIVE in the `yiiva_demo` DB, serving through demo nuwa
> on **:3005** (A–Z directory + feed verified). Batch results + the two fixes:
> foundation §17. **Phases 1–4 committed (`b874974`); everything since is
> UNCOMMITTED** — `seed-demo` command, highlight caps in `curate.ts`, sku/tag
> dedupe fixes in `load.ts`, foundation §15–§17, this file.
> **NEXT TASK (user-queued): brand-logo scraping in Extract** (Store.logoUrl null).
> New TS CLI at `nuwa/tools/demo-importer/` (rides nuwa's toolchain, no new deps).
> - **Phase 1 `extract`** — fetches public Shopify `products.json`/
>   `collections.json` → `data/<slug>/raw/` (gitignored). Assumption validated
>   5/5 (sakanya, suhu, madebyfade, embedded, tolthema). Findings: foundation §11.
> - **Phase 2 `transform`** — raw → YIIVA-shaped `data/<slug>/manifest.json`
>   with genderType/category/option heuristics + pre-filled curate flags + empty
>   `videos[]`. Run on all 5; spot-checked correct. Findings: foundation §12.
> - **Phase 3 `curate` + `rehost`** — `curate` bootstraps+validates `curated.json`
>   (toggle include, fix gender, paste reel URLs into `videos[]`); `rehost
>   [--dry-run]` uploads images/videos to Cloudinary `yiiva-dev` (resumable
>   `asset-map.json`). **Dry-run validated on sakanya (41 image jobs); real
>   uploads NOT yet run** (outward-facing — awaiting go-ahead). `yt-dlp` not
>   installed locally (videos[] empty so untested). Findings: foundation §13.
> - **Phase 4 `load`** — wipe-and-reload a curated brand into the LOCAL demo DB
>   via Prisma (pg adapter): merchant User (`<slug>@demo.yiiva.co.za`/`DemoPass1`)
>   + ACTIVE Store + addresses + dispatch + collections + products + variants +
>   images/banner/video (Cloudinary URLs from asset-map) + category/tag links.
>   **Built + type-checks against the real schema; NOT run** (needs a real rehost
>   asset-map + a live demo DB). Findings: foundation §14.
> - **Phase 5 `seed-demo` + first brand live** — `yiiva_demo` DB created (Node/pg,
>   no psql) + migrated + categories seeded; sakanya rehosted (41 imgs → Cloudinary
>   yiiva-dev) + loaded (ACTIVE store, 5 products/19 variants/3 collections/5
>   banners; login `sakanya@demo.yiiva.co.za`/`DemoPass1`). Demo nuwa booted on
>   **:3005** (dev :3000 untouched) → verified sakanya serves via `/api/merchants`
>   + `/api/products/feed?genderType=women`, images on `res.cloudinary.com/
>   yiiva-dev/demo/sakanya/...`. Findings + runbook: foundation §15/§16.
> - **Batch (2026-06-16)** — all 5 brands loaded (highlight caps 40 products/5
>   imgs added to `curate.ts`; sku + tag-slug dedupe fixes in `load.ts`). Counts +
>   fixes: foundation §17. Demo nuwa :3005 serves all 5 (A–Z verified).
> - Commands: `extract` / `transform` / `curate` / `rehost [--dry-run]` / `load`
>   / `seed-demo`. Full pipeline run end-to-end on 5 brands.
>
> **▶ NEXT:** (1) **brand-logo scraping in Extract** (user-queued — `Store.logoUrl`
> null; grab homepage `og:image`/logo, thread through manifest→load). (2) **commit**
> the uncommitted pile. (3) **View in apps** — maya/athena target :3000; repoint
> at :3005 or boot demo on :3000. (4) **Polish**: `genderType` curation per brand
> (heuristic), `brew install yt-dlp` + reel URLs for video, scale to the full ~50
> (expect some non-Shopify §8 fallbacks). Demo nuwa on :3005 is a bg process —
> stop with `lsof -ti :3005 | xargs kill`.
>
> **Uncommitted on `main`:** `tools/demo-importer/` (new), `package.json`
> (import script), `docs/demo-importer/demo-importer-foundation.md`, this file.
>
> **Older backend track (unchanged, still pending):** PayFast ITN smoke (ngrok),
> then the Notifications module (launch blocker). Backend last green at 765
> tests / 52 suites; last commit `7ee5af4`. `chat_attachment` Cloudinary preset
> already created.

## Frontend integration session (2026-06-11) — what happened in/to nuwa

No nuwa source changes. Dev environment work:

- **Both pending migrations applied** to the local `ayana` DB
  (`product_gender_type`, `chat_module`). ✅ ops item 1
- **Dev data seeded** (script-driven, idempotent): `Product.genderType` on all
  7 products; 4 categories (dresses/tops/bottoms/sets) linked to products;
  5 trending `Tag`s linked; S/M/L variants on Black Hoodie (L sold out, for
  the 409 path); a primary `StoreDispatchAddress` for Suhu (Braamfontein) —
  this is what makes `POST /api/checkout/quote` return **real ShipLogic rates**
  (R95 observed, not the R110 fallback). ✅ ops item 2
- **Boot + WebSocket smoke test done** ✅ ops item 4: full DI graph boots; REST
  surface verified endpoint-by-endpoint as screens were wired (feed, search,
  merchants, cart incl. stock 409s, quote, order create w/ signed PayFast
  payload, order detail/cancel/tracking-404, bookmarks, follows w/
  followerCount, conversations incl. idempotency replay); **socket.io chain
  verified with a script** — JWT handshake → `join` ack → REST send →
  `message:new` fan-out received.
- **Auth surface verified for mobile**: register → verify (token planted in
  DB — dev has no email delivery) → login → refresh **with rotation + reuse
  rejection** → `/auth/me` → personalised `/api` fields with Bearer token.
  Test user: `maya-test@yiiva.dev` / `TestPass1`.
- **Still pending:** ops item 3 (`chat_attachment` Cloudinary preset —
  dashboard task), item 5 (PayFast ITN smoke via ngrok — the simulator
  checkout run is the natural vehicle), item 6 (ShipLogic webhooks — prod
  only), item 7 (npm audit).

## Mobile integration — Screen 12 (Chat) backend complete

**765 tests / 52 suites green, tsc clean.** The biggest single build — a net-new
real-time messaging domain (`src/chat/`). See the `chat-module` memory.

**Decisions (ratified):** real-time via **socket.io WebSocket** self-hosted in
nuwa (not polling); **merchant chat API built too** (`/stores/:storeId/...`,
consumed by the merchant dashboard repo); **image attachments** in v1.

**Architecture = REST writes + WS fan-out.** ChatService is the durable core;
ChatGateway (`/chat` namespace, JWT handshake) pushes `message:new`/`read` to
participants. New deps: `@nestjs/websockets`, `@nestjs/platform-socket.io`,
`socket.io`; `IoAdapter` wired in `main.ts`.

- **Buyer** `/api/conversations/...`: get-or-create by merchant, messages
  (limit/before/after), send (text + image attachments + orderRef, idempotency),
  read, report. + `GET /api/orders/:id/preview` (chat context banner).
- **Merchant** `/stores/:storeId/conversations/...`: list, messages, reply, read
  (canManageStore authz).
- **Schema:** Conversation / Message / ConversationReport + migration
  `20260610120000_chat_module` (NOT applied — `prisma generate` only).
- **Uploads:** new `chat_attachment` Cloudinary context (signed-direct).

**⚠️ Ops/follow-ups:**
- Apply the chat migration + the earlier `product_gender_type` migration when
  next at a DB (`prisma migrate dev`).
- Create the `chat_attachment` signed preset in the Cloudinary dashboard.
- `npm install` of the WS deps surfaced pre-existing audit warnings (not chat-
  specific).

**v1 limits:** images-only attachments (product cards v2), `messagingEnabled`
always true, `avgResponseTime` null, message status 'sent' (read receipts v2),
buyer conversation-list screen (chat.md §7/§8) deferred (its screen doesn't exist).

## Mobile integration — Screen 10 (Explore) SCRAPPED

Explore is shelved — **no backend work**. It's an orphan surface (hidden tab,
`href: null`), reachable only via two Home "See All" links that are themselves
slated to re-route (Trending Brands → /shop per ST-9). Every section duplicates
Home; its product purpose (EX-1) is unresolved. Noted in maya's
`screens/10-explore/screen.md` + `api/products.md` §3. `GET /products/featured`
(its only unique endpoint) is deferred with it. Revisit only if a product owner
gives Explore a distinct editorial purpose.

## Mobile integration — Screen 11 (Shop) backend complete

**748 tests / 51 suites green, tsc clean.** Shop is a real visible tab. Mostly
existing blocks (categories ✅, cart-summary ✅, follow ✅); one new endpoint:

- `GET /api/merchants` — A–Z brand directory. ACTIVE stores; `genderType` +
  `letter` filters; sort name_asc (default)/name_desc/newest/popularity;
  cursor-paginated. Per-brand `productCount` (groupBy) + `isFollowedByMe`. Plus
  `lettersWithBrands[]` for the alphabet index.

**Flagged:** `lettersWithBrands` loads all matching display names per call — fine
at current scale, precompute later. Notifications badge deferred (on hold).

**Next screens:** 12 Chat (⚠️ NO backend exists — whole new real-time domain,
CH-1; big build or defer) and 13 Video Player (`reels.md` doesn't exist; maya
votes defer/remove — VP-1). Both need a decision before building.

---

## Mobile integration — Screen 09 (Wishlist) backend complete

**745 tests / 51 suites green, tsc clean.** Small screen — the bookmark mutation
was already built (Screen 01); this added the list view.

- `GET /api/me/bookmarks` (new `MobileMeController` at `api/me`, auth-required) —
  lists `WishlistItem`s as the maya bookmark wrapper `{ bookmarkedAt, priceChanged,
  priceAtBookmark, product+available }`. Reuses `toFeedProduct`. Unavailable
  products kept with `available: false` (WL-11). Cursor-paginated; sort
  newest/oldest (price/merchant deferred).

**Flagged limitation:** `priceChanged` always false (no add-time price on
`WishlistItem` — same as cart; a `priceAtAddInCents`-style field would fix both).

`/api/me/likes` + `/api/me/follows` (social.md §5/§6) will slot into the same
`MobileMeController` when their screens come up.

**Next screen:** 10 Explore — editorial/curatorial surface. Largely reuses
featured/trending/collections; needs a scope read (some is admin-curation, EX-*).

---

## Mobile integration — Screen 08 (Merchant Profile) backend complete

**742 tests / 51 suites green, tsc clean.** Mostly existing-block mapping.

- `GET /api/merchants/:username` — Store-by-slug → maya profile. `heroMedia` ←
  `StoreBannerMedia`, `bio` ← description, `location` ← first StoreAddress city,
  `contact.email` ← `contactEmail`, `postCount` = ACTIVE product count.
  **MP-10 status handling:** ACTIVE → full; SUSPENDED/CLOSED → returned with
  `status` (placeholder); never-live → 404.
- `GET /api/merchants/:username/products` — store catalogue via the shared
  `queryFeedPage`; `categories[]` = distinct category slugs; `clothingType`
  filter. Sort = newest only (price sorts deferred — MP-7).
- `POST /api/merchants/:id/view` — thin `merchant_view` AnalyticsEvent (Phalo).

**Mapping calls flagged:** `messagingEnabled` always true (no per-store toggle;
Chat is Screen 12), `location` from public StoreAddress city, `isVerified` =
ACTIVE. Follow was already built (Screen 01).

**Deferred:** merchant share (MP-9), bio truncation (UI), profile-pic tap (MP-3).

**Next screen:** 09 Wishlist — `GET /me/bookmarks` (social.md §4). Bookmark
mutation already built (Screen 01); this is the list view over WishlistItem.

---

## Mobile integration — Screen 07 (Search) backend complete

**733 tests / 51 suites green, tsc clean.** Net-new search capability (Nuwa had
no search module), built by reusing the feed-grid query.

**Refactor:** extracted `FEED_SELECT` + `baseProductWhere` + a private
`queryFeedPage(where, {cursor,limit}, userId)` in `MobileProductsService`. `feed()`
and all four search endpoints now share it (one source of truth for grid shape +
cursor pagination). Feed tests stayed green as the guardrail.

**Screen 07 endpoints shipped (all under `/api/search`):**
- `GET /search` (universal) — `q` ORs across product title / merchant name /
  category name / tag name
- `GET /search/category` · `GET /search/smart-category` · `GET /search/merchant`
  — scoped variants (same card shape)
- `GET /search/suggestions` — trending = top `Tag`s by `usageCount`
- `POST /search/track` — thin `AnalyticsEvent` writer

**Phalo dependency (noted in `phalo-smart-engine` memory):** v1 search = SQL
`ILIKE contains` + recency. Real relevance/ranking, trending-search signal, and
the AI-tagging that fills smart-categories all belong to the future **Phalo**
engine. Until AI-tagging runs, smart-category results are thin (tags sparse).

**Deferred (Search):** autocomplete `suggestions[]`, merchant-card-in-results
(SR-7), real relevance/full-text infra (Phalo).

**Next screen:** 08 Merchant Profile — `GET /merchants/:username` (+ products).
Maps to `Store`; mostly built blocks (slug-as-username, store catalogue).

---

## Mobile integration — Screen 06 (Track Order) backend complete

**727 tests / 50 suites green, tsc clean.** Handled the Shipping-hold tension by
serving **local** tracking data instead of a live ShipLogic proxy.

- `GET /api/orders/:id/tracking` — reads the `Shipment` + `ShipmentTrackingEvent`
  rows the ShipLogic **webhook** already populates (Shipping Phase 6). **No live
  ShipLogic call** → zero new shipping integration, respects the hold.
  Consolidates child shipments; `ShipmentStatus`→`currentStatus`. `404
  TRACKING_NOT_AVAILABLE` before a shipment exists. ⚠️ Sandbox webhooks don't
  fire, so expect 404 until production webhook delivery is verified.
- `GET /api/orders/:id` now returns **`cancellationEligibleUntil`** = `confirmedAt
  + 24h` while CONFIRMED (gates maya's Cancel button per O-3; backend cancel
  stays more permissive — UI hint only).

Cancel + order detail (used by this screen) were already built in Screens 04/05.

**Deferred (Screen 06):** Returns/Exchange flow (TBD product call), live ShipLogic
proxy (using stored webhook data instead).

**Next screen:** 07 Search — needs a new search capability (Nuwa has no search
module). Discovery surface; should be self-contained (no payment/shipping deps).

---

## Mobile integration — Screen 05 (Order Success) backend complete

**724 tests / 50 suites green, tsc clean.** Screen 05 is mostly served by the
already-built `GET /api/orders/:id` (mount + pending-poll). One new endpoint:

- `POST /api/orders/:id/cancel` — consolidated buyer cancel. Cancels every
  cancellable child order (PENDING/CONFIRMED) of the PaymentGroup via the shared
  `BuyerOrdersService` (added to OrderModule exports). `409 ORDER_NOT_CANCELLABLE`
  / `404 ORDER_NOT_FOUND`. **`refund: null` in v1** — buyer-cancel does not
  auto-refund (admin/manual flow).

Also fixed `mapMobileOrderStatus`: a buyer-abandoned unpaid order (child orders
CANCELLED, PaymentGroup still PENDING) now correctly reports `CANCELLED`.

**Deferred (Screen 05):** `POST /auth/claim` (exists on the auth surface; the
Claim *screen* is separate auth-flow work) and `POST /orders/:id/retry-payment`
(OS-3 — re-checkout instead).

**Next screen:** 06 Track Order — needs `GET /orders/:id/tracking` (proxies
ShipLogic). ⚠️ Shipping is on hold, so this one needs a scope decision.

---

## Mobile integration — Screen 04 (Checkout) backend complete

**721 tests / 50 suites green, tsc clean.** A working, payable checkout on top of
the tested web flow. `MobileModule` now **imports `OrderModule`** to reuse
`AddressService` + `CheckoutService` (both added to OrderModule exports — no web
behaviour change). ⚠️ No e2e harness exists, so the DI graph isn't boot-tested —
run a server boot smoke test when convenient.

**Screen 04 endpoints shipped:**
- `GET/POST/PATCH/DELETE /api/me/addresses` + `PATCH :id/default` — wraps
  AddressService; maya `line1`/`line2`, `country: "ZA"`
- `POST /api/checkout/quote` — reuses `CheckoutService.quote`; returns
  `{ subtotal, shipping, tax, total }`. **VAT-inclusive** — `tax` is the included
  portion, NOT added on top (D6). Replaces maya's `/shipping/rates` for totals.
- `POST /api/orders` — reuses `CheckoutService.commit`; the maya "order" = the
  **PaymentGroup** (`order.id` = paymentGroupId). Returns PayFast
  `{ type:'redirect', actionUrl, fields, returnUrl }` for WebView auto-submit.
  Maps stock conflict → 409 `STOCK_DRIFT`, empty cart → 409 `CART_EMPTY`.
- `GET /api/orders/:id` — aggregates child per-store orders into one consolidated
  maya order (status via maya TO-8 rule, merged items, summed totals).

**v1 scope cuts (per D1–D7, ratified):** auth-required checkout (guest deferred),
delivery only (pickup deferred), PayFast redirect only (Apple Pay / Payflex /
saved cards / promo deferred — those `POST /orders` body fields accepted but
ignored). VAT is inclusive (maya must stop adding 15%).

**Next screen:** 05 Order Success (mostly `GET /api/orders/:id` polling — already
built) then 06 Track Order (needs `GET /orders/:id/tracking` — Shipping is on hold).

---

## Mobile integration — Screen 03 (Cart) backend complete

**709 tests / 47 suites green, tsc clean.** The full server cart is wired.

**Screen 03 endpoints shipped:**
- `GET /api/cart` — full cart (auth optional; guests get empty shape). Items
  enriched with `available` + `stockCount`. **`priceChanged` always false in v1**
  — `CartItem` has no add-time price; revisit with a `priceAtAddInCents` field.
- `PATCH /api/cart/items/:itemId` — change quantity (reserve/release delta);
  409 `OUT_OF_STOCK`, 404 `CART_ITEM_NOT_FOUND`
- `DELETE /api/cart/items/:itemId` — remove line, release stock
- `DELETE /api/cart` — clear cart, release all stock

All mutations are auth-required (v1) and reuse the shared `reserveStock`/
`releaseStock` primitives + the 404-on-cross-user ownership guard. Returns the
full cart shape so the client reconciles without a second call.

**Deferred (Screen 03):** guest server cart (X-Cart-Session) — mutations 401 for
guests; `priceChanged` drift tracking.

**Next screen:** 04 Checkout — the big one (quote, PayFast init, guest checkout).

---

## Mobile integration — Screen 02 (Product Detail) backend complete

Built on the Screen 01 mobile surface (same envelope/conventions). **699 tests /
47 suites green, tsc clean.**

**Screen 02 endpoints shipped:**
- `GET /api/products/:id` — full detail (variants from `ProductVariant`, media,
  merchant, `smartCategories`←tags, personalised flags when authed). **No
  `inventoryType`/`leadTime`** — made-to-order is a deprecated prototype feature,
  dropped from v1 (D1). `likeCount` 0, `isLikedByMe` false (likes local-only).
- `GET /api/products/:id/similar` — same-gender carousel (Phalo seam)
- `POST /api/cart/items` — **auth-required v1** (guests → 401 → maya login modal);
  reuses the shared `reserveStock` primitive; `variantId` required when the
  product has variants; stock race → 409 `OUT_OF_STOCK`; returns full cart shape
- `POST /api/products/:id/view` — thin `AnalyticsEvent` writer (Phalo consumes later)

`MobileCartService.fullCart()` (maya flat cart shape) also landed here — it's
reused by the Cart screen (03) next.

**Deferred (Screen 02):** `PUT/DELETE /products/:id/like` (likes local-only v1),
`POST /shipping/eta` (Shipping module on hold + modal TBD on mobile).

**Next screen:** 03 Cart (full `GET /cart`, PATCH/DELETE items, clear) — most of
the cart serializer is already built.

---

## Mobile integration — Screen 01 (Home) backend complete

The **maya** buyer app (`deploy_yiiva/maya/`, Expo/RN) is being wired to a real
backend **one screen at a time** via a dedicated mobile/buyer API surface in
nuwa under the `/api` prefix — scoped response envelope (`{success,data,pagination}`)
+ vocabulary translation, **never touching the existing web/admin/merchant routes**.
See `src/mobile/` and the `mobile-buyer-api-architecture` + `phalo-smart-engine`
memories. Decisions tracked in `maya/docs/open-questions.md`.

**Screen 01 (Home) endpoints shipped** (687 tests / 47 suites green, tsc clean):
- `GET /api/categories` — admin `Category` → chip shape
- `GET /api/products/feed` — gender-filtered, cursor pagination, personalised `isBookmarkedByMe` + `merchant.isFollowedByMe` when authed
- `GET /api/products/new-arrivals` — recent-products heuristic (Phalo seam)
- `GET /api/merchants/trending` — ACTIVE stores by `followerCount` (Phalo seam)
- `GET /api/cart/summary` — authed buyer cart badge (guest carts deferred)
- `PUT/DELETE /api/products/{id}/bookmark` — = `WishlistItem` (idempotent)
- `PUT/DELETE /api/merchants/{id}/follow` — = `StoreFollower` (idempotent)

**Schema:** added `Product.genderType` enum (WOMEN/MEN/UNISEX) + migration
`20260608100000_product_gender_type` (not yet applied to a DB — `prisma generate`
run for types). ⚠️ **Products need `genderType` set (seed/admin) before feeds
return data.** maya is still on `USE_FIXTURES=true`, so no live dependency yet.

**Deferred** (later screens / iterations): product likes (local-only on maya v1,
no server model), guest server cart via `X-Cart-Session`, notifications
unread-count (Notifications module on hold), Home & Lifestyle gender axis,
sold-out exclusion on new-arrivals.

**Next screen:** 02 Product Detail.

---

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

---

## Mobile integration — follow-ups / ops

**Status 2026-06-13:** items 1, 2, 3, 4, 8 and the maya wiring are ✅ done
(see the top section). Remaining:

5. **PayFast sandbox end-to-end smoke test** — run the simulator checkout with
   ngrok exposing `/payments/notify`; verifies ITN → Order CONFIRMED →
   ShipLogic shipment booking in one pass.
6. ShipLogic webhook delivery (sandbox doesn't fire → tracking 404 until prod).
7. `npm audit` warnings surfaced by the WebSocket dep install.

**Done since 2026-06-11:**
- ✅ item 3 — `chat_attachment` signed upload preset created in the Cloudinary
  dashboard. Chat photo attachments unblocked.
- ✅ item 8 — nuwa committed (`7ee5af4`); working tree clean.

**maya frontend wiring: ✅ DONE** (2026-06-11) — all screens on live data,
auth implemented, VAT-inclusive totals rendered, socket connected. See
`maya/status.md` for the full integration state.

**Open product decisions (re-scope, not v1 builds):** EX-1 (Explore vs Home),
VP-1 (Video Player keep/remove), P-4/ST-7 (Home & Lifestyle gender axis).
