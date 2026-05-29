# Backend handoff — Multi-media store banner

**Scope:** Replace the single-string `store.bannerUrl` field with a multi-item `bannerMedia` collection (≤5 items, image + video mix). Adds three new endpoints, requires a small schema migration, and touches Cloudinary preset config.

**Why now:** product requirement — merchants need to showcase their brand with multiple banner items (mix of images and videos) instead of just a single static image. The current single-`bannerUrl` field can't represent this.

**Frontend status:** spec is locked, frontend will build against the new contract in parallel. Frontend cannot ship E2E until this lands. No data loss risk during migration — existing `bannerUrl` values backfill into the new shape.

---

## What's changing

### Store record
- **Remove**: `bannerUrl: string | null` from the `Store` table
- **Add**: relation `bannerMedia: StoreBannerMedia[]` (separate table, FK on `storeId`)

### New table: `StoreBannerMedia`

| Column | Type | Notes |
|---|---|---|
| `id` | string (CUID) | primary key |
| `storeId` | string | FK → Store, ON DELETE CASCADE |
| `url` | string | Cloudinary `secure_url`; backend validates the URL prefix matches the configured cloud (same rule as `logoUrl`) |
| `mediaType` | enum `IMAGE \| VIDEO` | |
| `sortOrder` | integer | Ascending; first by sortOrder is the cover. Renumber on insert/delete/reorder to stay contiguous (0..N-1) |
| `isPrimary` | boolean | `true` for exactly one item when the collection is non-empty (the one with lowest sortOrder) |
| `createdAt` | timestamp | |

**Invariants** (enforce server-side):
- Maximum **5 items per store** (`COUNT(*) WHERE storeId = ?` ≤ 5 before insert)
- When `bannerMedia.length > 0`, exactly **one** item has `isPrimary: true` — always the one with the lowest `sortOrder`
- `sortOrder` values stay contiguous (no gaps) — renumber on any mutation
- `url` must begin with `https://res.cloudinary.com/<configuredCloudName>/` (same prefix check as `logoUrl`)

### `PATCH /stores/:id` body change
- **Remove** `bannerUrl` from accepted update fields. Attempting to set it returns `400 "Banner media is managed through dedicated endpoints, not PATCH"` (or just drop the field silently — your call).

### `GET /stores/me` response
- **Replace** `bannerUrl: string | null` with `bannerMedia: BannerMedia[]`
- Order: ascending `sortOrder`

### Admin queue endpoints (`/stores/admin/pending`, `/stores/admin/pending-go-live`)
- **Include** `bannerMedia: BannerMedia[]` on each row (or at minimum `_count.bannerMedia` for the readiness signal). The frontend uses this to render the "Banner ✓" check on go-live queue rows and to display the cover thumbnail.

### `POST /stores/:id/request-go-live` requirements
- The current `"bannerUrl populated"` requirement becomes `"at least one item in bannerMedia"`. Update the missing-requirements message accordingly.

---

## New endpoints

### `POST /stores/:storeId/banner-media`

**Protected. Store owner or active accepted employee.**

Adds a media item to the banner gallery. Appended at the end (highest `sortOrder + 1`).

**Request body**
```json
{
  "url": "https://res.cloudinary.com/yiiva-dev/image/upload/v.../...",
  "mediaType": "IMAGE"
}
```

**Success — `201`** — returns the created `BannerMedia` object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `400` | `"Banner gallery is at the 5-item limit. Remove an item before adding a new one."` | Gallery full |
| `400` | `"Banner URL must be a Cloudinary secure URL"` | URL prefix mismatch |
| `400` | validation errors | Invalid `mediaType` or missing fields |

### `DELETE /stores/:storeId/banner-media/:id`

**Protected. Store owner or active accepted employee.**

Removes a banner item. Remaining items renumbered to keep `sortOrder` contiguous. If the removed item was the cover, the next item by sortOrder becomes the new cover (set `isPrimary: true`).

