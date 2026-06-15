# YIIVA Demo Catalogue Importer

Pre-loads a target brand's real catalogue (public Shopify storefront + manually
supplied Instagram videos) into a **local demo environment**, so YIIVA can run a
personalised in-person sales demo per brand.

**Design + locked decisions:** `../../docs/demo-importer/demo-importer-foundation.md`

## Run

```bash
# from the nuwa repo root
npm run import -- extract <brandSlug> --url <storefront>
# e.g.
npm run import -- extract sakanya --url https://sakanya.co
```

Output lands in `data/<brandSlug>/` (gitignored).

## Pipeline (foundation §3)

| Stage | Command | Status |
|---|---|---|
| Extract | `extract <slug> --url <url>` | ✅ Phase 1 |
| Transform | `transform <slug>` | ⏳ Phase 2 |
| Curate | (manual edit of `curated.json`) | ⏳ Phase 3 |
| Rehost | `rehost <slug>` | ⏳ Phase 3/4 |
| Load | `load <slug>` | ⏳ Phase 4 |

## Extract output

```
data/<slug>/
  _meta.json                    fetch metadata + probe result + counts
  raw/
    products.json               every published product (all pages merged)
    collections.json            collection list
    collection-membership.json  handle → { title, productIds[] }
```

`_meta.json.probeOk = false` means the storefront doesn't expose `products.json`
(it's locked) → the brand needs the non-Shopify fallback (foundation §8).
