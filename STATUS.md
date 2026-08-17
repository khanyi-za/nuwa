# STATUS.md — Last updated 2026-08-17

> 🟢 **HANDOFF — next session start here.**
>
> ## 2026-08-17 — Shopify client-credentials support BUILT (nuwa+athena) ·
> ## Phase C UNBLOCKED pending deploy
>
> The 2026-08-16 blocker below is RESOLVED in code (details + verified
> Dev Dashboard UI steps: shopify-app-foundation.md top banner). nuwa:
> migration `20260817125911_shopify_client_credentials`, ShopifyTokenService
> (lazy 24h-token refresh, exchange-as-validation, legacy shpat_ passthrough),
> connect accepts Client ID+Secret XOR legacy token, client secret doubles as
> webhook HMAC key. athena: wizard form + schema + Dev Dashboard guide +
> settings copy. 866 nuwa tests green / athena build clean — ALL UNCOMMITTED
> in both repos. Owner already created Dev Dashboard app `testingYiiva`,
> installed it on thedopplerstore, and verified the curl token exchange live.
>
> **▶ NEXT:** (1) commit nuwa (suggested: "shopify client-credentials auth:
> ShopifyTokenService w/ lazy 24h refresh, connect via Client ID+Secret
> (legacy shpat_ kept), client secret = webhook HMAC key, migration + docs,
> on 17/08/2026") + promote main→staging→production (migration rides the
> pipeline); (2) commit athena ("shopify connect: Client ID+Secret fields +
> Dev Dashboard guide (custom apps retired by Shopify 2026-01), on
> 17/08/2026") + push (Vercel auto-deploys); (3) owner errand: add
> **write_inventory** to testingYiiva's Required scopes (new version →
> release → reinstall) — needed for sale→Shopify stock decrement; refund
> policy in Shopify still unconfirmed; (4) THEN Phase C connect test:
> athena wizard → thedopplerstore + Client ID/Secret → preview 14 products →
> import → verify (checklist in 2026-08-16 entry below) → live-sync edit
> test.
>
> ## 2026-08-16 — OTP auth SHIPPED + verified in prod · Phase C BLOCKED:
> ## Shopify killed in-admin custom apps (decision pending)
>
> **OTP email verification + password reset LIVE (all 3 repos, deployed
> 2026-08-15):** 6-digit codes replace emailed links everywhere — sha256 at
> rest, 10-min expiry, 5-attempt self-destruct, constant-time compare, new
> `POST /auth/resend-verification` (60s cooldown, enumeration-safe;
> forgot-password got the same cooldown). verify-email = `{email, code}`
> (still auto-logs-in), reset-password = `{email, code, password}`. Auth
> emails carry NO URLs (kills the wrong-host FRONTEND_URL bug class; code
> is in the subject). Migration `20260815134912_otp_email_verification`
> applied local + staging + prod via the pipeline. nuwa 853 tests green;
> athena: register panel → code entry (VerifyCodeForm, invite returnUrl +
> cookie auto-login preserved), standalone /auth/verify-email?email= page,
> login 403 → redirects there, forgot-password = 2-step code+password,
> legacy reset URL redirects; maya: verify-email = code screen (fixes the
> NEVER-WIRED universal-link landing — emailed links could not open the
> app), check-email screen deleted, login panel routes to code entry,
> 2-step reset. Contract doc auth-module-api.md updated. **Verified live
> end-to-end in prod** (register → 409'd on pre-existing account →
> login 403 → code page → Resend → email delivered → verified+logged in).
> Note: resend requires pressing the button — no auto-send by design
> (abuse + cooldown burn); revisit copy if users trip. `runtime-logs/`
> gitignored (Railway log dumps for debugging).
>
> **⚠ PHASE C BLOCKED — LAUNCH-CRITICAL Shopify platform change
> (full writeup + sources: shopify-app-foundation.md top banner):**
> Shopify retired in-admin custom apps on **2026-01-01** — new apps live in
> the Dev Dashboard (dev.shopify.com) and get **Client ID + Secret** with
> **24h-expiring tokens** via client-credentials grant (`POST /admin/oauth/
> access_token`, refresh = re-exchange; usage header unchanged). Permanent
> `shpat_` tokens exist only for pre-2026 legacy apps. **YIIVA cannot
> onboard ANY new merchant until nuwa+athena support this** (both repos
> also regex-reject non-shpat_ tokens at the door). Doppler store (June
> 2026) has no legacy path. Required work itemized in the foundation-doc
> banner: encrypted clientId/Secret storage, token exchange+cache+refresh
> service, athena wizard + guide rewrite. **Owner paused to decide
> (2026-08-16)**: build properly (~day, recommended — mandatory pre-launch
> anyway) vs quick-hack one import (manual curl exchange + relaxed regex;
> sync dies in 24h). Doppler store errand still open either way: distinctive
> refund policy set in Shopify (needed for returns-capture verification).
>
> **▶ NEXT:** (1) decide the Shopify token approach → build it → resume
> Phase C (connect Doppler via athena wizard, verify 14 products / 3
> collections / variant images / 925g weight / returnPolicyText /
> webhooksRegisteredAt, then live-sync edit test); (2) commit the OTP-era
> follow-ups sitting uncommitted in nuwa (.gitignore runtime-logs, contract
> doc + STATUS + foundation-doc updates — suggested msg: "docs: Shopify
> 2026 token-model change (launch-critical, decision pending) + OTP status,
> on 16/08/2026"); (3) Paystack KYC §1 paste still an open owner errand;
> (4) Phase D arm-the-guards + Phase E phalo unchanged below.
>
> ## 2026-08-14 — RAILWAY A0 COMPLETE: nuwa LIVE in production + staging
>
> Railway provisioning finished — user executed every step personally
> (learning contract holds for all deploy/infra work). Both environments
> GREEN: project `Nuwa`, service `nuwa` + its own Postgres per env
> (⚠ staging's DB service is named `Postgres-WgSy` — any future variable
> reference there must use that exact name; production's is `Postgres`).
> Branch mapping: production env ← `production` branch, staging env ←
> `staging` branch. Deploy pipeline verified end-to-end: Docker build →
> pre-deploy `prisma migrate deploy` (all migrations applied to both fresh
> DBs) → `/health` healthcheck green.
>
> **Domains live:** `https://nuwa-production.up.railway.app` (+ staging's
> own `up.railway.app` domain, see dashboard) — `/health` verified from
> public internet; `SHOPIFY_WEBHOOK_BASE_URL` set in BOTH envs to each
> env's own domain. **Admin seeded in BOTH envs** via `railway ssh -- npx
> prisma db seed` (`created:` confirmed each side; login → accessToken
> verified against both domains). ⚠ Rotate admin password after first real
> login; ADMIN_1_PASSWORD var can then be removed from Railway.
>
> **Still deliberate:** NODE_ENV UNSET everywhere (guards off until
> Paystack KYC lands → Phase D). `CORS_ORIGINS` currently the localhost
> placeholder — MUST be updated in both envs when athena deploys (Phase B).
> Cloudinary = yiiva-dev values in both envs (Phase D swaps prod cloud).
>
> **Gotchas learned (recorded for reruns):** (1) Railway auto-imported
> `.env.example` placeholder values at project creation — the localhost
> DATABASE_URL caused P1001 then P1013; fix = delete var, re-add by typing
> `${{` and picking the reference from autocomplete (cannot dangle).
> (2) Railway CLI is non-interactive under Claude Code — use explicit
> flags (`railway link --project Nuwa --environment <env> --service nuwa`).
> (3) `railway ssh` needs a registered SSH key (`railway ssh keys add`)
> AND a first interactive connect from a real terminal to accept the host
> key; after that `railway ssh -- <cmd>` works non-interactively. (4) A
> seed that prints `updated:` hit the LOCAL db — `created:` is the proof
> it hit the empty remote one; always check `hostname` after ssh.
>
> **Git:** main = staging = production = b29c685 (already in sync).
> Pending commit on main: this STATUS update + docs/paystack-kyc-responses.md
> + docs/policy-register.md → then the user's first solo promotion drill
> (main → staging → production; docs-only, each push triggers that env's
> redeploy — safe first rep).
>
> **▶ NEXT:** (1) commit + promotion drill; (2) Phase B: athena → Vercel,
> then update `CORS_ORIGINS` in BOTH Railway envs with the Vercel domain;
> (3) Phase C: Shopify prod e2e — register real merchant on prod via
> athena, connect `thedopplerstore.myshopify.com`, verify 14 products /
> 3 collections / variant images / returnPolicyText / webhooksRegisteredAt,
> then live-sync edit test; (4) Phase D arm-the-guards (checklist in
> 2026-08-11 entry below) once Paystack KYC approves; (5) Phase E: phalo →
> Railway. Owner errand still open: paste §1 of
> docs/paystack-kyc-responses.md into Paystack's KYC form.
>
> ## 2026-08-11 (later) — Paystack KYC session: two policies ADOPTED
> ## (owner-confirmed) + 2 follow-up caveats
>
> Answering Paystack's live-mode KYC questionnaire (7 questions on merchant
> KYC/EDD, fund holding/release, disputes). Owner formally adopted two
> operating policies — the KYC answers rely on them, so they are REAL
> procedure from now on:
> 1. **Manual CIPC-check EDD** at store review: verify the CIPC number
>    against the public CIPC/BizPortal search (entity exists, name matches);
>    on mismatch/high-risk require director ID + proof of bank account
>    before approval, or decline.
> 2. **Payout-account-before-go-live**: go-live approval requires the
>    store's Paystack subaccount to be configured
>    (`Store.paystackSubaccountCode` set) — every trading merchant is on
>    direct split settlement; YIIVA never holds merchant funds.
> ⚠ **Caveats / follow-ups:** (a) the admin review UI does NOT yet surface
> payout-account `configured` status — expose it on the admin store view
> (small nuwa+athena follow-up); until then the admin checks DB/settings
> manually. (b) pre-policy ACTIVE stores (demo-era) have no subaccount —
> grandfather them through the settings payout flow before real traffic;
> prod DB starts empty, so every real merchant hits the gate from day one.
>
> **All 7 answers finalized → `docs/paystack-kyc-responses.md`** (§1 =
> submission-ready text; §2 = INTERNAL adopted-policies + follow-up
> checklist incl. public Returns & Refunds page, support@ contact, stale
> PayFast copy in maya/docs/about_yiiva.md). Owner to paste §1 into
> Paystack's form. **NEW `docs/policy-register.md`** = the durable policy
> record (P-1…P-6 incl. the two adopted gates, claim boundaries — no
> sanctions/PEP claims etc. — parked items, follow-up checklist). Future
> compliance/product decisions should check it first.
>
> **▶ NEXT:** the "urgent unrelated work" from the entry below is DONE (it
> was this KYC session). (a) Owner errand: paste §1 of
> docs/paystack-kyc-responses.md into Paystack's KYC form (KYC approval →
> sk_live_ key → Phase D arm-the-guards); (b) commit nuwa (KYC doc +
> policy register + this STATUS entry — suggested msg: "Paystack KYC
> responses + policy register, on 11/08/2026"); (c) RESUME the Railway
> deployment thread below exactly where it paused (finish staging env →
> A0.2 vars both envs → A0.3 domains → promotions → A0.5 seed).
>
> ## 2026-08-11 — GO-LIVE PIVOT: test everything in PROD · Railway
> ## provisioning started (A0.1 done) · Doppler Shopify test store READY
>
> Sessions 08-03→08-11. **Strategy pivot (user decision): the Shopify app,
> Paystack live, and TCG live all get tested against PRODUCTION on Railway —
> NOT localhost.** The tunnel/localhost approach is ABANDONED (detached
> leftovers from 08-05 may still be running — cloudflared, dev nuwa :3000,
> athena :3001; kill freely, the quick-tunnel URL is dead-per-restart
> anyway). User is NEW to multi-env deployment and is deliberately doing
> every click/command PERSONALLY to learn — walk slowly, give exact
> commands + expected output, never act on their behalf for deploy steps.
>
> **Doppler Shopify test store READY:** `thedopplerstore.myshopify.com` —
> 14 products / 3 collections verified live via public products.json
> (Ziggy Collection 5, Winter Essentials 5, user's own "Doppler summer" 4).
> Built from 3 generated CSVs in `docs/shopify-app/` (all image URLs
> HEAD-verified at generation): `yiiva-test-products.csv` (sittingpretty:
> colour+size matrices incl. 16-variant boilersuit, colour-only belt,
> no-variant bag, per-colour Variant image URLs), `yiiva-test-collection.csv`
> (netterose Ziggy: Band Size×Cup Size 25-variant bralette — two-option
> NO-colour shape), `yiiva-test-collection-fields.csv` (fieldsstore:
> 3-option Size×Colour×Artist jacket, numeric trouser sizes, real source
> weights incl. 925g sweater, colour value = artist name edge case).
> ⚠ Store is PUBLICLY readable (password protection off) with Sitting
> Pretty/Nette Rose/FIELDS imagery — user was advised to re-enable password.
> ⚠ Unconfirmed user errands: custom-app `shpat_` token created? refund
> policy set? (needed for connect + returns-capture test).
>
> **Deployment plan (taught + agreed), phases:** A) nuwa → Railway
> (staging+production envs, in progress); B) athena → Vercel + add its
> domain to `CORS_ORIGINS` on Railway; C) Shopify e2e test in prod (no
> tunnel — real public URL); D) Paystack live + TCG live + ARM THE GUARDS
> (see checklist below); E) phalo → Railway (last; nothing blocks on it).
> Only nuwa has the 3-branch ladder: main("playground") → staging →
> production; athena/phalo deploy single branches.
>
> **Railway provisioning state:** A0.1 DONE — project created from GitHub
> nuwa, first deploy intentionally failed (no DB/vars), prod service
> Source branch switched to `production`. User was creating the `staging`
> environment next (duplicate-from-production; knows it copies nothing
> while prod vars are empty → variables get pasted twice). STILL TO DO:
> A0.2 variables paste BOTH envs (full list in .env.example-shaped block in
> conversation; per-env diffs: DATABASE_URL `${{Postgres.DATABASE_URL}}`
> reference each, JWT_SECRET, SHOPIFY_TOKEN_KEY, SHIPLOGIC_WEBHOOK_SECRET
> — fresh `openssl rand -hex 32` each, never shared across envs) + each
> env its own PostgreSQL service; A0.3 generate public domains → then set
> `SHOPIFY_WEBHOOK_BASE_URL=<env's own domain>`; A0.5 admin seed via
> Railway CLI (`railway run --environment <env> -- npx prisma db seed`,
> ADMIN_1_* vars). **NODE_ENV is DELIBERATELY UNSET everywhere** (user
> decision): unset = guards off = test Paystack key boots; `CORS_ORIGINS`
> still set explicitly (unset would default to localhost and silently
> block Vercel athena in Phase B).
>
> **Phase D "arm the guards" checklist (one sitting, when Paystack KYC +
> TCG account land):** NODE_ENV=production; PAYSTACK_SECRET_KEY=sk_live_…;
> SHIPLOGIC_BASE_URL=https://api.portal.thecourierguy.co.za + real TCG key;
> final CORS_ORIGINS; create yiiva-prod Cloudinary cloud + 7 signed presets
> (prod currently borrows yiiva-dev values) per docs/cloudinary-setup.md;
> Paystack dashboard LIVE webhook URL → prod domain /payments/webhook.
>
> **Git state:** user committed + pushed `b29c685` (colour-variant→gallery
> batch + tsbuildinfo fix + Doppler CSVs) — working tree CLEAN. staging and
> production branches both exactly 3 commits behind main (c670cec shipping
> hardening, be76452 truth pass, b29c685) with nothing of their own →
> promotions are clean fast-forwards. Promotion ritual taught (checkout
> receiver → pull → merge → push → back to main; production only ever
> receives from staging). Sequencing advice given: finish A0.2 first (green
> deploy of old code), THEN promote (see a code-update deploy separately).
>
> **▶ NEXT:** user opens a NEW session for unrelated urgent work first —
> this deployment thread is PAUSED mid-A0. When resumed: finish staging
> env creation → A0.2 vars both envs → A0.3 domains → green deploys →
> branch promotion ritual → A0.5 seed → Phase B (athena→Vercel, user says
> Vercel; phalo→Railway later). Then Shopify prod test: register real
> merchant on prod via athena, connect Doppler store, verify 14 products/
> 3 collections/variant images/returnPolicyText/webhooksRegisteredAt, then
> live-sync edit test. Paystack KYC application still pending on user side.

---
>
> ## 2026-07-23 (later) — SHIPPING HARDENING: tracking-reconcile poller ·
> ## shippingSuburb snapshot · Q24 CLOSED via TCG reply + real payloads
>
> Courier-track focus session. nuwa: **824 tests / 67 suites green, tsc
> clean.** ⚠ **ALL of this is UNCOMMITTED in nuwa** (one coherent batch —
> suggested msg: "shipping hardening: tracking-reconcile poller (missed-
> webhook safety net) + admin trigger, Order.shippingSuburb snapshot →
> ShipLogic local_area, webhook extractors fixed against verbatim production
> payloads, Q24 closed (no signing), on 23/07/2026").
>
> **Tracking reconcile poller (the big one):** webhook delivery being
> unproven used to mean "missed webhooks freeze orders at CONFIRMED
> forever". Now: `ShipmentStatusApplyService` (apply pipeline EXTRACTED from
> the webhook handler — status map, Shipment/tracking-event writes, Order
> CAS guards, notifications — shared by both paths, so late webhook vs
> poller races no-op safely) + `ShipmentTrackingReconcileService` (cron
> :10/:40; polls `GET /shipments?tracking_reference=` for in-flight
> shipments untouched 45+ min, batch 50, per-shipment error isolation;
> unchanged rows get updatedAt touched → near-zero steady-state cost) +
> **`POST /admin/shipping/reconcile-tracking`** (ADMIN, on-demand sweep
> returning {candidates,updated,unchanged,failed} — the prod-smoke tool).
> Live-verified on dev (:3000): admin sweep ran clean. Drift now bounded to
> ~45–75 min even if production webhooks never fire.
>
> **Order.shippingSuburb snapshot** (migration `20260723170000_order_
> shipping_suburb`, BOTH DBs): checkout now snapshots the delivery
> address's suburb (auth path from Address; guest path — `GuestAddressDto`
> gained optional suburb → materialized Address) and shipment booking
> passes it as ShipLogic's `local_area` geocoding anchor (was hardcoded
> null → misgeocoding risk in outlying SA areas). Pre-migration orders:
> null, old behaviour. ⚠ maya follow-up: address form should COLLECT
> suburb (backend accepts it everywhere already). CLAUDE.md constraint
> updated to FIXED.
>
> **Q24 (webhook auth) CLOSED via TCG email reply + attachments** (saved in
> `docs/thecourierguy/`): (1) sandbox NEVER fires tracking webhooks —
> driver-scan-driven, no drivers scan test parcels (2026-06-03 zero-delivery
> mystery solved; reconcile poller = right call). (2) NO signing — support
> examples + both Postman collections + api-docs all show plain callback
> URLs; path-embedded secret + optional IP allowlist is the PERMANENT
> design (verifier slot stays reserved). (3) `TCGTrack_Webhook.txt` = 5
> VERBATIM production payloads → caught 2 real-shape extractor bugs:
> top-level hubs are EMPTY STRINGS and there's no top-level message in
> production — real location/message live in `tracking_events[]`. Extractors
> now read the newest status-matching event (buyer timeline gets "PIN
> entered successfully" / "At JNB hub" instead of blanks); verbatim real
> payload locked in as regression specs. `collection-failed-attempt`
> observed in the wild — correctly a status-map no-op. (4) the docx
> attachment is merchant education, nothing technical. Foundation doc §13/
> §14 updated throughout. **STILL OPEN from Q24 (one-line follow-up email,
> draft in foundation §14 discussion): outbound source-IP range + retry
> cadence.**
>
> **Run state:** dev nuwa :3000 (watch) + athena :3001 RUNNING (logs
> /tmp/nuwa-dev-3000.log, /tmp/athena-dev.log); demo nuwa :3005 running
> detached. athena/.env.local still → :3000 (dev); flip to :3005 for demos.
>
> **▶ NEXT:** (a) **COMMIT the shipping batch** (msg above); (b) send the
> TCG follow-up email (IP range + retry); (c) owner errands outstanding:
> Shopify Partner dev store + shpat_ token (Shopify e2e), TCG production
> account (shipping smoke); (d) then the production-env map (Railway,
> Paystack LIVE, prod DB seed, CORS, yiiva-prod Cloudinary, phalo deploy —
> see 2026-07-17 entry); (e) parked polish: maya suburb field,
> webhooksRegisteredAt on the Shopify connection view, genderSource counts
> in import preview.

---
>
> ## 2026-07-23 — SHOPIFY APP CAPACITY COMPLETE: nuwa Phases 1b+1c+2 +
> ## athena onboarding UI (both surfaces)
>
> The full Shopify merchant-onboarding capacity is BUILT end-to-end. nuwa:
> **813 tests / 66 suites green, tsc clean.** Committed in nuwa: Phases
> 1a–1c (`deae34a`) + Phase 2 (`0833ea5`). **UNCOMMITTED: nuwa 2-file delta
> (SHOP_NOT_FOUND) + ALL of athena's Shopify UI** (see athena/CHANGELOG.md
> top entry).
>
> **nuwa Phase 1b (catalogue pull + mapping):** `ShopifyCatalogueService` —
> paginated GraphQL pull (ACTIVE products/variants/images, collections+
> membership, locations; nested continuations resolved; cost-budgeted pages;
> sequential on one cost bucket; missing read_locations degrades to []).
> Importer heuristics ported to `src/shopify/mapping/` (pure; REAL
> inventoryQuantity w/ oversold clamp + untracked stand-in 20, weight-unit→
> grams, gender w/ provenance, 19-rule category tree). `GET /shopify/import/
> preview` (read-only; 400 SHOP_CURRENCY_UNSUPPORTED for non-ZAR).
>
> **nuwa Phase 1c (async import executor):** `POST /shopify/import`
> (optional defaultGenderType → applies ONLY to gender-silent products; 409
> IMPORT_ALREADY_RUNNING / STORE_NAME_TAKEN precheck) → ShopifyImportJob
> (CAS-claimed; polled at `GET /shopify/import/latest` + `/:id` 404-not-403).
> Existing store imported INTO, else DRAFT store created from shop identity
> (+ best-effort brand logo) → per-product server-side Cloudinary rehost
> (remote-URL upload, hash public_ids under stores/{id}/import/, resumable
> via overwrite:false, >10MB Shopify originals retry ?width=2048) → products
> ACTIVE w/ real stock, per-store-namespaced deduped variant SKUs,
> collection/category/tag links; image-less skipped; per-product failures
> counted not fatal; re-run = additive refresh (skips existing slugs);
> progress → job.summary every 10 products; starter banner for new stores.
>
> **nuwa Phase 2 (continuous sync):** migration `20260722153500_shopify_sync`
> (BOTH DBs): ShopifyProductLink (per-variant map incl. inventoryItemId),
> ShopifyWebhookEvent (audit+idempotency), connection cols (webhookSecret/
> apiSecretEncrypted/primaryLocationId/webhooksRegisteredAt). Receiver
> `POST /shopify/webhook/:secret` (per-connection path secret, 404 stealth;
> HMAC-SHA256 verified when merchant supplied the custom app's API secret —
> optional apiSecret on the connect DTO; raw-body SHA-256 idempotency;
> applier errors recorded + still acked 200). Auto `webhookSubscriptionCreate`
> (PRODUCTS_CREATE/UPDATE/DELETE + INVENTORY_LEVELS_UPDATE) after each
> completed import — **needs `SHOPIFY_WEBHOOK_BASE_URL` env (unset = sync
> disabled w/ warning, imports fine)**; unsubscribe on disconnect. Appliers:
> update → title/desc/status/price/stock (unlinked new variants logged only);
> create → GraphQL re-fetch through the shared ShopifyProductWriterService;
> delete → ARCHIVED (SA-4); inventory_levels → stock SET (primary location
> only). Nightly 03:00 reconcile cron (drift repair + archive-gone — the
> missed-webhook safety net). **Double-sell prevention:** PaystackWebhook
> post-payment hook fires ShopifyStockDecrementService
> (inventoryAdjustQuantities, best-effort, never blocks; PaymentsModule→
> ShopifyModule one-way import).
>
> **athena UI (UNCOMMITTED, this session — detail in athena/CHANGELOG.md):**
> (a) onboarding `/onboarding/shopify` + third intent-picker card: connect
> (custom-app guide accordion) → preview (counts/warnings/sample + default-
> gender picker) → importing (2.5s poller — athena's FIRST; stops on terminal
> status) → done → store wizard prefilled. Step DERIVED from server state
> (no stored step; reload resumes free; guard allows onboarding-intent AND
> wizard-draft since the import creates the DRAFT store mid-flow).
> (b) Settings "Shopify sync" section: shop card, latest-import block, inline
> import flow, Update token, two-step Disconnect. Plumbing: 4 user-scoped BFF
> routes, schemas/api/hooks, shared components in components/shopify/.
> **Bug fixed in athena api-client:** unrecognized-401 hard logout — pasting
> a bad Shopify token LOGGED THE MERCHANT OUT; SHOPIFY_TOKEN_INVALID is now
> carved out. **nuwa delta (UNCOMMITTED):** typo'd shop domain (Shopify HTML
> 404) was an opaque 500 → now 400 SHOP_NOT_FOUND (client + spec).
> **Verified live through the full BFF chain** (dev nuwa :3000 ↔ athena
> :3001): 401 guard, 404→null codes, INVALID_SHOP_DOMAIN, SHOP_NOT_FOUND,
> DTO arrays. athena tsc clean; lint errors are pre-existing dashboard-legacy.
>
> **Run state:** dev nuwa :3000 (watch) + athena :3001 RUNNING from this
> session (logs /tmp/nuwa-dev-3000.log, /tmp/athena-dev.log); demo nuwa :3005
> still running detached (fair feed). ⚠ **athena/.env.local now points at
> :3000 (dev/ayana)** — was :3005; flip back for sales demos.
>
> **▶ NEXT:** (a) **COMMIT athena** (all Shopify UI) **+ nuwa 2-file delta**;
> (b) browser walkthrough of the wizard (needs a store-less BUYER in ayana —
> register fresh or use maya-test after deleting its cart-history? simplest:
> new user); (c) **owner errand (the live-e2e blocker): Shopify Partner dev
> store + custom app (read_products/read_inventory/read_locations/
> write_inventory) + shpat_ token**; then full e2e: connect → preview →
> import → wizard → webhooks (needs cloudflared tunnel in
> SHOPIFY_WEBHOOK_BASE_URL) → decrement on a test order; (d) backend
> nice-to-haves flagged during UI build: expose webhooksRegisteredAt on the
> connection view (settings shows static sync copy for now), genderSource
> counts in the preview (true "unclassified" number); (e) then the rest of
> the production-env map (Railway, Paystack LIVE activation, ShipLogic prod
> smoke, phalo deploy — see 2026-07-17 entry).

