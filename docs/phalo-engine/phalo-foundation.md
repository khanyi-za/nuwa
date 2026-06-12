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
phalo.merchant_trending   (store_id, window, score, rank, computed_at)
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
| `trending_merchants` | hourly | score per ACTIVE store = views(7d, time-decayed) + 5×follows(7d) + 10×orders(7d); writes ranked rows |
| `product_popularity` | hourly | per ACTIVE product: views + 5×cart-adds* + 10×purchases (7d, decayed) → `popularity`; `new_arrival` = recency × popularity blend |
| `trending_searches` | hourly | normalize `q` (lowercase/trim), count over 7d, min-count threshold ≥3, top 10 |
| `store_stats_daily` | nightly + intraday refresh of today | per store per day from analytics_events + orders/payments |

\* cart-add events aren't written yet — nuwa adds a one-line
`AnalyticsEvent('add_to_cart')` write in `MobileCartService.addItem` (small
follow-up; until then the term is 0).

---

## 6. nuwa integration (small, per-feature, later phases)

Pattern for each ranking: **read phalo table → freshness check → fallback**.

```
trending merchants:  phalo.merchant_trending fresh (<24h) → use it,
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
| 2 | `trending_merchants` job end-to-end + nuwa reader w/ fallback (first full loop proven) |
| 3 | `store_stats_daily` + merchant-dashboard analytics endpoints in nuwa (web surface) + admin aggregates |
| 4 | `product_popularity` + `new_arrival` scores + nuwa readers; `trending_searches` + reader; `add_to_cart` event write in nuwa |
| 5+ | search relevance blend, similar products, AI tagging (unlock smart categories), personalised recs via the internal API |
