# Phalo — Smart Engine Foundation

> Design + locked decisions for **Phalo**, YIIVA's Python analytics/intelligence
> engine. Sister service to nuwa (NestJS API). Lives at `deploy_yiiva/phalo`
> (repo to be created). This doc follows the foundation-doc convention from
> the order/payments/shipping modules: decisions recorded here are locked
> until explicitly revisited.
>
> Decided with the product owner on 2026-06-11.

---

## 1. What Phalo is

Phalo owns YIIVA's **computed intelligence**: rankings, aggregates, and (later)
ML-adjacent features. nuwa stays the single user-facing API and the single
authz boundary; Phalo computes, nuwa serves.

It supports three consumers, all indirectly through the database:

| Consumer | Features powered by Phalo |
|---|---|
| maya (buyer app) | trending merchants, new-arrivals ranking, trending searches, (later) search relevance, similar products, recommendations |
| Merchant dashboard | per-store analytics: views, conversion, top products, daily series |
| Admin panel | marketplace-wide analytics, store comparisons |

### Locked decisions (2026-06-11)

| # | Decision |
|---|---|
| PH-1 | **Hybrid architecture**: scheduled batch jobs are the core; a small internal FastAPI surface exists from day one (health + manual job triggers) and is the future home of request-time compute (e.g. personalised recs). Nothing user-facing calls Phalo directly. |
| PH-2 | **Shared Postgres, schema separation**: Phalo reads nuwa's domain tables, writes ONLY to the `phalo` schema. Separate DB role enforces this. |
| PH-3 | **v1 scope = rankings + merchant/admin analytics.** AI product tagging is DEFERRED (smart categories stay thin until then). |
| PH-4 | **Failure isolation**: Phalo being down degrades to stale rankings / yesterday's analytics — never an outage. nuwa keeps its current heuristics as fallbacks when Phalo tables are missing or stale. |
| PH-5 | nuwa serves all Phalo-derived data through its own endpoints with its existing authz (`canManageStore`, ADMIN role). Phalo has no concept of sessions or roles. |
| PH-6 | **Phalo speaks nuwa's domain vocabulary** — `store`, not `merchant` (maya API translation) or `brand` (UI label). Schema/job names use `store_*`/`trending_stores`; the rename happens at nuwa's serializer boundary as everywhere else. (Decided 2026-06-12.) |

---

## 2. Architecture

```
maya / merchant web / admin web
        │  (HTTPS, JWT — unchanged)
        ▼
┌────────────────────────────┐
│ nuwa (NestJS)              │  serves ALL traffic, owns authz,
│  - reads phalo.* tables    │  falls back to heuristics when
│    with freshness checks   │  phalo data is stale/absent
└──────────┬─────────────────┘
           │
┌──────────▼─────────────────┐
│ PostgreSQL (one instance)  │
│  public.*  ← nuwa-owned    │
│  phalo.*   ← phalo-owned   │
└──────────▲─────────────────┘
           │ SELECT public.*, ALL phalo.*
┌──────────┴─────────────────┐
│ Phalo (Python, Railway)    │
│  - APScheduler job loop    │
│  - FastAPI (internal only) │
└────────────────────────────┘
```

**Input data already flowing** (written by nuwa since the maya integration):
`analytics_events` rows — `product_view`, `merchant_view`, `search` (metadata:
q, genderType, resultCount) — indexed by product/store/user/time. Plus the
domain tables themselves (orders, order_items, store_followers, wishlist_items).

---

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Language | Python 3.12+ | the point of the project |
| Web framework | FastAPI | internal API + future request-time surface |
| Scheduler | APScheduler, in-process | one Railway service, no Redis/celery for v1 |
| DB access | SQLAlchemy Core + asyncpg | explicit SQL for aggregates; no ORM modelling of nuwa's tables |
| Migrations | Alembic, scoped to the `phalo` schema | Phalo owns its tables' lifecycle |
| Packaging | uv | fast, lockfile-based |
| Tests | pytest | |
| Deploy | Railway service sharing the existing Postgres | same pattern as nuwa |

One process runs both the FastAPI app and the scheduler (lifespan startup).

---

## 4. Phalo-owned tables (`phalo` schema, Alembic-managed)