---
>
> ## 2026-07-22 — Payouts (Phase 6) DONE · commission 2.5% · PayFast purged ·
> ## Shopify onboarding Phase 1a
>
> Everything below through "PayFast sweep" is COMMITTED; **Shopify Phase 1a
> is UNCOMMITTED** (nuwa only). nuwa: **702 tests / 57 suites green, tsc
> clean.** Demo :3005 running this build (fair feed).
>
> **Paystack payouts (migration Phase 6) — COMPLETE + live-verified:**
> merchants onboard a bank once (`POST /stores/:id/payout-account`, 33 SA
> banks via /banks; subaccount at Paystack, we keep code + bank/last4 only) →
> checkout attaches a per-transaction FLAT multi-split (verified to the cent:
> R1,260 subtotal → R1,228.50 to FIELDS' test subaccount ACCT_zylcsf9tuii9h2g,
> split SPL_aERVf7WZyt). PS-8 DECIDED: bearer `all-proportional` (at 2.5%
> commission YIIVA is margin-negative on cards otherwise). PS-3 v1: refunds
> pull from main balance; clawback = manual ops. Unconfigured stores' shares
> stay on main balance (manual payout, incremental onboarding); split failure
> degrades gracefully (buyer checkout never blocked). athena: NEW
> "Automatic payouts" section in Settings (settlement-account-section.tsx +
> BFF + hooks; prefills from legacy bank fields; legacy PayoutSection kept
> for the review record).
>
> **Commission 5.5% → 2.5%** (early-adopter strategy; `COMMISSION_RATE` in
> order/checkout/totals.ts; historical Payment rows keep their locked rate).
> See `commission-rate` memory.
>
> **PayFast dependency audit: ZERO functional deps anywhere.** Swept 39 stale
> comments/spec-titles + the admin error string to provider-neutral; purged 9
> inert PAYFAST_ vars from .env. Remaining mentions = deliberate history.
> ⚠ The buyer WEB frontend (separate repo) still expects the deleted
> `payfast:{actionUrl,fields}` block — must adopt `payment.redirect` pre-launch.
>
> **Shopify onboarding (docs/shopify-app/shopify-app-foundation.md) —
> Phase 1a BUILT (UNCOMMITTED):** goal = 3–5-click merchant onboarding.
> SA-1 decided: nuwa module (`src/shopify/`). SA-2: merchant-created
> custom-app Admin token first, OAuth later. Shipped: ShopifyConnection +
> ShopifyImportJob models (migrated BOTH DBs), AES-256-GCM token crypto
> (SHOPIFY_TOKEN_KEY in .env, 64-hex), GraphQL-only ShopifyClient (API
> 2026-07, cost-aware THROTTLED retries, 401→reconnect), and
> `POST/GET/DELETE /shopify/connection` (live token validation before
> storing, domain normalization, canonical-domain trust, cross-account
> guard, ZAR-only currencySupported flag). 20 new tests.
>
> **▶ NEXT:** (a) commit Shopify Phase 1a; (b) **Phase 1b**: paginated
> catalogue pull (products/variants/images/collections/locations) + port the
> demo importer's mapping heuristics (gender, CATEGORY_RULES 19-cat tree,
> options) into `src/shopify/mapping/`; then 1c: async import job → Store/
> Products/Variants + Cloudinary rehost (server-side upload from Shopify CDN
> URLs — no disk), store lands in DRAFT→review. Import must REFUSE non-ZAR
> shops. (c) Owner errand: Shopify Partner dev store + custom app
> (read_products/read_inventory/read_locations) + shpat_ token for live e2e.
> (d) Later: onboarding UI ("clicks 1–5" discussion pending), Phase 2 sync +
> stock decrement, Paystack LIVE activation, production env plumbing,
> ShipLogic prod smoke, phalo deploy.

