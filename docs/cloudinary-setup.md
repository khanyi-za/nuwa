# YIIVA — Cloudinary Setup

> **Audience:** Engineers and ops touching the Cloudinary integration. New dev onboarding to YIIVA, or anyone who needs to spin up a new environment (staging, prod), configure a preset, debug an upload failure, or check usage.
>
> **Scope:** The operational reference for YIIVA's Cloudinary integration — cloud configuration, preset spec, env vars, folder convention, monitoring, and the pre-launch verification checklist. Captures the decisions made in May 2026.
>
> **Companion docs:**
> - [`Api-frontend-contracts/uploads-module-api.md`](./Api-frontend-contracts/uploads-module-api.md) — the signing-endpoint contract (frontend integration)
> - [`Api-frontend-contracts/store-frontend-flows.md` §7.3](./Api-frontend-contracts/store-frontend-flows.md#73-image-upload--cloud-storage-first-patch-the-url-second) — image upload UX in the merchant onboarding wizard
> - [`Api-frontend-contracts/product-frontend-flows.md` §11.1](./Api-frontend-contracts/product-frontend-flows.md#111-image-upload--cross-reference-to-store-flows-73) — image upload UX in the product editor

---

## Table of Contents

1. [Overview](#1-overview)
2. [Cloud account configuration](#2-cloud-account-configuration)
3. [Upload preset spec](#3-upload-preset-spec)
4. [Folder convention](#4-folder-convention)
5. [Backend env vars](#5-backend-env-vars)
6. [Frontend env vars](#6-frontend-env-vars)
7. [Signing endpoint — operational summary](#7-signing-endpoint--operational-summary)
8. [Transformation URL patterns](#8-transformation-url-patterns)
9. [Free-tier monitoring](#9-free-tier-monitoring)
10. [Pre-launch verification checklist](#10-pre-launch-verification-checklist)
11. [Known limitations (v1)](#11-known-limitations-v1)
12. [Operational follow-ups](#12-operational-follow-ups)

---

## 1. Overview

### What Cloudinary does in YIIVA's stack

Cloudinary hosts all user-uploaded images and videos: store logos and banners, product images and videos, store-collection covers, and admin-managed platform category images. The YIIVA backend does **not** handle file uploads — it only stores Cloudinary URLs as plain strings on the relevant database rows.

### Upload architecture (signed direct upload)

```
1. User picks a file in the merchant web app
2. Frontend → YIIVA backend: POST /uploads/cloudinary-signature
3. Backend verifies authz, computes a signed payload using CLOUDINARY_API_SECRET,
   returns { signature, timestamp, apiKey, cloudName, preset, folder, resourceType }
4. Frontend → Cloudinary: POST /v1_1/<cloud>/<resourceType>/upload (with signed payload + file)
5. Cloudinary stores the file, returns { secure_url, public_id, ... }
6. Frontend → YIIVA backend: PATCH /stores/:id (or POST /products/:id/images, etc.)
   with the secure_url as the image-field value
7. Backend validates the URL prefix (defense-in-depth) and stores it
```

The file never passes through the YIIVA backend. The backend's role is **authorization at sign time** + **URL validation at store time**.

See [`uploads-module-api.md`](./Api-frontend-contracts/uploads-module-api.md) for the full signing-endpoint contract.

### Why signed uploads (not unsigned)

Earlier in planning we considered unsigned uploads (browser uploads to Cloudinary directly using only a preset name). The team chose signed because:

- Every upload is gated by the YIIVA backend's `canManageStore` check
- Preset names aren't exploitable on their own (without a backend-issued signature, Cloudinary rejects)
- Per-context authorization (a merchant can sign uploads for their own store; not for someone else's)

Trade-off: a small extra round-trip per upload (frontend fetches signature before uploading). Acceptable.

### Cloud-per-environment strategy

YIIVA uses **one Cloudinary cloud per environment**:

- `yiiva-dev` — development (currently active, free tier)
- `yiiva-prod` — production (to be created when production launches)

The cloud itself is the environment separator. Folder paths inside each cloud are environment-agnostic (no `dev/` or `prod/` prefix needed — see [§4](#4-folder-convention)).

### Free tier (current)

YIIVA's Cloudinary account is on the **free tier** (25 monthly credits, rolling 30-day window). For a pre-launch / early-launch marketplace this is comfortable for both clouds combined. See [§9](#9-free-tier-monitoring) for what counts and how to watch usage.

---

## 2. Cloud account configuration

### Account ownership

Owned by the YIIVA team. The Cloudinary dashboard login is held by Khanyiso Mthamo. If/when other team members need access, add them as users in the Cloudinary account settings (free tier supports up to 3 users).

### Cloud creation

Cloudinary's free tier provides one product environment per signup. To get a separate `yiiva-prod` cloud, either:

- Create a second free Cloudinary account using a different team email (the simple option for v1)
- Upgrade to a plan that supports multiple product environments under one account (when usage justifies it)

For now, `yiiva-dev` is the only configured cloud.

### Each cloud must have

When provisioning a new environment cloud (e.g. `yiiva-prod` when launch time comes), set up the following in the Cloudinary dashboard:

1. The **six upload presets** (see [§3](#3-upload-preset-spec)) — each configured as **Signed** mode
2. **API key + API secret** generated and recorded for the backend env vars
3. **Billing alert** set at 80% of free-tier credits (see [§9](#9-free-tier-monitoring))
4. **Auto-backup** off (free tier doesn't include backups and we don't need them at v1)
5. **Default upload preset** — none required; uploads always specify a preset

---

## 3. Upload preset spec

All six presets must be configured with **Signed** mode in the Cloudinary dashboard. The `folder` field in the preset config must be left **empty** — the backend passes the folder dynamically per upload (Cloudinary's precedence rule: preset values override frontend params if both are set, so an empty preset folder lets the frontend's value win).

### The six presets

| Preset name | Mode | Resource type | Max file size | Allowed formats | Eager transformations |
|---|---|---|---|---|---|
| `store_logo` | Signed | image | 5 MB | jpg, png, webp | `q_auto`, `f_auto` |
| `store_banner` | Signed | image | 10 MB | jpg, png, webp | `q_auto`, `f_auto` |
| `product_image` | Signed | image | 10 MB | jpg, png, webp | `q_auto`, `f_auto` |
| `product_video` | Signed | video | 50 MB | mp4, webm | **none** (see note below) |
| `collection_image` | Signed | image | 5 MB | jpg, png, webp | `q_auto`, `f_auto` |
| `category_image` | Signed | image | 5 MB | jpg, png, webp | `q_auto`, `f_auto` |

> **Why no eager transformations on `product_video`:** video transformations bill **per delivered second of output**, not per render. Pre-computing eager transforms at upload time would burn through the free-tier credit budget. Apply video transforms only on-demand at display time.

### Common settings for all six presets

| Setting | Value |
|---|---|
| Mode | Signed |
| Folder | _(empty — passed dynamically by the backend at upload time)_ |
| Unique filename | true |
| Use filename | false (Cloudinary generates a public_id) |
| Overwrite | false |
| Notification URL | (none) |

### Configuring a preset (step-by-step)

In the Cloudinary dashboard:

1. **Settings → Upload → Upload presets → Add upload preset**
2. **Name** = the preset name from the table above (exact match — backend reads this)
3. **Signing mode** = Signed
4. **Storage and access**: leave default (auto, public)
5. **Folder** = empty
6. **Allowed formats** = the list from the table
7. **Max file size** = the value from the table (in bytes — e.g. 5 MB = 5242880)
8. **Eager transformations** (for image presets only):
   - Click "Add eager transformation"
   - Use `f_auto,q_auto` as the transformation string
9. **Save**

Repeat for all six presets. Once done, the cloud is ready for the backend to start signing uploads.

---

## 4. Folder convention

Within each Cloudinary cloud, assets are organised by resource type:

```
stores/
  {storeId}/
    logo/                       ← store_logo preset uploads
    banner/                     ← store_banner preset uploads
    collections/
      {collectionId}/           ← collection_image preset uploads
products/
  {productId}/
    images/                     ← product_image preset uploads
    videos/                     ← product_video preset uploads
categories/
  {categoryId}/                 ← category_image preset uploads
```

### Why no `yiiva/` top-level prefix

Earlier drafts proposed a `yiiva/` prefix to namespace assets within the cloud. With **cloud-per-env**, every asset in `yiiva-dev` is by definition a YIIVA dev asset — the namespacing is redundant. Folders start directly from resource type (`stores/`, `products/`, etc.).

### Why no `dev/` or `prod/` segment

The cloud (`yiiva-dev` vs `yiiva-prod`) is the environment separator. Adding `dev/` or `prod/` to the folder path would be duplicate information.

### The backend constructs all folder paths

The frontend never builds folder strings. The backend's signing service receives the `{storeId}`/`{productId}`/etc. from the request body and resolves the folder template — that resolved value is what gets signed and what the frontend must pass to Cloudinary verbatim.

The full per-context folder template list lives in [`uploads-module-api.md` §Upload Contexts](./Api-frontend-contracts/uploads-module-api.md#upload-contexts).

---

## 5. Backend env vars

Three required env vars on the backend. All must be set or the app fails fast at boot (similar to the `PayfastConfig` pattern in the payments module).

| Env var | Type | Example value | Purpose |
|---|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | string | `yiiva-dev` | The active Cloudinary cloud the backend signs against |
| `CLOUDINARY_API_KEY` | string | `255575148964243` | Cloudinary's public API key. Non-secret — sent to the frontend in the signed response |
| `CLOUDINARY_API_SECRET` | string | _(redacted)_ | **SECRET.** Used only by the backend to compute SHA-1 signatures. Never log, never expose to the frontend |

### Boot-time validation

The backend's `CloudinaryConfig` service reads these at startup and throws if any are missing or empty. This catches misconfigured deploys before they serve traffic.

### Per-environment values

| Env var | Dev value | Prod value (future) |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` | `yiiva-dev` | `yiiva-prod` |
| `CLOUDINARY_API_KEY` | (from `yiiva-dev` dashboard) | (from `yiiva-prod` dashboard) |
| `CLOUDINARY_API_SECRET` | (from `yiiva-dev` dashboard) | (from `yiiva-prod` dashboard) |

### Where they live

- **Local dev:** `.env` (gitignored). The current dev values are configured locally.
- **`.env.example`:** committed with the env-var names + documentation but empty values. Teammates copy and fill in.
- **Staging / prod (when set up):** in the platform's secret manager (Railway env vars, etc.).

### Secret hygiene

- Never commit `.env` to git (already gitignored — verified)
- Never paste the `CLOUDINARY_API_SECRET` value into Slack, chat, screenshots, or logs
- If the secret is ever exposed (compromised laptop, accidental commit, chat disclosure), rotate it immediately in the Cloudinary dashboard: **Settings → Access Keys → Regenerate**. Cloud name + API key can stay.

---

## 6. Frontend env vars

The frontend repo (separate codebase) needs its own env config to call the signing endpoint and render Cloudinary images. The relevant frontend env vars:

| Env var | Required | Example | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | yes | `yiiva-dev` | Used by `next-cloudinary`'s `<CldImage>` / `<CldVideoPlayer>` to construct delivery URLs. Must match the backend's `CLOUDINARY_CLOUD_NAME` for the same environment. |
| `NEXT_PUBLIC_API_BASE_URL` | yes | `http://localhost:3000` | Where the frontend calls the YIIVA backend (for the signing endpoint, etc.). Set by the frontend team based on their environment. |

**No `NEXT_PUBLIC_CLOUDINARY_API_KEY` is needed in frontend config** — the API key is returned by the signing endpoint per request, so the frontend doesn't have to know it ahead of time.

**Never expose `CLOUDINARY_API_SECRET` to the frontend.** The frontend has no need for it; signature generation is backend-only.

---

## 7. Signing endpoint — operational summary

The backend exposes a single endpoint for the frontend to obtain signed upload payloads:

```
POST /uploads/cloudinary-signature
```

Brief operational characteristics:

| Aspect | Value |
|---|---|
| Authentication | Required (JWT) |
| Authorization | Per upload context — `canManageStore` for store/product/collection contexts; `ADMIN` role for category contexts |
| Rate limit | Global default (100 / 60s); no per-endpoint override |
| Signature TTL | 1 hour (Cloudinary's default) |
| Idempotency | None — each call generates a fresh signature. Frontend should fetch one signature per upload, not cache across uploads. |

For the full contract — request body, response shape, all error cases, the recommended frontend integration pattern — see [`uploads-module-api.md`](./Api-frontend-contracts/uploads-module-api.md).

---

## 8. Transformation URL patterns

After upload, the backend stores the **base `secure_url`** returned by Cloudinary. The frontend renders responsive, optimized variants by appending transformation parameters at display time.

### URL structure

```
https://res.cloudinary.com/<cloud>/<resourceType>/upload/<transformations>/<publicId>.<ext>
```

- `<cloud>` — the cloud name from the upload (`yiiva-dev` in dev, `yiiva-prod` in prod)
- `<resourceType>` — `image` or `video`
- `<transformations>` — comma-separated within a group, slash-separated to chain groups
- `<publicId>` — the unique ID Cloudinary assigned to the asset

### Common YIIVA transformations

| Use case | Transformation string |
|---|---|
| Square thumbnail for inventory table | `c_fill,w_200,h_200,q_auto,f_auto` |
| Standard product card thumbnail | `c_fill,w_500,h_500,q_auto,f_auto` |
| Product editor preview | `c_limit,w_800,h_800,q_auto,f_auto` |
| Product detail page (PDP) display | `c_limit,w_1200,h_1200,q_auto,f_auto` |
| Store banner display | `c_fill,w_1600,h_400,q_auto,f_auto` |
| Auto-format + auto-quality only | `f_auto,q_auto` |
| Video frame thumbnail at 2 seconds | `/image/upload/so_2,w_500,h_500,c_fill/<videoPublicId>.jpg` |

### Transformation primitives reference

| Param | Meaning |
|---|---|
| `c_fill` | Fill mode — crop to fit exactly, may lose edges |
| `c_limit` | Limit mode — scale down to fit, never upscale, preserve aspect |
| `c_fit` | Fit mode — fit within bounds, may have empty space |
| `w_NNN` | Width in pixels |
| `h_NNN` | Height in pixels |
| `q_auto` | Auto-quality — Cloudinary picks the optimal quality |
| `f_auto` | Auto-format — serve WebP/AVIF when the browser supports it, else fall back |
| `so_NN` | Start offset in seconds (video) — useful for thumbnail extraction |

### Frontend implementation note

Use `next-cloudinary`'s `<CldImage>` and `<CldVideoPlayer>` components — they apply `f_auto`/`q_auto` automatically and integrate with Next.js's image optimization pipeline. Engineers don't need to hand-build transformation URLs in most cases; pass transformation params as typed props.

---

## 9. Free-tier monitoring

### What the free tier provides

| Resource | Limit |
|---|---|
| **Credits per 30-day rolling window** | 25 |
| **Storage cap (total)** | 25 GB |
| **Users on the account** | 3 |
| **Soft enforcement** | Cloudinary emails about overages rather than hard-blocking — gives time to react |

### How credits are spent

Each **1 credit** equals one of:

- 1,000 image transformations (most transformations count as 1)
- 1 GB of managed storage
- 1 GB of delivered bandwidth (approx. 500s SD video / 250s HD video)

The 25-credit budget is shared across all three. A heavy-image quarter consumes credits via storage and bandwidth; a heavy-video quarter consumes via per-delivered-second transformation costs.

### Where to monitor

Cloudinary dashboard → **Reports → Usage** (or similar — Cloudinary's nav changes occasionally). The dashboard shows:

- Current credit consumption against the 25-credit budget
- Storage used against the 25 GB cap
- Bandwidth delivered
- Transformations performed

### Billing alerts to set

In the Cloudinary dashboard → **Settings → Billing → Alerts**:

| Alert | Threshold | Recipient |
|---|---|---|
| Credit usage | 80% of monthly budget | Cloudinary account owner email |
| Storage usage | 80% of 25 GB cap | Same |
| Hard block warning | 95% of credits | Same (treat as urgent) |

When an alert fires, the most likely causes are:

1. **Bandwidth spike** from a viral product → check delivered bandwidth, consider Cloudinary's bandwidth-control settings
2. **Storage filled** from accumulated unused assets (old logos, deleted products' images) → manual cleanup or run the (future) cleanup cron
3. **Genuine growth** → plan for paid plan upgrade

---

## 10. Pre-launch verification checklist

Run through this before going live with images/videos in production (i.e. before connecting `yiiva-prod`):

### Cloudinary configuration
- [ ] `yiiva-prod` cloud exists with the same six presets as `yiiva-dev`
- [ ] All six presets are in **Signed** mode
- [ ] All six presets have **empty folder** field
- [ ] Eager transformations `q_auto,f_auto` are set on the five image presets (not on `product_video`)
- [ ] File-size limits match the spec in [§3](#3-upload-preset-spec)
- [ ] Allowed-format lists are correct
- [ ] Billing alerts are configured (80%, 95% thresholds)
- [ ] Account has 1–3 users with appropriate access

### Backend
- [ ] `CLOUDINARY_CLOUD_NAME` is set to `yiiva-prod` in the prod env
- [ ] `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` are set from the `yiiva-prod` dashboard
- [ ] Boot-time config validation passes (start the app and check logs)
- [ ] `@IsCloudinaryUrl()` validator is wired on all 6 affected DTO fields (see [`uploads-module-api.md`](./Api-frontend-contracts/uploads-module-api.md#companion-url-prefix-constraint-on-consumer-endpoints))
- [ ] Tests for the signing endpoint pass — including the per-context authz scenarios

### Frontend
- [ ] `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` matches `yiiva-prod` in the prod env
- [ ] `next-cloudinary` is installed and configured
- [ ] `<CldUploadWidget>` integration calls the prod backend's signing endpoint
- [ ] `<CldImage>` / `<CldVideoPlayer>` render uploaded media correctly

### Smoke test (end-to-end)
- [ ] Merchant logo upload: pick file → sign → upload → PATCH → display
- [ ] Product image upload: same flow
- [ ] Product video upload: same flow, including thumbnail extraction
- [ ] Auth failures: unauthenticated request to signing endpoint returns 401
- [ ] Authz failures: signing for a store you don't own returns 403
- [ ] URL validation: a non-Cloudinary URL submitted via `PATCH` is rejected with 400
- [ ] Preset constraints: try a 100MB image — Cloudinary rejects, frontend surfaces error
- [ ] Folder structure: verify a real upload lands in the expected folder (`stores/{storeId}/logo` etc.)
- [ ] Signature replay: signature for context A cannot be used for context B (Cloudinary rejects)

### Open items from research to verify
- [ ] **Canonical list of video upload formats** — Cloudinary's docs page was 404 when last checked; confirm the formats list directly with Cloudinary or by trial
- [ ] **Cloudinary Upload Widget per-file size cap** — historically 100MB, but verify against current docs and our preset limits

---

## 11. Known limitations (v1)

These are accepted compromises for v1, tracked so they're not forgotten:

### Single shared cloud across dev/prod? (No — superseded)

Earlier planning considered using one shared `yiiva` cloud for both dev and prod with folder-prefix env separation. **Superseded** by the cloud-per-env decision. Each env now gets its own cloud.

### No store/product status check at sign time

The signing endpoint validates `canManageStore` but doesn't check store status (`DRAFT`/`PENDING_REVIEW`/etc.) or product status (`DRAFT`/`ARCHIVED`). A merchant whose store is in `PENDING_REVIEW` can sign uploads — and the file gets stored in Cloudinary — but the subsequent `PATCH` fails because the store is in review and `PATCH /stores/:id` is blocked. The Cloudinary file becomes an orphan until cleanup.

**Acceptable trade-off:** the orphan-file cost is tiny (Cloudinary storage); duplicating the status logic in the upload module adds complexity. Cleanup cron (future) handles orphans.

### No URL folder-level validation

The backend validates that submitted image URLs start with `https://res.cloudinary.com/<cloudName>/`. It does **not** validate that the URL is in the expected folder for the resource (e.g., a `logoUrl` field could be PATCHed with a product-image URL from the same cloud). This is acceptable for v1 — the user owns both resources anyway, and the worst case is data-hygiene clutter, not security.

### No image moderation

Cloudinary offers paid add-ons (Cloudinary AI moderation, AWS Rekognition integration) for NSFW/inappropriate content detection. Not enabled in v1. Admin review at store-approval and go-live time catches obvious issues; product-level review is the merchant's responsibility.

### No automatic unused-asset cleanup

When a merchant replaces a logo or deletes a product image, the old asset stays in Cloudinary forever. Storage cost is negligible at v1 scale; becomes meaningful at growth. See [§12](#12-operational-follow-ups).

### Signature TTL is 1 hour

Default Cloudinary value. If an upload is delayed (slow network, user pause), the signature can expire. Frontend retries with a fresh signature on expiry (documented in [`uploads-module-api.md`](./Api-frontend-contracts/uploads-module-api.md#signature-validity-and-retry-behaviour)). No backend tuning needed for v1.

### One Cloudinary account owner

The free tier permits up to 3 users. Currently 1 (Khanyiso). Adding more team members is straightforward via Cloudinary dashboard → **Settings → Users**.

---

## 12. Operational follow-ups

Track these for future work; not blocking for v1 launch.

| Priority | Item | When to revisit |
|---|---|---|
| Medium | **Unused-asset cleanup cron** — backend job that scans Cloudinary for assets whose URLs are no longer referenced in the database and deletes them | When storage usage starts approaching the 25 GB free-tier cap, or before going to a paid plan |
| Medium | **Migrate from free tier to a paid plan** — currently free tier; usage caps will be hit as the catalog grows | When 80% credit/storage alert fires consistently |
| Low–medium | **Image moderation** (AWS Rekognition or Cloudinary AI moderation) | When product volume outgrows admin manual review capacity |
| Low | **`GET /uploads/me/usage` endpoint** — surface per-merchant Cloudinary usage in the merchant dashboard | If merchants ask "how much have I used?" or if YIIVA wants to bill by usage |
| Low | **Cloudinary webhooks** for asset events (upload complete, delete, etc.) | If we need real-time sync between Cloudinary and the database |
| Low | **Cloudinary signed URL delivery** (private images) | If YIIVA introduces paid-content or restricted-access images |

---

## Closing notes

The Cloudinary integration is deliberately minimal for v1: signed uploads via a single backend endpoint, browser-direct file transfer, the frontend handles display. The doc captures what's been built and the design decisions taken; refer back here when:

- Onboarding a new dev to the Cloudinary integration
- Setting up a new environment cloud (e.g. staging, prod)
- Debugging an upload failure
- Checking quota / planning a tier upgrade
- Evaluating whether to schedule one of the operational follow-ups
