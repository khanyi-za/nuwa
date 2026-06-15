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
| 5 | Local demo-env standup (demo DB, category seed, nuwa/maya/athena wiring) + first end-to-end brand |
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