---
>
> ## 2026-07-21 — PAYSTACK MIGRATION COMPLETE (Phases 1–5, PayFast deleted)
>
> **The platform's payment provider is now Paystack, end-to-end verified in
> test mode.** All six build phases from the foundation doc are done except
> splits (Phase 6, post-launch by design). **UNCOMMITTED in nuwa + maya +
> athena.**
>
> **What shipped (nuwa):** PaystackConfig (mode from key prefix, prod guard) ·
> typed PaystackClient (initialize/verify/refund) · PaystackService behind
> contract v3 (provider-neutral `redirect`, `reference`, channels) · webhook
> pipeline `POST /payments/webhook` (HMAC-SHA512 raw-body, PaymentEvent
> idempotency, CAS, CANCELLED-stays-CANCELLED, fees→amountFee/NetInCents) ·
> refunds (admin flow, no accType) · Paystack reconcile (verify-by-reference)
> · **cutover**: PAYMENT_SERVICE→PaystackService, `src/payments/payfast/` +
> ITN pipeline DELETED (~225 tests went with it — suite now 669/53 green),
> TRUST_PROXY read directly in main.ts, .env.example + CLAUDE.md rewritten
> (new "Paystack integration patterns" + test-mode smoke-test sections).
>
> **Verified against the real test account:** key live-checked · webhook
> delivery + signature on real traffic (charge.success AND refund.pending)
> · **full 3-store maya checkout** → group COMPLETED (fees recorded R217.07
> on R6,474), 3 orders CONFIRMED+confirmedAt, 3 ShipLogic waybills booked,
> notification sent · admin partial refund R100 accepted (PS-1: refunds WORK
> in test mode). ⚠ refund.processed webhook for the real order not yet
> observed (test-mode lag; confirmation-only by design — books already
> correct). Tunnel gotcha: Paystack's dashboard REJECTS ngrok's
> .ngrok-free.dev URLs — use cloudflared (*.trycloudflare.com).
>
> **maya:** payment step REDESIGNED (real method selector: Add card/Pay with
> card default + Pay by bank (Ozow) + SnapScan, each mapping to a live
> Paystack channel end-to-end via dto.paymentMethod→channels; Payflex = the
> one Soon row; apple_pay dropped — channel inactive on the account, re-add
> when enabled) · `app/payfast.tsx`→`app/payment.tsx` (GET-redirect WebView,
> legacy form-flow fallback removed) · api-client types cleaned.
>
> **athena:** refund modal loses the bank-account-type field; reconcile panel
> + zod schema rewritten for the Paystack response shape (see CHANGELOG top
> entry).
>
> **▶ NEXT:** (a) **COMMIT all three repos**; (b) rest of the production-env
> map (Railway, prod DB seed, CORS, yiiva-prod Cloudinary, Resend, phalo
> first commit, maya prod checklist — see 2026-07-17 entry below); (c)
> Paystack LIVE activation when ready (business KYC → live key; config
> refuses test keys in prod); (d) parked: splits Phase 6 (kills the Payout
> backlog item), PS-5 column renames (mPaymentId/pfPaymentId/itnHash are
> semantic legacies), web frontend (separate repo) still expects the old
> `payfast` checkout block — must adopt `payment.redirect` before web
> checkout ships.