```sql
phalo.trending_stores     (store_id, window, score, rank, computed_at)
phalo.product_scores      (product_id, score_type, score, computed_at)
                          -- score_type: 'popularity' | 'new_arrival'
phalo.trending_searches   (term, window, search_count, rank, computed_at)
phalo.store_stats_daily   (store_id, date, product_views, merchant_views,
                           orders, units_sold, revenue_in_cents,
                           unique_viewers, conversion_rate, computed_at)
phalo.job_runs            (job, started_at, finished_at, status, detail)
```

Writes are idempotent full-refreshes per window inside a transaction
(delete + insert), so a crashed job never leaves a half-ranking visible.

`job_runs` is the observability primitive — the admin panel can surface it
later ("rankings last computed 23 min ago").

---

## 5. v1 jobs

| Job | Cadence | Logic (v1 formulas — tune later) |
|---|---|---|
| `trending_stores` | hourly | score per ACTIVE store = views(7d, time-decayed) + 5×follows(7d) + 10×orders(7d); writes ranked rows |
| `product_scores` ✅ | hourly | **SHIPPED 2026-07-27** (job name `product_scores`, was spec'd as `product_popularity`): per ACTIVE product `popularity` = views + **3×bookmarks** + 5×cart-adds + 10×purchased-units (7d, decayed, λ=ln2/3.5). The bookmarks term is an extension over the original formula (WishlistItem — strong intent, already collected). `new_arrival` score type NOT yet computed (open). |
| `trending_searches` | hourly | normalize `q` (lowercase/trim), count over 7d, min-count threshold ≥3, top 10 |
| `store_stats_daily` | nightly + intraday refresh of today | per store per day from analytics_events + orders/payments |

The `AnalyticsEvent('add_to_cart')` write in `MobileCartService.addItem`
SHIPPED with the job (2026-07-27) — the 5× term is live from that date
forward (fire-and-forget, failure never breaks the add).

### 5a. Feed consumption — "fair rounds, smart slots" (shipped 2026-07-27)

nuwa's `queryDiscoveryPage` (feed + category browse) consumes `popularity`
scores INSIDE the brand round-robin, keeping the merchant-exposure guarantee:

- **Round assignment:** within each store, products rank by score desc
  (recency breaks ties / orders unscored), so a brand's best performer
  represents it in round 0. Every store still appears once per round.
- **Within-round order:** `effectiveScore = (score + 1.0) × jitter(seed,
  productId)`, jitter ∈ [0.5, 1.5] from the existing sha1 seed. The +1 prior
  gives zero-data products real exploration (new-merchant cold-start
  guarantee); a dominant score can never be jitter-flipped below a zero one.
- **Fallback (PH-4):** reader filters `score_type='popularity' AND score>0
  AND computed_at > now()-24h`, any error → empty map → recency rounds +
  prior×jitter = the original pure seeded shuffle. Phalo down ≠ feed down.

**Step 2 — personalization boosts (shipped 2026-07-27, nuwa-native
request-time; works with OR without phalo scores):** for authenticated
buyers, `effectiveScore` gains a multiplier — `×3.5` for products of
subscribed stores (deliberately > the 3× jitter spread: a subscription
deterministically leads its round among equal scores, but a high phalo
score still outranks a followed zero-score) and `×1.25` for products in the
buyer's affinity categories (top-3 categories from their last 200 product
views over 30d — a soft nudge inside the jitter band, no filter bubble).
Affinity also tie-breaks WITHIN-store ranking, so the product representing
a brand leans toward the buyer's browsed categories. Guests: zero extra
queries, ordering identical. Round-robin fairness cap untouched — boosts
only reorder within rounds. Constants + rationale at the top of
`mobile-products.service.ts`.

### 5b. Merchant analytics target — the athena dashboard (added 2026-06-12)

The requirements source for merchant-facing metrics is athena's
`dashboard-legacy/analytics/page.tsx` (mock-data UI prototype the real
dashboard is being aligned to). Mapping its vocabulary against actual data:

**Servable from current data (drives `store_stats_daily` + companions):**

