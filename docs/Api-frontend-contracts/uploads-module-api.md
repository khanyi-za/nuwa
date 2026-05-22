# YIIVA Uploads Module — API Contract

> **Audience:** Frontend engineers integrating image and video uploads in the merchant web app.
> **Scope:** The signing endpoint that lets the frontend perform authenticated, server-signed direct uploads to Cloudinary. After the signed upload completes, the resulting URL is `PATCH`-ed to the relevant resource (store, product, etc.) — and the backend validates the URL prefix on those endpoints.

---

## Endpoint Summary

| Method | Path | Auth required | Roles | Rate limit |
|---|---|---|---|---|
| `POST` | `/uploads/cloudinary-signature` | Yes | Any authenticated user (per-context check applies) | Global default (100 / 60s) |

This module currently exposes a single endpoint. It generates a one-shot Cloudinary upload signature scoped to a specific upload context (store logo, product image, etc.) after verifying the authenticated user has permission to upload to that context.

---

## Error Response Shape

All errors follow the standard structure:

```json
{
  "statusCode": 403,
  "message": "string or array of strings",
  "error": "string"
}
```

`message` is an **array of strings** only on `400` DTO validation errors. All other errors return a single string.

---

## Upload Contexts

YIIVA accepts six distinct upload contexts. Each maps to a Cloudinary upload preset (configured separately in Cloudinary's dashboard) and a folder template.

| Context | What it's for | Cloudinary preset | Resource type | Folder template |
|---|---|---|---|---|
| `store_logo` | The brand logo shown on the store's profile and in buyer search results | `store_logo` | image | `stores/{storeId}/logo` |
| `store_banner` | The wide hero image displayed at the top of the store's public profile | `store_banner` | image | `stores/{storeId}/banner` |
| `product_image` | A product photo. Multiple per product allowed; one is `isPrimary` | `product_image` | image | `products/{productId}/images` |
| `product_video` | A product video. Used for demos, lifestyle clips | `product_video` | video | `products/{productId}/videos` |
| `collection_image` | A hero image for a store collection (e.g. "Summer 2026") | `collection_image` | image | `stores/{storeId}/collections/{collectionId}` |
| `category_image` | A hero image for a platform-wide admin category | `category_image` | image | `categories/{categoryId}` |

YIIVA uses **one Cloudinary cloud per environment** — `yiiva-dev` for dev, `yiiva-prod` for prod (when that's set up). The cloud itself is the env separator: within each cloud, folder paths are environment-agnostic (no `dev/` or `prod/` segment needed). The backend's `CLOUDINARY_CLOUD_NAME` env var tells the service which cloud to sign against; the frontend reads `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` for the same value.

---

## Authorization Model

Each context has its own permission check, evaluated server-side at sign time. If the check fails, no signature is issued and the upload cannot proceed.

| Context | Authorization check |
|---|---|
| `store_logo` | `canManageStore(userId, storeId)` (owner or active accepted employee) |
| `store_banner` | `canManageStore(userId, storeId)` |
| `product_image` | `canManageStore(userId, storeId)` AND `product.storeId === storeId` |
| `product_video` | `canManageStore(userId, storeId)` AND `product.storeId === storeId` |
| `collection_image` | `canManageStore(userId, storeId)` AND `collection.storeId === storeId` |
| `category_image` | `user.role === ADMIN` (no `storeId` required) |

**Note:** the signing endpoint does **not** check store status (`DRAFT`/`PENDING_REVIEW`/etc.) or product status (`DRAFT`/`ARCHIVED`). The downstream `PATCH`/`POST` endpoints that consume the URL already enforce those gates. A user who signs an upload for an `ARCHIVED` product will succeed at upload but fail at the subsequent `POST /stores/.../products/.../images` call with `409 "Cannot modify an archived product"`. The orphan file remains in Cloudinary until a cleanup pass — acceptable trade-off for v1.

---

## `POST /uploads/cloudinary-signature`

**Protected. Any authenticated user (per-context check applies).**

Generates a Cloudinary upload signature that the frontend uses to upload a single file directly to Cloudinary's API. The signature binds to a specific `folder`, `upload_preset`, and `timestamp` — any tampering with those values invalidates it and Cloudinary will reject the upload.

### Request body

| Field | Type | Required when | Rules |
|---|---|---|---|
| `uploadContext` | enum | always | One of: `store_logo`, `store_banner`, `product_image`, `product_video`, `collection_image`, `category_image` |
| `storeId` | string | `uploadContext` is any value except `category_image` | Must be a valid store ID. The user must satisfy the authorization check for that context. |
| `productId` | string | `uploadContext` ∈ {`product_image`, `product_video`} | Must be a valid product belonging to `storeId`. 404-not-403 if the product belongs to a different store (enumeration prevention). |
| `collectionId` | string | `uploadContext` = `collection_image` | Must be a valid collection belonging to `storeId`. 404-not-403 if mismatch. |
| `categoryId` | string | `uploadContext` = `category_image` | Must be a valid platform category. Admin-only. |

**Examples:**

Store logo:
```json
{
  "uploadContext": "store_logo",
  "storeId": "clx1abc123"
}
```

Product image:
```json
{
  "uploadContext": "product_image",
  "storeId": "clx1abc123",
  "productId": "clx1prod456"
}
```

Category image (admin):
```json
{
  "uploadContext": "category_image",
  "categoryId": "clx1cat789"
}
```

### Success response — `200 OK`

```json
{
  "signature": "a3f9c2e1b4d87634...",
  "timestamp": 1684123456,
  "apiKey": "123456789012345",
  "cloudName": "yiiva-dev",
  "preset": "store_logo",
  "folder": "stores/clx1abc123/logo",
  "resourceType": "image"
}
```

| Field | Type | Notes |
|---|---|---|
| `signature` | string | SHA-1 hex digest. The frontend passes this verbatim to Cloudinary's upload API. |
| `timestamp` | integer | Unix epoch seconds at sign time. Valid for **1 hour** (Cloudinary's default). Frontend should upload promptly after receiving. |
| `apiKey` | string | Cloudinary API key. Non-secret — passed through to Cloudinary's upload request alongside the signature. |
| `cloudName` | string | The Cloudinary cloud name for the current environment (`yiiva-dev` in dev, `yiiva-prod` in prod). Sent so the frontend doesn't have to read it from its own env separately. |
| `preset` | string | The Cloudinary preset name to upload with. Maps 1:1 to the `uploadContext` from the request. |
| `folder` | string | The pre-resolved folder path. The frontend must pass this verbatim to Cloudinary as the `folder` parameter — tampering invalidates the signature. |
| `resourceType` | enum | `image` or `video`. Tells the frontend which Cloudinary upload endpoint to hit (`/image/upload` vs `/video/upload`). |

### Error responses

| Status | Message | Cause |
|---|---|---|
| `400` | array of validation strings | DTO validation failed — invalid `uploadContext` enum, missing required ID for the context, etc. |
| `401` | `"Authentication required"` | No JWT |
| `401` | `"Access token has expired"` | Expired JWT — frontend should silent-refresh (see `auth-frontend-flows.md` §4.2 / §4.3) |
| `403` | `"You do not have permission to manage this store"` | `canManageStore` returned false for the given `storeId` |
| `403` | `"You do not have permission to access this resource"` | `category_image` context requested by non-`ADMIN` user (emitted by `RolesGuard`) |
| `404` | `"Store not found"` | `storeId` does not exist |
| `404` | `"Product not found"` | `productId` does not exist OR belongs to a different store than `storeId` (404-not-403 enumeration prevention) |
| `404` | `"Collection not found"` | `collectionId` does not exist OR belongs to a different store |
| `404` | `"Category not found"` | `categoryId` does not exist |
| `429` | rate limit error | Global throttle hit (100/60s) — unusual for normal usage |

---

## Connection Logic

### What gets signed

The signature is computed over a sorted, ampersand-joined string of the params the frontend will pass to Cloudinary, **excluding** `file`, `cloud_name`, `api_key`, `resource_type`, and `signature` itself. For YIIVA's upload flow that's:

```
folder=stores/.../logo&timestamp=1684123456&upload_preset=store_logo
```

Hashed with `CLOUDINARY_API_SECRET` appended (SHA-1) → the hex digest is the `signature`.

**Frontend constraint:** the values of `folder`, `timestamp`, and `upload_preset` passed to Cloudinary must exactly match the values returned in the signature response. Cloudinary rejects mismatches. The frontend cannot, for example, override the folder after receiving the signature.

### Recommended upload flow (Pattern A — pre-fetch the signature)

```
1. User picks a file in the editor (e.g. drops a logo into the store-setup form)

2. Frontend calls POST /uploads/cloudinary-signature with the upload context
   (e.g. { uploadContext: "store_logo", storeId: "clx1abc123" })

3. Backend validates the user, picks the preset, resolves the folder template,
   computes the signature, returns the signed payload

4. Frontend POSTs the file to Cloudinary's upload endpoint:
   POST https://api.cloudinary.com/v1_1/yiiva-dev/image/upload (or /video/upload)
   (Replace `yiiva-dev` with the value of `cloudName` from step 3's response.)
   form-data: {
     file,
     api_key: <from response>,
     timestamp: <from response>,
     signature: <from response>,
     folder: <from response>,
     upload_preset: <from response>
   }

5. Cloudinary verifies the signature, applies preset constraints (file size,
   format), stores the file under the requested folder, returns:
   {
     secure_url: "https://res.cloudinary.com/yiiva/image/upload/.../<publicId>.jpg",
     public_id: "...",
     format: "jpg",
     bytes: 245678,
     width: 1500,
     height: 1500,
     ...
   }

6. Frontend PATCHes the resulting `secure_url` to the relevant YIIVA endpoint
   (e.g. PATCH /stores/:id { logoUrl: <secure_url> }).

7. Backend validates the URL prefix (see "Companion URL-prefix constraint" below)
   and stores it on the resource.
```

This is the recommended pattern because:
- Single, explicit network call to YIIVA's backend per upload (easy to debug)
- The upload widget configuration is straightforward — no `signatureEndpoint` proxy needed
- Works with `next-cloudinary`'s `<CldUploadWidget>` by passing the signed payload as options

### Alternative — Pattern B (Next.js proxy)

If your frontend prefers `<CldUploadWidget signatureEndpoint="/api/cloudinary-signature">`, route that to a Next.js API route that proxies to this endpoint, forwarding the user's session cookie and the request body. The widget calls the proxy, the proxy calls this endpoint, the proxy returns the signed payload to the widget.

This adds a layer but lets you use the widget's stock `signatureEndpoint` contract. Functionally identical from Cloudinary's perspective.

### Folder construction

The backend constructs the `folder` value by interpolating the template (see [Upload Contexts](#upload-contexts) table) with IDs from the request body:

- `{storeId}`, `{productId}`, `{collectionId}`, `{categoryId}` ← from the request body

Environment separation is handled at the Cloudinary cloud level (`yiiva-dev` vs `yiiva-prod` are separate clouds), not via folder prefixes. The frontend never constructs the folder itself — the backend's resolved folder is the source of truth.

### Signature validity and retry behaviour

Cloudinary's default signature TTL is **1 hour from `timestamp`**. After that, the upload request is rejected with a signature-validity error.

**Frontend recommendations:**
- Fetch the signature **immediately before** uploading the file, not at form render. If the user picks a file and then takes 90 minutes to click "Save," the cached signature is stale.
- On signature expiry during upload (rare but possible on slow networks or paused uploads), re-fetch a fresh signature and retry the upload once. If the second attempt fails too, surface a generic upload error.
- Don't cache signatures across renders or across files. One signature per file upload.

### Companion URL-prefix constraint on consumer endpoints

After a successful Cloudinary upload, the frontend `PATCH`es the resulting `secure_url` to YIIVA endpoints that store image references. The backend enforces a **URL-prefix constraint** on those fields: the URL must begin with `https://res.cloudinary.com/<configuredCloudName>/`.

Affected DTO fields (across other module contracts):

| Module | DTO | Field |
|---|---|---|
| store | `UpdateStoreDto` | `logoUrl`, `bannerUrl` |
| store | `CreateCollectionDto`, `UpdateCollectionDto` | `imageUrl` |
| product | `AddImageDto` | `url` |
| product | `CreateCategoryDto`, `UpdateCategoryDto` | `imageUrl` |

If a URL from a different domain is submitted, the backend returns `400` with `"Image URL must be uploaded to YIIVA Cloudinary"`. See `store-module-api.md` and `product-module-api.md` for per-DTO call-outs.

This is defense-in-depth — it catches the case where a user (legitimate or otherwise) tries to `PATCH` with a non-Cloudinary URL via a tool like curl. Per-context authorization is already enforced at sign time, so the constraint is belt-and-suspenders rather than the primary gate.

### Image and video display (frontend reference)

The backend stores the **base `secure_url`** returned from Cloudinary. The frontend appends transformation parameters at render time to produce responsive, optimized variants.

**Recommended package:** `next-cloudinary` — provides `<CldImage>`, `<CldVideoPlayer>`, and `<CldUploadWidget>` components designed for Next.js. `<CldImage>` automatically applies `f_auto` + `q_auto`, generates correct `srcSet`, and inherits Next.js's image optimization pipeline.

**Transformation URL pattern:**

```
https://res.cloudinary.com/<cloud>/image/upload/<transformations>/<publicId>.<ext>
```

Common YIIVA transformations:

| Use case | Transformation string |
|---|---|
| Square product thumbnail (inventory list, search) | `c_fill,w_500,h_500,q_auto,f_auto` |
| Inventory-table small thumbnail | `c_fill,w_200,h_200,q_auto,f_auto` |
| Product editor preview | `c_limit,w_800,h_800,q_auto,f_auto` |
| Product detail page (PDP) display | `c_limit,w_1200,h_1200,q_auto,f_auto` |
| Store banner display | `c_fill,w_1600,h_400,q_auto,f_auto` |
| Auto-format + auto-quality only | `f_auto,q_auto` |
| Video frame thumbnail (e.g. for inventory preview) | `/image/upload/so_2,w_500,h_500,c_fill/<videoPublicId>.jpg` (extracts the frame at 2 seconds) |

Combined / chained transformations use `/` between groups: `…/c_fill,w_500,h_500/f_auto,q_auto/<publicId>.jpg`.

### Cloudinary preset configuration (operational)

The six presets must exist in the Cloudinary dashboard with **signed** mode enabled. Operational setup details (preset constraints, folder-precedence rules, free-tier monitoring) live in `cloudinary-setup.md`.

---

## Cross-references

- **`store-module-api.md`** — see the `logoUrl`, `bannerUrl`, and collection `imageUrl` fields for the URL-prefix constraint
- **`product-module-api.md`** — same for `AddImageDto.url`, `CreateCategoryDto.imageUrl`, etc.
- **`store-frontend-flows.md` §7.3** — frontend UX for image upload (preview, progress, errors) in the merchant onboarding wizard
- **`product-frontend-flows.md` §11.1** — frontend UX for image upload in the product editor
- **`auth-frontend-flows.md` §4.2 / §4.3** — silent-refresh interceptor pattern (relevant when the signing endpoint returns `401 "Access token has expired"`)
- **`cloudinary-setup.md`** — operational reference: preset spec, folder convention, free-tier monitoring, pre-launch verification checklist