**Success — `200`**
```json
{ "message": "Banner media removed" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `404` | `"Banner media not found"` | Item does not exist or belongs to a different store |
| `400` | `"At least one banner item is required while the store is in PENDING_GO_LIVE or ACTIVE"` | Removing would empty the gallery on a live/under-review store |

> **Status-aware delete protection:** for `PENDING_GO_LIVE` and `ACTIVE` stores, **block** a delete that would empty the gallery. For `APPROVED` and `DRAFT`, allow it. (Mirrors the last-image rule on ACTIVE products.)

### `PATCH /stores/:storeId/banner-media/reorder`

**Protected. Store owner or active accepted employee.**

Reorders the entire gallery in one call. The body must contain the **exact set** of current item ids — reject any miscount, duplicate, or unknown id.

**Request body**
```json
{ "ids": ["id_b", "id_a", "id_c"] }
```

The id at index 0 becomes the cover (`isPrimary: true`, lowest `sortOrder`). `sortOrder` values are reassigned 0..N-1 in array order.

**Success — `200`** — returns the reordered gallery as `BannerMedia[]`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `400` | `"Reorder ids must contain exactly the current set of banner items"` | Miscount, duplicate, or unknown id |

---

## Cloudinary preset

Add a new preset to the Cloudinary dashboard:

| Preset | Mode | Resource type | Max file size | Allowed formats | Folder template |
|---|---|---|---|---|---|
| `store_banner` (existing) | Signed | image | 10 MB | jpg, png, webp | `stores/{storeId}/banner` |
| **`store_banner_video` (new)** | **Signed** | **video** | **50 MB** | **mp4, webm** | **`stores/{storeId}/banner`** |

Both presets resolve to the same `stores/{storeId}/banner` folder so the gallery's contents live together in Cloudinary's tree.

**`uploads-module-api.md`** needs a new row in the upload-contexts table:

```
store_banner_video | { storeId } | stores/{storeId}/banner | store_banner_video | video
```

The existing `store_banner` row is unchanged.

The frontend will send `uploadContext: "store_banner_video"` for videos. The backend signs against the new preset and returns the appropriate resourceType.

> **`source=uw` is still required** for both presets — same fix as the earlier handoff (`docs/backend-handoffs/uploads-source-uw-signature.md`). The widget always sends it; the backend always signs it.

---

## Migration

Existing stores have a single `bannerUrl` (or null). Migrate cleanly:

```sql
-- 1. Create the new table
CREATE TABLE store_banner_media (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  store_id text NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  url text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON store_banner_media (store_id, sort_order);

-- 2. Backfill: existing banner_url → first item in the new table
INSERT INTO store_banner_media (store_id, url, media_type, sort_order, is_primary)
SELECT id, banner_url, 'IMAGE', 0, true
FROM stores
WHERE banner_url IS NOT NULL;

-- 3. Drop the old column (after verifying the backfill)
ALTER TABLE stores DROP COLUMN banner_url;
```

Adjust for whatever migration tool you use (Prisma, TypeORM, raw SQL). The shape doesn't matter; the semantics are: every existing banner becomes a single-item gallery, with `isPrimary: true` and `sortOrder: 0`.

---

## Validation summary

Quick checklist for the implementation:

- [ ] Max 5 items enforced (count before insert)
- [ ] Exactly one `isPrimary: true` when non-empty
- [ ] `sortOrder` stays contiguous (0..N-1) after any mutation
- [ ] URL prefix check (`https://res.cloudinary.com/<cloud>/`)
- [ ] Delete blocked on `PENDING_GO_LIVE` and `ACTIVE` when it would empty the gallery
- [ ] Reorder body must be exact set (no missing/extra/unknown ids)
- [ ] `bannerUrl` removed from `PATCH /stores/:id` accepted fields
- [ ] `bannerMedia` array returned in `GET /stores/me`, admin queue endpoints, and store-update responses
- [ ] `request-go-live` missing-requirements message updated
- [ ] `store_banner_video` preset created in Cloudinary dashboard
- [ ] `source=uw` included in signing for both `store_banner` and `store_banner_video`

---

## Manual cURL verification

Once deployed, sanity-check the four mutation paths:

```bash
# Setup
TOKEN="<your_jwt>"
STORE_ID="<your_store_id>"
BASE="http://localhost:3001"
CLOUD_URL="https://res.cloudinary.com/yiiva-dev/image/upload/v1234/test.jpg"

# 1. Add (expect 201)
curl -X POST "$BASE/stores/$STORE_ID/banner-media" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"url\":\"$CLOUD_URL\",\"mediaType\":\"IMAGE\"}"

# 2. Add 4 more items → 5th add succeeds, 6th returns 400 with limit message

# 3. Reorder (expect 200, first id becomes cover)
curl -X PATCH "$BASE/stores/$STORE_ID/banner-media/reorder" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ids":["id_b","id_a","id_c","id_d","id_e"]}'

# 4. Reorder with wrong count (expect 400)
curl -X PATCH "$BASE/stores/$STORE_ID/banner-media/reorder" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ids":["id_a"]}'

# 5. Delete (expect 200; remaining items renumbered)
curl -X DELETE "$BASE/stores/$STORE_ID/banner-media/<id>" \
  -H "Authorization: Bearer $TOKEN"

# 6. For ACTIVE stores, deleting the last item should return 400
```

---

## Spec is updated

- `docs/Api-frontend-contracts/store-module-api.md` — new section "Banner Media" with the three endpoints, `BannerMedia` object definition, updated request-go-live requirements, updated `PATCH /stores/:id` body.
- `docs/Api-frontend-contracts/store-frontend-flows.md` — §7.3a "Banner media gallery (multi-item)" + table updates to reflect the new field.

Hand this file to backend, work in parallel on the frontend pieces, wire up when the migration lands.