| Mock metric | Source |
|---|---|
| Total revenue / orders / AOV + period deltas | Order/Payment rows |
| Conversion rate | orders ÷ product_views (define denominator once, document it) |
| Top products (views, purchases, bookmarks, revenue, conversion) | events + OrderItem + WishlistItem |
| Customer geography by city | Order shipping-address snapshots |
| Peak shopping hours | event timestamps |
| Search analytics (top terms; terms → clicks on this store's products) | `search` + `search_click` events |
| Realtime-ish sales curve | today's orders bucketed hourly (intraday refresh) |

This implies one more phalo table beyond §4:
`phalo.product_stats_daily (product_id, store_id, date, views, purchases,
bookmarks, revenue_in_cents, search_clicks)` — the per-product slice the
top-products panel reads.

**Not servable v1 (athena should drop or placeholder these panels):**

| Mock metric | Why |
|---|---|
| Likes per product | likes are local-only on device — no server data |
| Traffic sources | single-app world; no referrer capture |
| Session duration / bounce / pages per session / device split | no session analytics; would need a session-id on AnalyticsEvent (possible later, not v1) |
| Returning-customers % | derivable from orders (repeat buyer email/userId) — possible, but defer to v1.1 |

**Open decision — `searchAppearances` (impressions):** the mock shows per-
product search-appearance counts. We log queries and clicks, not which
products were *shown*. True impressions mean logging result-page product-id
lists per search (high write volume). Options: (a) log top-N result ids on
each tracked search, (b) approximate from click data only, (c) drop the
metric. Decide when Phase 3 starts.

---

## 6. nuwa integration (small, per-feature, later phases)

Pattern for each ranking: **read phalo table → freshness check → fallback**.

```
trending merchants:  phalo.trending_stores fresh (<24h) → use it,
                     else current followerCount heuristic
new-arrivals:        order by phalo new_arrival score when fresh,
                     else createdAt desc
trending searches:   phalo.trending_searches when fresh, else Tag.usageCount
merchant analytics:  NEW web endpoints (merchant dashboard surface) reading
                     store_stats_daily behind canManageStore
admin analytics:     NEW admin endpoints aggregating store_stats_daily
```

Access from Prisma: either `multiSchema` (add `phalo` to the schema list,
models marked `@@schema("phalo")`) or `$queryRaw` — decide when wiring the
first reader. API shapes to maya/web **do not change**.

### Internal Phalo API (v1: minimal)

```
GET  /health                      — liveness + last job_runs summary
POST /jobs/{name}/run             — manual trigger (shared-secret header)
```

Protected by a static service token (`PHALO_SERVICE_TOKEN`) — internal only,
never exposed to browsers/apps. Future request-time endpoints (personalised
recs) slot in here behind the same token, called by nuwa server-side.

---

## 7. Deferred (explicitly out of v1)

| Item | Note |
|---|---|
| AI product tagging | `ProductTag.isAiGenerated`/`confidence` columns wait; smart-category search stays thin. Re-confirmed deferred 2026-06-12 — see `phalo-search.md` for how it slots in later as a data enricher. |
| Search quality | **Fully spec'd in [`phalo-search.md`](./phalo-search.md)** (search is the platform's decisive feature — layers S1 lexical, S2 ranking+KPIs, S3 query understanding, S4 semantic). One immediate pre-Phalo action: the `search_click` tracker variant (nuwa + maya) so training data accumulates. |
| Similar products / personalised recs | candidates for the request-time API surface (alongside S4 semantic search) |
| Product likes | still no server model; when added, likes become a ranking input |
| Event retention | `analytics_events` grows unbounded; add pruning/archival (e.g. >180d) once aggregates cover history — decide owner (nuwa cron vs Phalo job) |
| Streaming/event bus | not needed at current scale; the events table is the queue |

---

## 8. Build phases

| Phase | Deliverable |
|---|---|
| 1 | Repo scaffold: uv + FastAPI + APScheduler + Alembic (`phalo` schema) + DB roles + `job_runs` + health endpoint + Railway deploy |
| 2 | `trending_stores` job end-to-end + nuwa reader w/ fallback (first full loop proven) |
| 3 | `store_stats_daily` + merchant-dashboard analytics endpoints in nuwa (web surface) + admin aggregates |
| 4 | ~~`product_popularity`~~ ✅ `product_scores` popularity + feed reader + `add_to_cart` write (2026-07-27, §5a); STILL OPEN: `new_arrival` score + its readers, `trending_searches` + reader |
| 5+ | search relevance blend, similar products, AI tagging (unlock smart categories), personalised recs via the internal API |
