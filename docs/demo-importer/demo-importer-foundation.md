# Demo Catalogue Importer — Foundation

> Design + locked decisions for the **YIIVA Demo Catalogue Importer** — a tool
> that pre-loads a target brand's real catalogue (from their public Shopify
> storefront, plus manually-supplied Instagram videos) into a local demo
> environment, so YIIVA can run a personalised in-person sales demo per brand.
>
> Follows the foundation-doc convention (order/payments/shipping/phalo):
> decisions recorded here are locked until explicitly revisited.
>
> Decided with the product owner 2026-06-13 → 2026-06-15.

---

## 1. Why this exists

**The acquisition strategy.** YIIVA v1 (nuwa + maya + athena, with phalo + the
notifications module still landing) is being used for **client acquisition** —
travelling to ~50 established creative brands and demonstrating, in person, how
YIIVA improves their sales and cuts operational cost (see
`deploy_yiiva/business case/YIIVA_Business proposal_1st draft.pdf`).

**The persuasion mechanic.** A generic demo on fixture brands (SUHU /
Tol'thema) is forgettable. A demo where the brand sees **their own
collections, products, imagery, and reels already live inside YIIVA** —
discoverable in maya, manageable in athena — is the close. It makes the
proposal's promise ("upload your content, AI turns it into commerce, no
technical setup") tangible: *"this is your store, already running on YIIVA."*

**The blocker.** These are established businesses — a dozen-plus collections,
hundreds of products with variants, images, prices, stock. Re-keying even one
brand by hand is hours; doing it for 50 ahead of 50 separate demos is not
feasible manually. Hence: an automated ingestion pipeline.

**The insight that makes it feasible.** The targets are *cold* (we have no
Shopify admin credentials), but almost every Shopify storefront exposes its
catalogue publicly as JSON with no auth — `/products.json`,
`/collections.json`. That is the data source.

---

## 2. Locked decisions

| # | Decision |
|---|---|
| DI-1 | **Source = public Shopify storefront JSON.** `/products.json` (paginated), `/collections.json`, `/collections/<handle>/products.json`. No credentials, no Admin API, no merchant cooperation needed pre-pitch. Non-Shopify targets are out of scope for v1. |
| DI-2 | **Target = a separate, LOCAL demo environment.** Its own Postgres + the existing `yiiva-dev` Cloudinary cloud. nuwa/maya/athena run locally pointed at it. **Demos are always laptop-driven locally; Railway is production-only and is never the demo target.** |
| DI-3 | **Fidelity = curated highlight set.** Top collections + a strong set of hero products with imagery — not the full catalogue. Looks complete without importing everything; keeps image/video volume sane. |
| DI-4 | **One TypeScript CLI, inside the nuwa repo** (`nuwa/tools/demo-importer/`). Reuses nuwa's generated Prisma client + enums (zero schema drift) and the `cloudinary` Node SDK (server-side authenticated upload, not the browser signed-direct flow). Never imported by the Nest app. |
| DI-5 | **Cloudinary = reuse `yiiva-dev`.** No separate `yiiva-demo` cloud for now. nuwa's `CLOUDINARY_CLOUD_NAME` in the demo env is `yiiva-dev`, so any in-app edit by the merchant still validates. |
| DI-6 | **Heuristic enrichment only — no LLM dependency.** `genderType` and category mapping are keyword heuristics with a human review gate. No model call in the importer. (This is a manual stand-in for phalo's deferred AI tagging — same job phalo owns later.) |
| DI-7 | **Video: manually-supplied URLs, manual pairing.** Operator pastes a handful of Instagram reel URLs per brand and tags each (`hero` or `product:<slug>`). No profile scraping, no Instaloader, no CLIP matcher. Download via `yt-dlp` (binary, shelled out from the TS tool). This collapses video sourcing into the existing curate step — no separate Python script. |
| DI-8 | **Video targets the two WIRED maya surfaces only:** merchant-profile hero (`StoreBannerMedia.mediaType=VIDEO`) and product-detail gallery (`ProductImage.mediaType=VIDEO`). The shoppable-reels feed (`ContentPost`) stays out — maya's video-player is still a mockup; building it is a separate decision, not part of the importer. |
| DI-9 | **Idempotency = per-brand wipe-and-reload.** Re-running a brand deletes its `Store` (every relation is `onDelete: Cascade`) and recreates from the curated manifest. No `sourceRef` column added to nuwa's schema. On-disk stage artifacts make re-runs skip already-done extract/rehost work. |

---

## 3. Architecture

Single TypeScript CLI, five stages, each writing a persisted artifact under
`nuwa/tools/demo-importer/data/<brandSlug>/` so every run is **resumable,
reviewable, and idempotent**. Two human touches, both in one sitting (Stage 3).

```
1. EXTRACT    storefront URL → raw/*.json          fetch public Shopify JSON
2. TRANSFORM  raw → manifest.json                  normalise to YIIVA shape + heuristics
3. CURATE     manifest.json → curated.json         HUMAN: toggle includes, fix genderType,
                                                   paste video URLs + pairings
4. REHOST     curated.json → assets/ + asset-map   download videos (yt-dlp); upload images
                                                   AND videos → Cloudinary (yiiva-dev)
5. LOAD       curated.json + asset-map → demo DB    Prisma writes; ACTIVE store
```

Each stage reads the previous stage's output. The language is TypeScript
throughout; `yt-dlp` is invoked as an external binary via `child_process`
(no Python code we maintain).

### Stage 1 — Extract
- `GET https://<domain>/products.json?limit=250&page=N` until empty.
- `GET https://<domain>/collections.json` + per-collection product lists.
- Storefront homepage / `meta.json` for logo + hero hints.
- Save raw, untouched. Includes the **feasibility probe**: if `products.json`
  404s/empties, flag the brand (see §8 fallback). Cacheable; we control re-runs.

### Stage 2 — Transform
Pure mapping → intermediate manifest in YIIVA vocabulary (image URLs still
point at the Shopify CDN at this stage). Price→cents, weight passthrough,
`genderType` + category heuristics, `include` flags pre-filled (top N
collections; products with images and in stock).

### Stage 3 — Curate (human gate)
Operator skims `curated.json` (minutes): toggles `include`, fixes a wrong
`genderType`, drops duds, and **adds the `videos[]` block** — pasting reel URLs
and tagging each. Product slugs are already in the manifest, so pairing is
copy-a-slug. What the operator types *is* the pairing — nothing to confirm later.

```jsonc
"videos": [
  { "url": "https://instagram.com/reel/ABC", "target": "hero" },
  { "url": "https://instagram.com/reel/XYZ", "target": "product", "productSlug": "oversized-hoodie" }
]
```

### Stage 4 — Rehost (slow, failure-prone, resumable)
- Download each listed video via `yt-dlp` to `assets/` (needs a one-time
  `cookies.txt` from a logged-in browser session for gated reels).
- For every curated image and downloaded video: upload to `yiiva-dev`
  Cloudinary (folder `stores/<brandSlug>/...`, `resource_type` image|video) →
  record `source → secure_url` in `asset-map.json`. Idempotent: skip anything
  already mapped. Curation (DI-3) keeps this volume sane.

### Stage 5 — Load
One transaction per brand. Creates: merchant `User` (demo creds we control) →
`Store` + `StoreAddress` + primary `StoreDispatchAddress` → `StoreCollection`s →
`Product`s → `ProductVariant`s → `ProductImage`s (Cloudinary URLs) →
`StoreBannerMedia` (hero, incl. video) → category links → tags. Curated
products and the store set to `ACTIVE`.

---

## 4. Data mapping — Shopify → YIIVA (grounded in `prisma/schema.prisma`)

| Shopify (public JSON) | YIIVA | Notes |
|---|---|---|
| shop name / domain | `Store.displayName`, `companyName`, `slug` | All three `@unique`. `displayName`=brand; `companyName`=brand or "`<brand>` (Pty) Ltd" placeholder; `slug`=slugify. |
| shop about / description | `Store.description`, `story` | strip HTML |
| logo, hero images | `Store.logoUrl`, `StoreBannerMedia[]` | rehosted; banner max 5, first = cover (`isPrimary`) |
| custom/smart collections | `StoreCollection` | `@@unique([storeId, slug])`; handle→slug, title→name, image→`imageUrl` |
| product | `Product` | `title`, slug (`@@unique([storeId,slug])`), `description`, `status=ACTIVE` if curated |
| `variants[].price` | `Product.priceInCents` (+ variant override) | "299.00" → `*100`; product price = default/first variant |
| `compare_at_price` | `comparePriceInCents` | |
| `variants[]` (real options) | `ProductVariant` | `name`="Black / Medium"; `option1/2/3` → `color`/`size`/`material` by option name |
| `variants[].grams` | `Product.weightInGrams` | direct — Shopify stores grams |
| `variants[].available` | stock | public JSON has no quantity → default (e.g. 20) when available, 0 when not |
| `variants[].sku` | `ProductVariant.sku` | **`@unique` globally** → namespace `<brandSlug>-<sku>` or null (cross-brand collision in shared demo DB) |
| `images[]` | `ProductImage` | rehosted; `sortOrder` from position; first = `isPrimary` |
| `product_type` / tags | `ProductCategory` → `Category` | map to platform Categories (pre-seeded in demo DB) |
| tags | `Tag` / `ProductTag` | optional; feeds search/trending |
| (inferred, DI-6) | `Product.genderType` | not in Shopify — keyword heuristic, human-reviewed |
| (manual, DI-7/8) | `ProductImage.mediaType=VIDEO`, `StoreBannerMedia.mediaType=VIDEO` | from the `videos[]` block |

**Bare-vs-variant rule** (matches YIIVA's independent-SKU stock model): every
Shopify product has ≥1 variant. If it has a *real* option set (Size/Colour) →
create `ProductVariant` rows, leave `Product.totalStock=0`. If it is only
Shopify's single "Default Title" variant → treat as a **bare product**: stock on
`Product.totalStock`, no variant rows.

---

## 5. Demo environment (local, DI-2)

Isolated local stack, no production pollution:
- **Demo Postgres** — own `DATABASE_URL`; nuwa migrated against it; platform
  `Category` tree + an admin user seeded (categories must exist before Load so
  product→category links resolve).
- **Cloudinary** = `yiiva-dev` (DI-5); nuwa's `CLOUDINARY_CLOUD_NAME` set to match.
- **nuwa / maya / athena** run locally, base URLs pointed at the demo instance.
- **Per-brand seed (Stage 5):** merchant `User` (demo login creds we control) +
  `Store` (`ownerId` is `@unique` → exactly one store per user) + `StoreAddress`
  (public location) + a primary `StoreDispatchAddress` (so **checkout shipping
  quotes work** in the demo — same thing that made real ShipLogic rates appear
  in dev). Store + curated products `ACTIVE` → they surface in maya feeds and the
  merchant lands on athena's legacy ACTIVE dashboard.
- **Optional "feels-alive" seed** (flagged, off by default): a few
  `AnalyticsEvent`s / fake orders so dashboard stats and trending aren't zeros.

---

## 6. Operator runbook (the 50× loop)

```
importer extract   <brand> --url https://brand.com
importer transform <brand>
#   operator skims curated.json (minutes): toggle includes, fix genderType,
#   paste reel URLs + pairings into videos[]
importer rehost    <brand>            # downloads videos, uploads all assets
importer load      <brand>            # → ACTIVE store in the local demo DB
```

Batchable: extract+transform all 50 up front, curate in a sitting, rehost+load
in a batch. Re-run any brand any time (DI-9 wipe-and-reload).

---

## 7. The hard parts
1. **Image + video rehosting** — the dominant cost. Mitigated by curation
   (DI-3) + content dedup + resumable asset-map.
2. **`genderType` inference** — required for maya's gender feeds; heuristic over
   product_type/tags/collection titles/vendor, eyeballed in curate.
3. **SKU global-uniqueness** — namespace per brand or null.
4. **Stock realism** — default quantities (public JSON hides them); optionally
   leave one variant sold-out for the 409 demo path.
5. **Category seeding** — demo DB needs the platform `Category` tree before Load.
6. **`yt-dlp` cookies** — one-time `cookies.txt` for gated reels (setup, not
   per-brand).

---

## 8. Risks & fallbacks
- **`products.json` disabled** on some stores → fallback to `sitemap.xml`
  product pages + JSON-LD scrape, or a brand-provided CSV for warm contacts.
  Per-brand flag from the Stage-1 probe.
- **Politeness** — throttle fetches; cache aggressively.
- **Image / video rights** — fine for a private demo *to that brand* (their own
  content shown back to them); flag before anything public/production.
- **Non-Shopify targets** — out of scope v1; manual treatment or a later adapter.
- **Frontend ceiling** — reels feed stays a mockup; hero + product-gallery video
  only, unless maya's video-player is separately built (DI-8).

---

## 9. Build phases

| Phase | Deliverable |
|---|---|
| 1 | ✅ **DONE (2026-06-15).** Tool scaffold (`tools/demo-importer/`, CLI, config, http) + **Extract** on public JSON. Validated against 5 real targets — see §11. |
| 2 | ✅ **DONE (2026-06-15).** **Transform** → `manifest.json` + genderType/category/option heuristics + curate flags. Run on all 5 brands — see §12. |
| 3 | ✅ **BUILT (2026-06-15).** **Curate** (`curate` bootstraps + validates `curated.json`, incl. `videos[]`) + **Rehost** (`rehost [--dry-run]`: Cloudinary image upload by remote URL, yt-dlp video download+upload, dedup, resumable asset-map). Dry-run validated; real uploads pending go-ahead — see §13. |
| 4 | ✅ **BUILT (2026-06-15).** **Load** (`load`): wipe-and-reload User+Store+addresses+collections+products+variants+images+banner/video via Prisma (pg adapter), ACTIVE. Type-checks against the real schema; not yet run (needs asset-map from a real rehost + a live demo DB) — see §14. |
| 5 | ✅ **FIRST BRAND LIVE (2026-06-15).** `yiiva_demo` DB created + migrated; `seed-demo` command added (platform categories); sakanya rehosted (41 imgs → Cloudinary) + loaded; demo nuwa booted on :3005 serving sakanya through the real `/api`. See §16. |
| 6 | Batch ergonomics + non-Shopify `products.json` fallback + optional "feels-alive" seed |

---

## 10. Open questions / later
- **`products.json` availability across the actual 50 targets** — confirm the
  assumption holds before committing; the Stage-1 probe surfaces failures.
- **Conversion → production** — when a demoed brand signs, how does their demo
  store migrate to production (re-import against Railway, or a promote path)?
  Out of scope for v1; revisit at first signed brand.
- **Shoppable reels feed** — building maya's video-player + `ContentPost` flow
  would unlock the headline UX, but is a frontend build, not importer work.

---

## 11. Phase 1 validation findings (2026-06-15)

Extract built and run against all 5 initial targets. **`products.json` is exposed
on 5/5 — the core assumption (DI-1) holds.**

| Brand | products | variants | images | collections |
|---|---|---|---|---|
| sakanya | 7 | 25 | 49 | 3 |
| suhu | 41 | 189 | 134 | 16 |
| madebyfade | 78 | 484 | 372 | 69 |
| embedded | 150 | 2,516 | 380 | 46 |
| tolthema | 162 | 6,621 | 1,178 | 52 |

**Confirmed for downstream stages:**
- Variant shape is consistent: `option1/2/3`, `sku`, `price` (decimal string),
  `grams`, `compare_at_price`, `available`, `position`; images carry
  `variant_ids` linking image→variant. No inventory *quantity* is exposed (only
  `available`) → validates the default-stock decision.
- **Curation (DI-3) is essential, not optional** — tolthema has 6,621 variants
  and embedded 2,516. We load a curated highlight set, never the full catalogue.
- **Option names are messy** → Transform must map by *content* of the option
  name (`/colou?r/i`→color, `/size/i`→size, `/material/i`→material), not
  position. Real example: embedded's "Embedded Bottle Green Bottom Tight Size".
- **`product_type` is unreliable** (often `""` or non-taxonomic like suhu's
  "LATEST ARRIVALS") → genderType/category heuristics should lean on **tags**
  (e.g. embedded's `Women-Bottoms`, madebyfade's `Sneakers`/`Colour_Black`).
- **`grams` is frequently 0** (3/5 brands) → apply a weight fallback (the
  shipping module already assumes 500g when null/0).

**Operational note:** per-collection membership fetching dominates runtime for
big catalogues (one request per collection, throttled). Acceptable for a batch
tool; could later fetch membership only for *curated* collections.

**No fallback cases yet** — none of the 5 needed the §8 non-Shopify path.

---

## 12. Phase 2 validation findings (2026-06-15)

Transform built (`src/transform/heuristics.ts` + `src/stages/transform.ts`) and
run on all 5 brands → `data/<slug>/manifest.json`. Spot-checked correct:
prices→cents (R3600→`360000`), weight fallback (500g when grams=0), option→
`color`/`size` split by name content regardless of position, collection
membership resolved to product slugs, bare-vs-variant detection.

**Heuristic behaviour observed:**
- **genderType** works where signals exist: sakanya 7/7 WOMEN (from "gown"/
  "dress" in titles), embedded caught 48 WOMEN from `Women-*` tags. Streetwear
  with no gender words defaults UNISEX (suhu 41/41) — correct (UNISEX surfaces
  in both maya feeds). Refined in curate.
- **Category suggestions are sparse by design** — the keyword map targets only
  the demo-seeded categories (dresses/tops/bottoms/sets); 45–82 products/brand
  get no suggestion. Acceptable; Load only links when the category exists.
- **Placeholder-vendor guard added** — suhu's `vendor` is Shopify's default
  "My Store"; without a guard the brand name would render as "My Store" across
  the whole demo. Transform now skips placeholder vendors (`My Store`,
  `*.myshopify.com`, etc.) and falls back to the next real vendor / titlecased
  slug (suhu → "Suhu Original").

**Manifest shape** (`src/manifest/types.ts`): store + collections[] + products[]
(each with `include` curate flag, genderType + `genderSource`, variants or bare
stock, images with Shopify CDN `sourceUrl`) + an empty `videos[]` for Curate.

---

## 13. Phase 3 build notes (2026-06-15)

Built `curate` + `rehost` (`src/stages/curate.ts`, `rehost.ts`).

- **Curate** is the human gate (DI-7): first run copies `manifest.json` →
  `curated.json`; subsequent runs validate (genderType valid, included products
  have images, every `videos[].productSlug` references an included product) and
  print what will ship. Verified on sakanya: 5/7 products included, no issues.
- **Rehost** collects de-duplicated assets from the curated manifest (store
  logo + included collection images + included product images + `videos[]`),
  uploads to Cloudinary (`yiiva-dev`, DI-5) under `demo/<slug>/<sha1>` public
  ids, and writes `asset-map.json` (source URL → secure_url) **incrementally**
  so re-runs skip completed assets (resumable). Images upload by remote URL
  (Cloudinary fetches Shopify's CDN directly — no local download); videos
  download via `yt-dlp` then upload as `resource_type: video`.
- `--dry-run` lists what would upload without touching Cloudinary. Validated on
  sakanya: 41 image jobs from 5 products, 0 already done.

**Findings / follow-ups:**
- **Image volume per product is high** (sakanya: 41 images across 5 products,
  some products have 16). Consider a per-product image cap (e.g. first 5) in
  Rehost or as a curate field — keeps product galleries tight and upload volume
  down. Not blocking.
- **Real Cloudinary uploads are an outward-facing publish action** → gated on
  explicit go-ahead; only `--dry-run` has been exercised so far.
- **`yt-dlp` not installed** in the current env (and `videos[]` is empty), so the
  video path is built + type-checked but not yet exercised end-to-end. Needs
  `brew install yt-dlp` + a `cookies.txt` for gated reels before first video.

---

## 14. Phase 4 build notes (2026-06-15)

Built `load` (`src/stages/load.ts`) using the real `@prisma/client` + `PrismaPg`
adapter (same instantiation as nuwa's `PrismaService`). Clean type-check against
the generated client = the field mapping matches `schema.prisma` exactly.

**What Load writes per brand (wipe-and-reload, DI-9):**
- Deletes the demo owner `User` (`<slug>@demo.yiiva.co.za`) → cascades the whole
  Store graph → recreates. Idempotent.
- Merchant `User` (role MERCHANT, ACTIVE, emailVerified) — login
  `<slug>@demo.yiiva.co.za` / `DemoPass1` (printed in summary; for athena).
- `Store` (ACTIVE; companyName/displayName/slug; logo from asset-map) +
  `StoreAddress` + primary `StoreDispatchAddress` (placeholder Sandton address so
  ShipLogic quotes resolve in the demo).
- `StoreCollection`s, then included `Product`s with nested `ProductVariant`s +
  `ProductImage`s (Cloudinary URLs via asset-map). Bare products carry
  `totalStock`; variant products carry per-variant stock.
- Links: `ProductCollection` (membership), `ProductCategory` (only when the demo
  DB has the suggested category), `ProductTag` (upserted, capped 10/product).
- `StoreBannerMedia`: hero videos first (cover), padded with hero images up to 5.
- Paired product videos (`videos[].target=product`) become `ProductImage`
  rows with `mediaType=VIDEO` in that product's gallery.

**Guards verified:** errors clearly if `asset-map.json` is missing (run rehost) or
`DATABASE_URL` is unset (point at the demo DB).

**Cannot run end-to-end yet** (both deferred by decision): needs (a) a real
`rehost` to produce `asset-map.json` and (b) a stood-up local demo Postgres with
the platform `Category` tree seeded. The full first-brand run is Phase 5.

> **Update: done in §16 — the full chain ran end-to-end for sakanya.**

---

## 15. Demo environment standup runbook (local, DI-2)

The demo DB is a **separate database on the same local Postgres** as dev
(`ayana`) — dev data stays untouched. Target it with an inline `DATABASE_URL`
override (dotenv won't override an already-set env var), so no `.env` juggling.

```bash
# 0. one var to reuse — mirror your ayana user:pass, just change the db name
export DEMO_DB="postgresql://<user>:<pass>@localhost:5432/yiiva_demo?schema=public"

# 1. create the demo database
createdb yiiva_demo          # or: psql -c 'CREATE DATABASE yiiva_demo;'

# 2. apply all 20 migrations to it
DATABASE_URL="$DEMO_DB" npx prisma migrate deploy

# 3. seed the platform Category tree the importer's heuristic targets
#    (repo has no category seed; Load links a product's category only if it exists)
psql "postgresql://<user>:<pass>@localhost:5432/yiiva_demo" <<'SQL'
INSERT INTO categories (id, name, slug, "sortOrder", "createdAt", "updatedAt") VALUES
  ('cat-dresses','Dresses','dresses',1, now(), now()),
  ('cat-tops','Tops','tops',2, now(), now()),
  ('cat-bottoms','Bottoms','bottoms',3, now(), now()),
  ('cat-sets','Sets','sets',4, now(), now())
ON CONFLICT (slug) DO NOTHING;
SQL

# 4. rehost a brand for real (produces asset-map.json) — Cloudinary yiiva-dev
npm run import -- rehost sakanya            # uses CLOUDINARY_* from .env

# 5. load the brand into the demo DB
DATABASE_URL="$DEMO_DB" npm run import -- load sakanya
#    → prints the merchant login: sakanya@demo.yiiva.co.za / DemoPass1

# 6. boot nuwa against the demo DB; maya + athena already target localhost:3000
DATABASE_URL="$DEMO_DB" npm run start:dev
```

**Notes**
- nuwa fails fast on missing env at boot (PayFast/ShipLogic/Cloudinary/CORS) —
  the demo env needs the same vars as dev, only `DATABASE_URL` differs. Easiest:
  run nuwa with the inline override above (the rest load from `.env`).
- `prisma generate` is DB-agnostic — only needed once after a schema change.
- Re-loading a brand is safe (wipe-and-reload). Tearing down a brand:
  `DELETE FROM users WHERE email = '<slug>@demo.yiiva.co.za';` (cascades).
- Optional: replace step 3's SQL with a small `seed-categories` importer command
  if we'd rather not hand-run psql (not built — say the word).

---

## 16. Phase 5 — first brand live (2026-06-15)

The whole pipeline ran end-to-end for **sakanya**, proving the demo concept.

**What was done (psql-free — `psql`/`createdb` aren't on this machine's PATH):**
- Added a `seed-demo` importer command (Prisma category upsert) — repo had no
  category seed; reusable for every demo brand.
- `yiiva_demo` Postgres created via Node/`pg` (CREATE DATABASE), all 20
  migrations applied with `prisma migrate deploy`, categories seeded.
- `rehost sakanya` — **41 images uploaded for real** to Cloudinary `yiiva-dev`
  under `demo/sakanya/<sha1>`; `asset-map.json` written.
- `load sakanya` — wiped + loaded: ACTIVE store, 5 products, 19 variants, 3
  collections, 5 banner images. Login `sakanya@demo.yiiva.co.za` / `DemoPass1`.
- Booted demo nuwa on **:3005** (`PORT=3005 DATABASE_URL=<yiiva_demo>`), leaving
  the dev server on :3000 untouched.

**Verified live through the real `/api`:**
- `GET /api/merchants` → sakanya in the A–Z directory (`productCount: 5`,
  `isVerified: true`, letter "S"); also in `/api/merchants/trending`.
- `GET /api/products/feed?genderType=women` → 5 products, maya shape, e.g.
  `SALINA DRESS` R2600, `primaryImage` = a real `res.cloudinary.com/yiiva-dev/
  demo/sakanya/...` URL, `merchant.displayName: SAKANYA`, `category: dresses`.
- DB spot-check: `dresses` category link + `black-series` collection link
  resolved; weight 1300g (real, not fallback).

**Gaps surfaced (polish backlog):**
- **No brand logo** — Extract never captured the storefront logo, so
  `Store.logoUrl` / `merchant.logo` is null. Banner hero images are present, but
  add logo scraping (Stage 1 homepage `<meta>`/`og:image`) for a polished demo.
- **Feed requires `genderType`** (women|men|unisex) — API contract, not a bug;
  sakanya is all-WOMEN so shows under the women feed.
- Videos not exercised (empty `videos[]`; `yt-dlp` not installed).

**To view in the apps:** maya/athena target `localhost:3000`. Either repoint
them at `:3005`, or stop the dev server and boot the demo on `:3000`. The demo
nuwa on :3005 is a background process — stop it with `lsof -ti :3005 | xargs kill`.

---

## 17. Batch: all 5 brands loaded (2026-06-16)

Ran curate → rehost → load for the remaining 4 (suhu, madebyfade, embedded,
tolthema). All 5 demo stores now ACTIVE and serving via the demo API on :3005
(`/api/merchants` A–Z: EMBEDDED, Fade, SAKANYA, Suhu Original, Tol'thema).

| Brand | products | variants | collections | images uploaded |
|---|---|---|---|---|
| sakanya | 5 | 19 | 3 | 41 |
| suhu | 31 | 151 | 16 | 105 |
| madebyfade | 40 | 234 | 69 | 179 |
| embedded | 40 | 1,654 | 46 | 103 |
| tolthema | 40 | 1,066 | 52 | 121 |

**Highlight caps added to curate bootstrap** (DI-3): 40 products/brand,
5 images/product. Dropped 38/108/115 products on madebyfade/embedded/tolthema and
trimmed hundreds of excess images (tolthema raw was 1,178 images). Caps are
constants in `curate.ts`; curated files remain hand-editable. Without them the
batch would have been ~2,000+ uploads.

**Two real schema-constraint bugs found + fixed (load.ts):**
- **`ProductVariant.sku` global @unique** — suhu repeats SKUs within its own
  catalogue, so the per-brand namespaced sku still collided. Fix: dedupe SKUs
  within a store load (`usedSkus` set), null any collision (sku is optional and
  not buyer-facing).
- **`Tag.slug` @unique** — different tag *names* can slugify to the same slug
  (e.g. "Winter 2026" / "Winter_2026"), and the upsert keyed on `name`. Fix: key
  the tag upsert on `slug`, wrap in try/catch to skip a bad tag.

Both are general (not suhu-specific) — any future brand could hit them. Resumable
rehost proved out: madebyfade had 1 image fail mid-batch; a re-run uploaded just
that one (skipped the 178 done) and a re-load filled the gallery.

**Still open:** brand logos (next task), videos (empty), and `genderType` is
heuristic per brand (suhu all-UNISEX, etc.) — refine in curate before real demos.

---

## 18. Brand logos (2026-06-16)

Shopify exposes no logo in `products.json`, so added homepage scraping.

- **`src/shopify/storefront.ts`** — `fetchStorefront(baseUrl)` parses the homepage
  HTML for logo candidates in priority order: a header `<img>` whose tag mentions
  "logo" (class/src/alt) → `og:image` → `apple-touch-icon`. URLs normalised to
  absolute https. Returns `{ title, logoCandidates[] }`.
- **Extract** writes `raw/storefront.json`; a `--logo-only` flag (re)fetches just
  the homepage (one request) without re-running the slow catalogue extract — used
  to backfill brands already extracted.
- **Transform** sets `store.logoSourceUrl = logoCandidates[0]`. Rehost + Load
  already carried the logo through (`collectJobs` → `Store.logoUrl`), so no change
  there.

**Result — all 5 backfilled, logos live as Cloudinary URLs:** the `logo-img`
heuristic found a real logo on all 5 (sakanya `SAKANYA_LOGO`, suhu `SUHU_LOGO`,
madebyfade `LOGO_2`, embedded `Photoroom_...`, tolthema `1000631324.png` — caught
via the tag's class/alt). `/api/merchants` now returns a
`res.cloudinary.com/yiiva-dev/...` logo for every brand. Future brands get logos
automatically through the normal `extract → transform` flow.

**Operator override:** if a brand's homepage yields a hero instead of the mark
(og:image fallback), edit `store.logoSourceUrl` in `curated.json` before rehost.

---

## 19. Video path validated (2026-06-16)

`yt-dlp` installed (2026.06.09, + ffmpeg). Added Chrome-cookie support to rehost
(`YTDLP` config in `config.ts` → `--cookies-from-browser`/`--cookies`; set
`IMPORTER_YTDLP_COOKIES_FROM_BROWSER=chrome` at run time).

**End-to-end proof (sakanya, 1 hero reel):**
- Pasted `https://www.instagram.com/reel/DZacNqAohSY/` into curated.json `videos[]`
  as `{ target: hero }`.
- `rehost` (Chrome cookies) → yt-dlp extracted 3,381 cookies, downloaded the reel
  (video+audio, ffmpeg-merged to mp4), uploaded to Cloudinary `video/upload`. No
  keychain block. Images skipped (resumable).
- `load` → `StoreBannerMedia[0]` = VIDEO (cover), 4 images behind it.
- `GET /api/merchants/sakanya` → `heroMedia[0]` is the `res.cloudinary.com/
  yiiva-dev/video/upload/...mp4` URL. maya screen 08 renders hero videos → plays.

**Notes:**
- `heroMedia` is an array of URL strings (no type field) — maya detects video by
  the `/video/upload/` path (or `.mp4`).
- DI-8 video surfaces both confirmed reachable: hero (StoreBannerMedia) proven;
  product gallery (ProductImage VIDEO, `videos[].target=product`) uses the same
  rehost/load path — pair against a product slug from curated.json.

**Next:** gather reel URLs per brand (hero + product pairings), paste into each
curated.json `videos[]`, rehost+load. Run rehost with the cookies env var.

---

## 20. Video population — all 6 brands (2026-06-19)

Operator supplied reel URLs in `data/hero_and_product_videos.xlsx` (hero per
brand; product reels for select products only). Parsed with Python stdlib
(zipfile + XML — no xlsx lib on the machine) → `data/hero_and_product_videos.json`,
resolved product names → slugs, injected into each `curated.json` `videos[]`,
then rehost (Chrome cookies) + load.

**26 videos placed (16 hero + 10 product), all verified:**
| Brand | hero | product reels |
|---|---|---|
| sakanya | 2 | elle-gown, lia-mini-dress, athena-dress, anaya-dress |
| madebyfade | 3 | — |
| suhu | 2 | bafana-football-jersey, eye-logo-t-shirt-white |
| tolthema | 4 | the-sleek-set, the-grace-coat, nontsikelelo-xhosa-boubou, barbie-snatched-kimono |
| embedded | 2 | — |
| fieldsstore | 3 | — |

Name-resolution catches worth noting: "Ayana Maxi Dress" = `anaya-dress` (spelling
variant); 3 video-paired products (sakanya `athena-dress`, tolthema
`barbie-snatched-kimono` + `nontsikelelo-xhosa-boubou`) had been dropped by the
40-product cap → **force-included** so their reels had a product to attach to.
No Instagram rate-limiting across 26 downloads with cookies. fieldsstore's 1
persistent failure is the cosmetic collection-cover image, not a video.

**⚠️ Scaling hurdle (operator-flagged):** sourcing *product* reels means manually
hunting each brand's Instagram for a clip of a specific product — slow, and why
only select products got videos. Hero reels are quick (one per brand); product
pairing is the bottleneck at ~50 brands. This is exactly the trade-off DI-7
accepted (manual over scraping/CLIP matching). If it becomes a real blocker at
scale, revisit the automated-pairing option from the original §"secondary script"
discussion. For now: heroes everywhere, product videos opportunistically.

---

## 21. Video codec fix — VP9 → H.264 (2026-06-19)

**Symptom:** videos didn't play in maya (product-detail gallery + merchant hero),
despite the API returning correct `type: 'video'` items with valid Cloudinary
URLs and maya's expo-video code being correct.

**Root cause:** `yt-dlp` downloads Instagram's **VP9** DASH stream; ffmpeg muxes
it into mp4 (VP9-in-mp4); Cloudinary serves it as-is. **iOS AVPlayer (expo-video
on iOS) cannot decode VP9** → silent no-play. (Android decodes VP9, so it's
iOS-only — but the fix is cross-platform.) Confirmed via `ffprobe`:
`codec_name=vp9`.

**Fix (delivery-side, no re-upload, no backend change):** Cloudinary transcodes
on delivery when a codec transform is in the URL. `maya/lib/image-source.ts` now
inserts `vc_h264` into any `/video/upload/` URL → Cloudinary delivers H.264 + AAC
(verified `ffprobe codec_name=h264`, HTTP 200). One central change fixes both
screens (both build sources via `imageSource`); image URLs + local assets
untouched; idempotent. First request per video incurs a transcode delay, cached
after.

**Implication for the importer:** the stored Cloudinary URLs remain the raw VP9
originals — the H.264 swap is a maya-side delivery transform. If another client
ever consumes these videos, it must apply the same transform (or we re-encode at
upload time with an eager transformation). For now, maya is the only consumer.

**Related minor (not fixed):** maya's `HeroMediaItem` only calls `player.play()`
in the `useVideoPlayer` setup (at creation), with no effect reacting to swipes —
so only the cover hero video autoplays; swiping to a 2nd+ hero video won't start
it. All demo brands have the hero video as the cover, so the reported issue is
resolved; full swipe-autoplay is a small follow-up.