---

> ## 2026-07-17 — PRODUCTION PHASE BEGINS + Paystack decision
>
> **Owner declaration: demos are done — all work in all four repos now
> targets the LIVE platform.** Demo env (yiiva_demo/:3005, 28 brands,
> spotlight tooling) remains a local sales tool only. All demo-era work
> through 2026-07-17 committed in nuwa/maya/athena (incl. the 07-10→07-17
> post-handoff additions: spotlight-in-trending, brand-name search via
> compacted slug, gift-card exclusion + underwear category, gender-aware
> category covers, brand-diverse new-arrivals, netterose/koikoi logo fixes,
> reels for 9 more brands — 24/28 video-led).
>
> **DECIDED: PayFast → Paystack** for production payments (research-backed;
> also evaluated Stitch). Full decision record, verified pricing/API facts,
> contract-v3 design, webhook mapping, 6-phase plan, open questions PS-1…7
> and the Stitch re-evaluation trigger: **NEW
> `docs/payments-module/paystack-migration-foundation.md`** — start the
> build from there (Phase 1: PaystackConfig + PaystackClient; verify PS-1
> test-mode refunds immediately). Also NEW earlier:
> `docs/shopify-app/shopify-app-foundation.md` (merchant onboarding asset).
>
> **▶ NEXT:** (a) Paystack Phase 1–2; (b) production env plumbing (Railway,
> prod DB + category seed, CORS_ORIGINS, yiiva-prod Cloudinary, Resend,
> TRUST_PROXY); (c) phalo first commit (still ZERO commits!) + phalo_rw
> role; (d) maya prod checklist (NSAllowsArbitraryLoads removal, prod API
> URL, push on dev build, reels fixtures decision, dead-code cleanup);
> (e) ShipLogic prod smoke plan. Production-gap map in the
> `production-phase` memory + CLAUDE.md constraints.

