# Phalo — Search Quality Spec

> Companion to [`phalo-foundation.md`](./phalo-foundation.md). Search is the
> **decisive feature** of the platform — `about_yiiva.md` names broken
> discovery as problem #1 and "content becomes commerce" as the core mechanic.
> This doc specifies what Phalo contributes to search quality, in layers, each
> shippable independently. API shapes to maya (`/api/search*`) never change.
>
> Decided with the product owner 2026-06-12: **AI tagging stays deferred** —
> layers S1–S3 ship on existing data (titles, brands, manual tags, behavioral
> events); tagging slots in later as an upstream enricher without changing any
> shape. Model-dependent seams (S4) are spec'd **provider-agnostic**.

---

## 0. Baseline (today)

nuwa `/api/search`: `q` ILIKE across product title / merchant name / category
name / tag name, recency order, gender filter, cursor pagination. Suggestions =
top `Tag.usageCount`. `search` events captured (q, genderType, resultCount).

Known caps: no typo tolerance, no ranking beyond recency, no feedback signal
(we know what people search, not what they tap), thin tag graph.

---

## S1 — Lexical robustness

Goal: a misspelled or partial query still finds the right products.

**Phalo job `search_docs` (hourly, after catalog changes):** builds
`phalo.product_search_docs`:

```sql
phalo.product_search_docs (
  product_id    text PK,
  document      tsvector,   -- weighted: A=title, B=brand name, C=tags+category, D=description
  document_text text,       -- raw concatenation (for trigram + future embedding input)
  popularity    real,       -- from phalo.product_scores
  computed_at   timestamptz
)
```

**Postgres extensions** (enabled by Phalo's Alembic migration): `pg_trgm`,
`unaccent`. GIN indexes on `document` and `document_text gin_trgm_ops`.

**nuwa query change** (the one real nuwa-side search change): when
`product_search_docs` is fresh, `/api/search` queries it —
`ts_rank(document, websearch_to_tsquery(q))` OR trigram
`similarity(document_text, q) > threshold` (the OR is the typo net) — joined
back to products for the card shape. Stale/missing → current ILIKE fallback
(PH-4 pattern).

---

## S2 — Ranking + feedback loop

Goal: order by what buyers actually want, and measure it.

**Blended score** (computed in the S1 query):

```
rank = lexical_score
     × (1 + w_pop · popularity)        -- behavioral: views/carts/purchases, decayed
     × freshness_boost                 -- mild, new products get a window
     × in_stock_boost                  -- sold-out sinks, never hidden
→ brand-diversity re-rank: max N consecutive results per merchant
```

Brand diversity is a product value, not a tuning detail — indie visibility is
the platform's pitch; one prolific merchant must not own page one.

**New signal — search clicks.** Extend the existing tracker (additive,
backward-compatible):

```
POST /api/search/track  { q, genderType?, resultCount? }            -- as today
POST /api/search/track  { q, clickedProductId, position }           -- NEW variant
```

nuwa writes both as `AnalyticsEvent('search' | 'search_click')`. maya fires the
click variant on result-card tap (one-line change in the search screen).

**Search KPIs** (Phalo computes into `phalo.search_stats_daily`; surfaced in
admin, per-store slices join the merchant dashboard later):

| KPI | Why |
|---|---|
| zero-result rate | the discovery-failure number — THE health metric |
| CTR@10 / click position distribution | is ranking putting the right things up top |
| search → add-to-cart conversion | does search lead to commerce |
| top zero-result queries | demand the catalogue doesn't meet — marketplace gold for admin + merchant insight |

---

## S3 — Query understanding

Goal: meet buyers in the language they actually use.

Phalo builds **dictionaries** (batch, from search logs + catalogue vocabulary),
stored in `phalo.query_synonyms (term, expansion[], source)`:

- **Synonyms incl. SA vernacular** — hoodie/hoody, sneaker/takkie/tekkie,
  costume/swimsuit. Seeded manually, grown from co-click analysis
  (queries whose clicks land on the same products are synonyms).
- **Brand aliases** — creative spellings/stylisations → canonical store.
- **Spell correction** — catalogue-vocabulary edit-distance; powers a
  "did you mean" in the zero-result state (maya UI addition, additive field
  on the search response: `didYouMean?: string`).
- **Zero-result rescue** — on 0 hits, nuwa retries with the corrected/expanded
  query before returning empty.
- **Autocomplete** — `phalo.search_completions (prefix, completion, weight)`
  from successful (clicked) searches + catalogue terms; fills the already-spec'd
  `suggestions[]` field in `GET /api/search/suggestions` (currently empty);
  trending terms switch from `Tag.usageCount` to real top-searches-this-week.

nuwa applies the dictionaries in its query path (a lookup, no Phalo runtime
dependency).

---

## S4 — Semantic search (provider-agnostic seams)

Goal: "outfit for a summer wedding" matches products with zero keyword overlap.
The first real consumer of the hybrid request-time surface (PH-1).

- `pgvector` extension on the same Postgres; Phalo job embeds
  `document_text` (later: images) into `phalo.product_embeddings
  (product_id, embedding vector(N), model, computed_at)`.
- Query-time embedding is a model call → Phalo internal endpoint
  `POST /internal/search/embed-query { q } → { embedding }` (service-token
  auth, called by nuwa server-side). nuwa then runs the vector similarity in
  SQL and **blends** with the S2 lexical rank (reciprocal-rank fusion).
- Fallback: Phalo unreachable → lexical-only results (PH-4).
- **Model provider: deliberately undecided.** The seam is the table + the
  endpoint contract; hosted API vs self-hosted is a swap inside Phalo.

---

## Deferred upstream enricher: AI tagging

Locked deferred (2026-06-12). When it lands, it improves S1/S3/S4 *data*
without changing any shape: tags flow into `document` (weight C),
synonym/co-click dictionaries get denser, embedding text gets richer, and
smart-category search stops being thin. The `ProductTag.isAiGenerated` +
`confidence` columns continue to wait.

---

## Sequencing within the Phalo build

Search layers interleave with the foundation phases (foundation §8):

| Foundation phase | Search work |
|---|---|
| 2 (first loop) | — |
| 3 (analytics) | S2 KPIs ride the same aggregates; **add `search_click` event now** (cheap, data accumulates from day one) |
| 4 (rankings) | S1 search docs + nuwa lexical query swap; S2 blended ranking |
| 5 | S3 dictionaries + autocomplete + zero-result rescue |
| 6 | S4 semantic (+ provider decision); AI tagging whenever prioritised |

The one thing worth doing **immediately** (before Phalo exists): the
`search_click` tracker variant in nuwa + maya — every week without it is
training data lost.