---
>
> ## 2026-07-09 — Discovery-feed algorithm + FIELDS demo package + 7 new
> ## demo brands (15 total)
>
> Big feature/bug day across nuwa + maya prepping the FIELDS in-person pitch
> (owner demo'd + sent them an unlisted video). **ALL UNCOMMITTED in both
> repos** (incl. the 07-07 collection-cover fallback below). nuwa: **841
> tests / 58 suites green, tsc clean.** maya: tsc clean (known VideoCard
> error only), lint clean. maya detail: maya/status.md top entry.
>
> **nuwa — discovery feed rewritten (mobile-products.service.ts):**
> - NEW `queryDiscoveryPage`: brand round-robin + seeded shuffle. Round r =
>   each store's r-th newest item; order by (round, sha1(seed:productId)).
>   Cursor is now `d1:{seed}:{offset}` (cursor.ts `encodeDiscoveryCursor`) —
>   opaque to maya, so ZERO client changes; fresh load reshuffles, scroll
>   stays stable. Applied to `feed()` + `searchByCategory()` (browse
>   surfaces). Text search / smart-category / merchant catalogue stay on
>   recency (`queryFeedPage` untouched). Fixes "category view = one brand's
>   whole drop in upload order". ⚠ id-scan per page — fine at demo scale,
>   precompute when catalogue grows (lettersWithBrands precedent).
> - NEW **spotlight variant** (`querySpotlightDiscoveryPage`, env-only):
>   `FEED_SPOTLIGHT_STORE=<slug>` (+`FEED_SPOTLIGHT_WEIGHT`, default 3) gives
>   one brand `weight` slots per round — ~3× frequency, shuffled, no visible
>   pattern. Built for the FIELDS pitch; reusable for any brand pitch.
>   Documented in .env.example. Unset env → byte-identical standard path.
> - **Trending search chips** (mobile-search.service.ts) — replaced junk
>   `#Shopify-tag` output (`#1KG`, `#AW24`…) with curated realistic vocab +
>   top-3 brand names, **catalogue-validated** (term must match ≥3 live
>   products via searchUniversal's rule — every chip lands), daily-seeded
>   rotation of 8, 1h in-process cache. Still the Phalo trending_searches
>   seam.
> - **`similar()` is now brand-scoped** — same store's other ACTIVE products,
>   newest first (was cross-brand same-gender). ⚠ single-product merchants
>   → empty rail (fallback parked). maya header still says "Similar Items";
>   "More from this brand" copy offered, not taken yet.
> - **Gender-aware Home category cards** (mobile-categories.service.ts) —
>   gendered `GET /api/categories` now serves each chip's image from the
>   newest matching-gender product (UNISEX both tabs); seeded
>   Category.imageUrl = fallback + ungendered surfaces. Women vs men differ
>   on 19 card images (verified live).
> - **`categoryCovers` on merchant-products** — additive per-category
>   brand-own cover (like the 07-07 collection fallback). maya uses it on
>   the brand profile's Categories rail, **gated to fieldsstore** (owner
>   scope); drop the gate to roll out to all brands.
>
> **Demo env (yiiva_demo): 7 NEW BRANDS SEEDED → 15 total.** Full pipeline
> (extract→transform→curate cap-50 nav-aware→rehost 1,343 imgs→load) +
> relink (586 links) + regender (map in regender.ts extended: klothandkin/
> 5thavefashion/hannahlavery silent→WOMEN; rest UNISEX; ACTIVE dist now
> 240W/105M/271U) + renav. New logins `<slug>@demo.yiiva.co.za`/`DemoPass1`:
> wildthingsco (7 products — tiny), klothandkin, 5thavefashion (display name
> carries site's "S3-25" tag), wearegods, artclubandfriends, sobroke (⚠ 3
> duplicate "SHOP NOW" tabs, faithful to their nav), hannahlavery. All
> verified via A–Z + profiles + feed mix. **NOT run: seed-orders** (would
> wipe demo order history mid-FIELDS-followup) — new brands have no orders.
> No hero videos yet — `rebanner` when owner supplies reels.
>
> **Run state:** demo nuwa :3005 RUNNING detached **with
> `FEED_SPOTLIGHT_STORE=fieldsstore`** (log /tmp/demo-nuwa-3005.log; stop:
> `lsof -ti :3005 | xargs kill`). ⚠ Restart WITHOUT the env var to restore
> the fair feed once the FIELDS window passes.
>
> **2026-07-10 addendum — Shopify-app research:** NEW
> `docs/shopify-app/shopify-app-foundation.md` — feasibility research
> (verified vs shopify.dev) + design sketch for a Shopify app that onboards
> merchants with their real catalogue/inventory (the consent-based
> productionisation of the demo importer). Key findings: v1 import + v2
> webhook sync fully feasible + review-free via custom distribution;
> GraphQL-only (REST is legacy); ⚠ order-push-back-into-Shopify is
> policy-gated (external checkout disallowed for new public apps) — parked
> as Phase 4; compliant workaround = `inventoryAdjustQuantities` stock
> decrement. Open questions SA-1…SA-6 in the doc. NOT scheduled — research
> only, no code.
>
> **▶ NEXT:** (a) **COMMIT nuwa + maya** (this + 07-07 fallback below —
> suggested nuwa msg: "discovery feed round-robin + spotlight, trending
> chips, brand-scoped similar, gendered category covers + 7 demo brands");
> (b) parked: seed-orders for new brands, sobroke tab labels +
> 5thavefashion display-name cleanups, hero reels for the 7, "More from
> this brand" copy, new-release-notification plumbing (maya's Subscribe
> popup now PROMISES it — enum NEW_FOLLOWER exists, nothing fires on
> product publish), single-product similar-rail fallback.

---

> ## 2026-07-07 — Collection-cover fallback (maya brand-page redesign support)
>
> Post-demo maya UI session (detail in **maya/status.md** — brand page now has
> a Collections/Categories toggle + card rails + full-screen browse sheet).
> nuwa's one change (UNCOMMITTED): **collection cover image fallback** in
> `MobileMerchantsService.getProfile` — when a StoreCollection has no
> merchant-set `imageUrl`, the profile serves the primary image of one of its
> ACTIVE products as `collections[].image`. Read-time only (no DB writes;
> merchant-set covers always win; works for all future merchants). Before:
> 5 of 8 demo brands had gaps (embedded 0/5, FOM 33/88). After: **100%
> coverage, all 156 tabs across 8 brands** — verified live on :3005.
> +1 spec test (mobile-merchants suite → 17). **830 tests / 58 suites green,
> tsc clean.** Demo :3005 RUNNING this build.
>
> Also audited for the "Subscribe" vocabulary pass (UI-only, decided
> 2026-07-07): nuwa has NO user-facing "follower" copy — NEW_FOLLOWER is
> enum-only with no template/dispatch. When that notification ships, write
> its copy as "subscriber". API/schema vocabulary stays "follow" everywhere.
>
> **▶ NEXT:** commit (this + anything left from 2026-07-06 below); maya
> follow-ups live in maya/status.md.

---
>
> ## 2026-07-06 — Merchant-demo feature day: admin orders UI, variants, live
> ## analytics, earnings, promotions (sales), low-stock, returns + demo seeding
>
> **Theme:** built the athena gaps for tomorrow's in-person brand demos — all
> MVP-bound. **UNCOMMITTED in BOTH nuwa and athena** (athena detail:
> athena/CHANGELOG.md top entry). nuwa: **829 tests / 58 suites green, tsc
> clean.** Everything below verified live end-to-end (nuwa :3005 → athena BFF).
>
> **nuwa new endpoints (all follow existing conventions, all spec-tested):**
> - `GET /stores/:id/analytics` (`src/store/analytics/`) — live-computed KPI
>   feed for athena's dashboard (14d revenue/orders series + trends vs prior
>   14d; followers/products/rating flat sparks). Phalo Phase 3 later replaces
>   the internals behind the SAME shape.
> - `GET /stores/:id/earnings` (`src/store/earnings/`) — accrued money
>   visibility from Payment rows (gross/5.5% commission/payout/refunded;
>   lifetime + month summaries; month-scoped ledger, cursor-paginated).
> - `GET /stores/:id/inventory/low-stock` (`src/product/inventory/`) —
>   variant- + reservation-aware items at/below `lowStockThreshold` (now
>   merchant-editable via UpdateProductDto).
> - **Sale campaigns** (`src/product/sale/`, migration
>   `20260706095805_sale_campaigns_and_returns` — applied to BOTH DBs):
>   `GET/POST /stores/:id/sales`, `GET :campaignId`, `POST :campaignId/end`.
>   Applying discounts priceInCents (+ variant overrides) and parks originals
>   on comparePriceInCents; end/cron-sweep restores (hand-edits win). One live
>   sale per product; R1 floor; NEW `SaleCampaign`/`SaleCampaignProduct`
>   models. The old `Promotion` model stays reserved for future checkout promo
>   codes — checkout money math untouched.
> - **Returns v1** (`src/order/returns/`, same migration — NEW `ReturnRequest`
>   model): buyer `POST/GET /api/orders/:id/returns` (30d from delivery, per
>   eligible DELIVERED child order); merchant `stores/:id/returns` list +
>   approve/reject/received/close. Money movement stays on the admin refund
>   tool. Buyer notifications on approve/reject = follow-up.
> - **Admin order detail** now exposes `payment.refundedAmountInCents` +
>   `payment.paymentGroup {id, mPaymentId, status}` (feeds athena's refund +
>   reconcile UI).
> - **BUG FIX (payments):** the ITN flow set Order → CONFIRMED without
>   `confirmedAt` (and system-cancels without `cancelledAt`) — broke maya's
>   `cancellationEligibleUntil`, timeline rows, and analytics bucketing.
>   Fixed in `payments-notify.service.ts`; demo DB backfilled (YV-2026-W4413).
>
> **athena (see athena/CHANGELOG.md):** `/admin/orders` (list + detail with
> force-confirm/cancel/edit/refund/reconcile), product-editor Variants
> section, live `useStoreAnalytics` (PHALO SWAP POINT swapped, sample
> fallback kept), `/dashboard/earnings` (+CSV export), `/dashboard/promotions`,
> `/dashboard/returns`, Overview Stock-alerts card. AppShell nav: +Returns,
> +Earnings, +Promotions; admin nav: +Orders.
>
> **Demo env prepped (yiiva_demo ONLY):** NEW importer command **`seed-orders`**
> (`tools/demo-importer/src/stages/seed-orders.ts`) — demo order history with
> real commission math, 4 demo buyers
> (`naledi/sipho/lerato/thandi.demo@demo.yiiva.co.za` / `DemoPass1`,
> orderNumbers `YV-2026-D····`, accountStatus ACTIVE), seeded returns —
> re-run = wipe+reseed, real buyer untouched. LIVE sale left running:
> Tol'thema "Winter Warmers — 20% off" (4 products). PayFast-sandbox notes:
> reconcile + refunds only work in production (sandbox 401s the APIs).
>
> **▶ 3 FOCUS BRANDS RESEEDED for the 2026-07-07 demos** (same session, later):
> **fieldsstore** (fresh re-extract, 50 products/187 variants/20 tabs all with
> covers, 3 hero videos preserved), **breazies** (NEW — 50 products/10 tabs),
> **freedomofmovement** (NEW — 50 products, renamed from vendor "FOM SA",
> 88 visible tabs of their 129-link mega-menu — ⚠ busy; trim via
> `StoreCollection.showOnProfile` if owner wants). All logins
> `<slug>@demo.yiiva.co.za` / `DemoPass1`. `seed-orders` re-run: **151 orders
> across all 8 stores** + 5 returns. Importer upgrades this pass:
> `curate --cap N` (default 50) with **nav-coverage-aware selection** +
> collection trimming (junk guard vs FOM's 1,064 collections), `curate
> --force` re-bootstrap that preserves curated `videos[]`, rehost
> **oversize-image downscale retry** (fixes the old fieldsstore 14MB
> collection-cover failure permanently). Pre-reload FK cleanup required
> deleting fieldsstore's old orders incl. the sandbox smoke-test order
> YV-2026-W4413 (acceptable loss; ITN proof is in git history/logs).
> **Hero media DONE (2026-07-07 morning):** owner supplied 3 IG reels per
> brand → rehosted (yt-dlp, Chrome cookies) → applied via NEW importer
> command **`rebanner <slug…>`** (`src/stages/rebanner.ts`) which re-applies
> StoreBannerMedia from curated `videos[]` IN PLACE — the post-load hero
> workflow now that loaded stores carry FK'd orders and can't be reloaded.
> All 3 profiles lead with a video cover (3 videos + 2 images each); order
> history verified intact.
>
> **Run state:** demo nuwa :3005 RUNNING detached with this build (log
> `/tmp/demo-nuwa-3005.log`; stop: `lsof -ti :3005 | xargs kill`). athena:
> `npm run dev` (`.env.local` → :3005). Merchant logins
> `<slug>@demo.yiiva.co.za` / `DemoPass1`; admin `khanyisomthamo2@gmail.com` /
> `khanyi@Admin26`.
>
> **▶ NEXT:** (a) commit both repos (suggested split — nuwa: "merchant money
> +ops endpoints: analytics, earnings, sales, low-stock, returns + ITN
> confirmedAt fix"; athena: "admin orders + variants + live analytics +
> earnings/promotions/returns/low-stock"); (b) DEMO DAY — if anything misfires,
> restart :3005 per Run state above; (c) follow-ups parked: buyer notifications
> on return approve/reject, `lowStockThreshold` field in the product editor
> Basics UI, payout disbursement records (Payout model), promo codes at
> checkout, per-item returns v2, maya returns UI + on-sale strikethrough
> serializer field.

---

> ## 2026-07-04 — Brand-page collection tabs (mirror merchant site nav) + importer `renav`
>
> **Theme:** the maya brand/merchant profile page now sorts its catalogue by the
> merchant's OWN collections, mirroring each brand's site navigation (owner
> requirement: "the tabs must mirror those on their site"). nuwa serves the
> data; the importer's new nav scraper makes demo data match each live site.
> **UNCOMMITTED in nuwa** (maya's tab UI also uncommitted — maya/status.md).
>
> **nuwa changes (96 mobile tests green, tsc clean, verified live on :3005):**
> - `GET /api/merchants/:username` → new **`collections[]`** (slug, name,
>   image, productCount) — ordered `sortOrder` asc, only `showOnProfile` rows
>   with ≥1 ACTIVE product. Serializer: `toMerchantProfile` (+2 spec tests).
> - `GET /api/merchants/:username/products?collection=<slug>` — store-scoped
>   collection filter (slugs are only unique per store).
> - Migration `20260704113000_store_collection_show_on_profile` —
>   `StoreCollection.showOnProfile Boolean @default(true)` — **applied to BOTH
>   `ayana` and `yiiva_demo`**. Additive; web/admin surfaces unaffected.
> - Importer: the homepage scrape (existing logo path) now also parses the
>   site nav for `/collections/<slug>` links → `navCollections[]` in
>   storefront.json (header/nav-scoped, product links + image-only anchors
>   excluded, first-occurrence dedupe). NEW command **`renav [brands…]`**
>   (`src/stages/renav.ts`) mirrors nav onto loaded StoreCollections IN PLACE
>   (no wipe-reload): matched → visible + nav order + **nav label wins over
>   collection title**; unmatched → `showOnProfile=false` (nothing deleted —
>   products stay reachable under maya's All tab); no nav found → brand left
>   untouched. Falls back to cached storefront.json when a site is down.
> - **Ran `renav` on all 6 demo brands against their live sites:** tolthema
>   30 collections → 8 tabs, suhu 14 → 8 (junk "Home page" gone), sakanya's
>   first tab reads "New" (their nav label for spring-summer-25). End-to-end
>   verified: profile tabs → `?collection=` filter returns correct products.
> - Known data warts (faithful to the sites; per-brand curate override is a
>   possible later add): embedded shows "Sets" twice (mega-menu dupe labels);
>   madebyfade "Shop" / fieldsstore "Start shopping" catch-all tabs.
> - Post-load housekeeping for new brands is now: `seed-demo` + `relink` +
>   `regender` + **`renav`**. Foundation-doc sections for all three re-*
>   commands still unwritten (self-documenting; add when convenient).
>
> **maya this session (see maya/status.md):** collection-tab UI on
> `app/artist/[artistId].tsx` (UNCOMMITTED) + the 2026-07-03 screen-upgrade
> round 2 (cart/3-step checkout/orders/track/wishlist/notifications/account/
> chat/shop + new category screen) which the owner committed at `dd0bd77`.
>
> **Run state:** demo nuwa :3005 is running DETACHED with this build (nohup,
> log `/tmp/demo-nuwa-3005.log`; stop: `lsof -ti :3005 | xargs kill`).
>
> **▶ NEXT:** (a) commit both repos ("brand-page collections mirror site nav");
> (b) **CONTINUE MERCHANT PROFILE PAGE work — the owner's stated next focus**;
> (c) on-device pass of the tabs (compare each demo brand against its site);
> (d) still-parked: nuwa new-arrivals `username` one-liner, notification/email
> "purchase" copy pass, Auth screens round-2 polish.

---

> ## 2026-07-02 — SDK 54 + maya screen-upgrade round + category taxonomy v2
>
> **Theme of the session:** maya visual/UX upgrades screen-by-screen (post-
> redesign round 2) + the demo-data work needed to make Home's categories and
> gendered feeds real. **EVERYTHING UNCOMMITTED in both repos** — commit next
> session (suggested split: nuwa "categories taxonomy v2 + importer relink/
> regender"; maya "SDK 54 upgrade" + "screen upgrade round: purchase vocab,
> SideMenu/Home/Search/product/brand").
>
> **nuwa changes (all verified: tsc clean, 94 mobile tests green):**
> - `MobileCategoriesService.list` now **gender-filters category chips** —
>   a category shows under a tab iff it has ≥1 ACTIVE product of that gender
>   (UNISEX in both, same `genderFilterValues` rule as the feed). +3 spec tests.
> - Demo importer: `CATEGORY_RULES` rewritten (18 ordered rules from a
>   50-brand / 5,386-product sweep of `data/brand_listing.xlsx`); `seed-demo`
>   seeds the 18-category tree WITH Cloudinary card images
>   (`demo/categories/<slug>` — real brand product shots); NEW commands
>   **`relink`** (re-derive ProductCategory links, no wipe-reload) and
>   **`regender`** (per-brand default genderType for gender-silent products;
>   map + reasoning in `src/stages/regender.ts`).
> - Demo DB (`yiiva_demo` ONLY — see divergence note below): seeded + relinked
>   (196 products, legacy `bottoms` deleted), regendered (88 WOMEN / 40 MEN /
>   71 UNISEX), product timestamps jittered over 45d (feed brand-interleave),
>   Embedded `logoUrl` → `e_colorize` ink transform (white-on-transparent
>   wordmark was invisible on maya's white logo coins).
> - Verified live: women tab = 15 chips (incl. Dresses/Jewellery), men = 14
>   (incl. Hoodies/Footwear, no Dresses); feeds diverge from page 1.
> - **Flagged one-liner for next nuwa pass:** add `username` to the
>   new-arrivals merchant serializer (`/api/products/new-arrivals`) — maya's
>   rail artist-link is disabled until it exists.
> - **Pending copy decision:** notification/email templates still say "order"
>   — maya UI now says "purchase" everywhere (see maya/status.md). Same-style
>   copy pass on nuwa templates when ratified.
> - Foundation-doc sections for relink/regender not yet written (commands are
>   self-documenting; add §22 when convenient).
>
> **Run state:** demo nuwa on :3005 is running **DETACHED** (`nohup`, pid
> 38263, log `/tmp/demo-nuwa-3005.log`) because session-tracked instances kept
> getting killed. Stop: `lsof -ti :3005 | xargs kill`. maya `.env` now points
> at the Mac's **LAN IP** (`http://192.168.10.18:3005`) for physical-device
> testing — IP changes with the network; swap back to localhost for
> simulator-only sessions.
>
> **maya this session:** Expo **SDK 54 upgrade** (see maya/status.md — the
> Expo Go device error forced it; nativewind unpinned to ^4.2) + screen
> upgrades: SideMenu rebuilt, Home (2:3 cards, skeleton parity, ST-9 See-All,
> ink tab tint), **order→purchase UI copy sweep**, Search (real gendered
> categories in browse + category-endpoint search + Cancel/UX list), Discover
> reels mosaic (staggered running grid, gradient scrims, expo-linear-gradient
> added), product page (emoji→icons, share wired, dead CTAs removed, Similar
> Items → shared rail), brand page (hero-video autoplay-on-swipe FIXED — the
> old backlog bug — + mute propagation, pill category chips, EvenGrid 2:3).
>
> **▶ NEXT:** (a) commit both repos; (b) continue maya screens: Cart,
> Checkout, Orders/Track, Wishlist, Shop, Notifications, Account, Chat, Auth;
> (c) deferred: @gorhom/bottom-sheet decision (checkout address picker +
> contact modal), nuwa new-arrivals `username` one-liner, nuwa
> notification/email "purchase" copy, "pay later" section copy decision
> (promises Payflex/Mobicred that checkout doesn't offer).

---

> ## ⚠️ 2026-07-02 — DEMO-DB vs DEV-DB DIVERGENCE (read before touching :3000)
>
> The **category taxonomy v2 + gender curate** work was applied ONLY to the
> local demo env (`yiiva_demo` DB / server :3005). The dev DB (`ayana`) and
> dev server (:3000) were NOT touched and still carry the old 4-category seed
> (dresses/tops/bottoms/sets) and mostly-UNISEX genderType data.
>
> **What demo got (via new importer commands, all in `tools/demo-importer/`):**
> - `seed-demo` (updated): **18-category tree** derived from a 50-brand /
>   5,386-product sweep of `data/brand_listing.xlsx`; card images = real brand
>   product shots on Cloudinary (`yiiva-dev` → `demo/categories/<slug>`).
>   Legacy `bottoms` deleted.
> - `relink` (NEW command): re-derives ProductCategory links for loaded brands
>   from manifests using the rewritten `CATEGORY_RULES` (18 ordered rules) —
>   no wipe-and-reload (reloads would break the FK'd real order YV-2026-W4413).
> - `regender` (NEW command): per-brand default genderType for gender-silent
>   products → demo is now **88 WOMEN / 40 MEN / 71 UNISEX** (map + reasoning
>   in `src/stages/regender.ts`; tolthema/embedded/sakanya→WOMEN,
>   madebyfade→MEN, suhu/fieldsstore stay UNISEX).
> - One-off SQL: product `createdAt`/`publishedAt` jittered over 45 days so the
>   recency feed interleaves brands (batch loads had clustered per-brand).
>
> **Why this can bite later — the CODE side applies everywhere:**
> `MobileCategoriesService.list` (src/mobile/categories/) now **filters
> categories by gender tab** — a category renders a chip only if it has ≥1
> ACTIVE product of that gender (UNISEX counts for both; same
> `genderFilterValues` rule as the feed). 4 new spec tests. Running this code
> against `ayana` (or prod) with un-curated data → **few/zero category chips
> and near-identical Women/Men feeds**. That is data starvation, NOT a bug.
> Before relying on dev/:3000 (or launching prod): give that DB the same
> treatment — `seed-demo` + `relink` + `regender` with DATABASE_URL pointed at
> it (or an equivalent admin-driven category setup + gender curate).
> Also note: manifests on disk keep stale `suggestedCategorySlug` — re-run
> `transform` before any future `load` of the 6 existing brands.
>
> Uncommitted: all of the above (importer + nuwa service/spec) + maya's SDK-54
> upgrade + screen upgrades (see maya/status.md). Same note added to
> maya/status.md + athena/CHANGELOG.md.

---

> 🟢 **HANDOFF (previous) — 2026-06-26.**
>
> ## 2026-06-26 — Search reels (maya) + session close
>
> **Backend (nuwa): clean + committed** at `d4ba296` ("2nd round of mobile
> integration, notifications and payfast works"). The 2026-06-22 work below
> (My Orders, Notifications A+B, PayFast smoke test) is all merged. nuwa
> `CLAUDE.md` now documents the Notifications module + `GET /api/orders` +
> `PushToken`. **776 tests / 53 suites green.**
>
> **maya: reels feature is UNCOMMITTED** (HEAD `312168e`). New "reels" surface
> on the Search screen + a full-screen TikTok-style feed. Files: `app/reels.tsx`,
> `components/ReelCard.tsx`, `components/ReelsGrid.tsx`, `lib/reels-fixtures.ts`,
> `assets/reels/` (9 bundled product mp4s), modified `app/(tabs)/search.tsx`.
> Full detail in **`maya/status.md`** (frontend). Phase 1 = static fixtures with
> REAL `yiiva_demo` product data baked in (so "Buy" → live product detail); next
> phase makes it a dynamic backend feed.
>
> **⚠️ Hard-won learning (documented in maya/CLAUDE.md footguns):** `expo-video`
> `VideoView` renders **black / zero-sized with `StyleSheet.absoluteFill`** — it
> needs **explicit `width/height: '100%'`** (like the artist/product screens).
> Also `expo-video` won't play a bare `require()`'d asset number here (Expo Go);
> resolve to a URI via `Asset.fromModule(mod).uri`. expo-IMAGE accepts require
> numbers; expo-VIDEO does not.
>
> **Run state:** demo nuwa (:3005) and ngrok are STOPPED (killed at session
> close). To resume: `PORT=3005 DATABASE_URL=<yiiva_demo> npm run start` from nuwa.
>
> **▶ NEXT:** commit the maya reels feature; confirm reels playback on reload
> (the VideoView sizing fix was the last change — visually unverified by Claude);
> then either make reels dynamic (backend feed) or continue the Search screen work.
>
> ---
>
> ## 2026-06-22 — My Orders + Notifications + PayFast smoke test ✅ (committed d4ba296)
>
> **All work is on the demo env: nuwa :3005 → `yiiva_demo` DB, maya → :3005.**
> **Backend 776 tests / 53 suites green, tsc clean. maya tsc clean (pre-existing
> VideoCard error only). NOTHING COMMITTED YET — working trees dirty in both
> nuwa + maya.**
>
> **▶ MY ORDERS (new):** `GET /api/orders` — buyer order history, lists
> **consolidated PaymentGroups** (row `id` = paymentGroupId, so it feeds the
> existing detail/cancel/tracking endpoints), cursor-paginated, newest first.
> nuwa: `mobile/orders/` (dto + service `listOrders` + controller + 2 specs).
> maya: `getOrders`/`OrderListItem` (api-client), `useOrders` hook, **new
> `app/orders.tsx`** (status chips, relative dates, infinite scroll), **new
> `app/account.tsx`** (signed-in hub: profile + view-only addresses + sign out;
> "My orders" row → `/orders`). SideMenu "Account" link now resolves.
> maya doc `docs/api/orders.md §3` filled in.
>
> **▶ NOTIFICATIONS MODULE (Phase A+B, new — the mobile-launch blocker):**
> - **A (emails + inbox rows):** new `@Global` `src/notifications/`
>   (`NotificationsService` orchestrator + `PushService`). Best-effort dispatch
>   (inbox row + Resend email + Expo push; a failure NEVER breaks the calling
>   flow). 5 order email templates + generic `EmailService.send`. Wired into:
>   payments-notify (confirmed/failed), shipping-webhook (shipped/delivered, only
>   on real CAS transitions), buyer-orders + admin-orders (cancel), admin refund.
>   `NotificationType` enum reused — no enum change. `data.orderId` = PaymentGroup
>   id for deep-linking.
> - **B (push + inbox surface):** new `PushToken` model + migration
>   `20260622122857_add_push_tokens` (**applied to BOTH `ayana` + `yiiva_demo`**).
>   `PushService` → Expo push API (prunes DeviceNotRegistered). New mobile
>   endpoints on `api/me`: `GET notifications` (+ unreadCount), `unread-count`,
>   `PATCH :id/read`, `POST read-all`, `POST/DELETE push-tokens` — in
>   `src/mobile/notifications/`. maya: `expo-notifications`+`expo-device`
>   installed, `lib/push.ts` (guarded — no-ops in Expo Go / simulator),
>   api-client fns, `useNotificationQueries`, **new `app/notifications.tsx`**
>   inbox, `YiivaHeader` bell + unread badge (Home + Shop), tap→order routing,
>   register-on-auth / unregister-on-logout.
> - **⚠️ Push DELIVERY is untestable in Expo Go / iOS Simulator** (no APNs / SDK
>   53 dropped push from Expo Go). Emails + in-app inbox work everywhere; push
>   delivery needs a dev build on a physical device. Code is complete + guarded.
>
> **▶ PAYFAST SANDBOX SMOKE TEST — PASSED end-to-end (first time ever):**
> Bug found + fixed: maya sent `yiivaapp://` custom-scheme `return_url`/`cancel_url`
> → PayFast 400 "url format invalid". Fixed `checkout.tsx` + `payfast.tsx` to use
> an **https sentinel** (`https://yiiva.co.za/payment-return?status=…`) the WebView
> intercepts (`onShouldStartLoadWithRequest` returns false; page never loads).
> Then: checkout → PayFast sandbox → **ITN delivered via ngrok (`POST
> /payments/notify → 200`)** → PaymentGroup COMPLETED (`pfPaymentId=3234528`) →
> Order **CONFIRMED** (`YV-2026-W4413`, R2795) → `ORDER_CONFIRMED` notification
> written (verified in inbox API, marked-read on-device) → confirmation email
> dispatched (no errors; `yiiva.co.za` verified in Resend). My Orders shows it.
>
> **▶ SMOKE-TEST RUNBOOK (to repeat payments):** (1) `ngrok http 3005`, grab the
> https URL. (2) restart :3005 with `PAYFAST_NOTIFY_URL=https://<id>/payments/notify`
> (env override only — `.env` still says localhost:3000; keep `yiiva_demo` +
> skip-IP-check). (3) maya `expo start -c`, sign in `khanyi@yiiva.co.za` /
> `khanyi@Suhu26`, checkout → complete sandbox payment. ngrok currently STOPPED.
>
> **▶ DEMO-DATA NOTE:** `yiiva_demo` now has 1 real CONFIRMED order
> (`YV-2026-W4413`) plus a few stray PENDING/CANCELLED orders from the pre-fix
> 400-error retries (harmless; PENDING auto-expires via the 30-min cron).
>
> **▶ NEXT:** commit this session's work (nuwa + maya); push-notification
> delivery test on a physical dev build; optional genderType curate pass +
> stray-order cleanup. Older backlog below.
>
> ---
>
> ## 2026-06-19 handoff (Demo Importer — still valid)
>
> 🟢 Active work was the **Demo Catalogue
> Importer** — a tool to pre-load target brands' Shopify catalogues (+ manually
> supplied IG videos) into a LOCAL demo env, for personalised in-person sales
> demos (client-acquisition strategy, ~50 brands). Design + locked decisions:
> `docs/demo-importer/demo-importer-foundation.md`. Business case:
> `deploy_yiiva/business case/`.
>
> **✅ 6 BRANDS LIVE (2026-06-17).** sakanya, suhu, madebyfade, embedded,
> tolthema + **fieldsstore** (added 2026-06-17: 40 products, F I E L D S, login
> `fieldsstore@demo.yiiva.co.za`/`DemoPass1`) all ACTIVE in the `yiiva_demo` DB,
> serving through demo nuwa on **:3005** (A–Z directory + feed verified), **each
> with a real brand logo** (Cloudinary). (fieldsstore: 1 collection cover image
> won't upload — cosmetic, products unaffected.) Batch + fixes: foundation §17;
> logos §18; videos §19/§20; maya codec fix §21. **ALL COMMITTED (2026-06-19) —
> working trees clean:** nuwa `e5d1ee0`, maya `2e362a1`, athena `dda76a8`.
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
> **▶ VIDEOS POPULATED — ALL 6 BRANDS (2026-06-19, foundation §19/§20).**
> yt-dlp+ffmpeg installed; rehost takes Chrome cookies
> (`IMPORTER_YTDLP_COOKIES_FROM_BROWSER=chrome`). Operator's
> `data/hero_and_product_videos.xlsx` parsed → 26 videos placed (16 hero + 10
> product), all verified via API. Hero on all 6; product reels on sakanya(4),
> suhu(2), tolthema(4). Hurdle noted: manual product-reel sourcing is the §20
> bottleneck at scale.
>
> **▶ DEMO ACCOUNTS SEEDED (2026-06-19):** yiiva_demo now has 6 merchants +
> 1 buyer (`khanyi@yiiva.co.za`) + 1 admin (`khanyisomthamo2@gmail.com`) — both
> login-verified via :3005. Buyer enables maya cart/checkout/bookmarks; admin
> enables athena /admin. (Buyer email matches the ayana dev MERCHANT, but here
> it's a BUYER in a different DB — no conflict.)
>
> **▶ APPS WIRED TO DEMO (2026-06-19):** maya + athena now point at the demo
> backend on :3005 via env. maya: `EXPO_PUBLIC_API_URL` (new `maya/.env`;
> `api-client.ts`/`api.ts` made env-driven, :3000 fallback kept). athena
> `.env.local`: `API_URL`+`NEXT_PUBLIC_API_URL`=:3005 (Cloudinary already
> yiiva-dev). Restart Metro (`expo start -c`) + `next dev` to pick up. Demo nuwa
> must be running on :3005.
>
> **▶ MAYA VIDEO FIX (2026-06-19, foundation §21):** Instagram reels download as
> VP9, which iOS AVPlayer (expo-video) can't decode → videos silently didn't
> play. Fixed in `maya/lib/image-source.ts` — inserts Cloudinary `vc_h264`
> transform so video URLs deliver H.264 (transcode-on-delivery, cached after
> first hit). Fixes BOTH product-gallery + merchant-hero video; images/local
> assets untouched; idempotent. NOT simulator-verified by Claude — confirm on
> reload (first play of each video lags ~1-2s while Cloudinary transcodes).
>
> **▶ TO RUN THE DEMO (all local):** (1) demo nuwa on :3005 — `PORT=3005
> DATABASE_URL=<yiiva_demo url> npm run start` from nuwa (derive the demo URL
> from `.env` by swapping the db name `ayana`→`yiiva_demo`; dev :3000 untouched).
> (2) maya: `expo start -c` (reads `maya/.env` → `EXPO_PUBLIC_API_URL=:3005`).
> (3) athena: `npm run dev` (`.env.local` → :3005). **Logins:** buyer
> `khanyi@yiiva.co.za`/`khanyi@Suhu26`; admin
> `khanyisomthamo2@gmail.com`/`khanyi@Admin26`; merchants
> `<slug>@demo.yiiva.co.za`/`DemoPass1`. Stop demo nuwa: `lsof -ti :3005 | xargs kill`.
>
> **▶ NEXT (demo track):** (a) `genderType` curate pass — suhu + fieldsstore came
> out all-UNISEX (browse still works; UNISEX shows in both feeds). (b) optional:
> hero videos past the cover don't autoplay on swipe (maya `HeroMediaItem` only
> play()s at player creation — small follow-up). (c) seed a buyer address so
> checkout has a delivery target. (d) **Scale toward ~50 brands** (expect some
> non-Shopify §8 fallbacks; manual product-reel sourcing is the §20 bottleneck).
> (e) fieldsstore: 1 collection cover image won't upload (cosmetic). All demo
> env/runbook/accounts detail: foundation §15–§21.
>
> **▶ OTHER BACKEND TRACK (unchanged, pending — separate from the demo push):**
> PayFast ITN sandbox smoke (ngrok), then the Notifications module (the real
> mobile-launch blocker). Backend last green at 765 tests / 52 suites.
> `chat_attachment` Cloudinary preset already created.

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
