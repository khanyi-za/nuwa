# YIIVA Product Module — API Contract

> **Audience:** Frontend developers integrating the merchant dashboard and admin panel.
> **Scope:** Merchant product management, merchant collections, and admin category management. Consumer-facing public catalog endpoints are noted where relevant to the merchant UI but are not the primary scope.

---

## Endpoint Summary

### Merchant Endpoints — require `MERCHANT` role

| Method | Path | Description |
|---|---|---|
| `GET` | `/stores/:storeId/products` | List store's products (paginated, filtered) |
| `GET` | `/stores/:storeId/products/:id` | Get full product detail |
| `POST` | `/stores/:storeId/products` | Create product (DRAFT) |
| `PATCH` | `/stores/:storeId/products/:id` | Update product |
| `POST` | `/stores/:storeId/products/:id/activate` | Publish product (DRAFT/OUT_OF_STOCK → ACTIVE) |
| `POST` | `/stores/:storeId/products/:id/archive` | Archive product (ACTIVE/OUT_OF_STOCK → ARCHIVED) |
| `DELETE` | `/stores/:storeId/products/:id` | Delete product (DRAFT only) |
| `POST` | `/stores/:storeId/products/:productId/variants` | Add a variant |
| `PATCH` | `/stores/:storeId/products/:productId/variants/:variantId` | Update a variant |
| `DELETE` | `/stores/:storeId/products/:productId/variants/:variantId` | Delete a variant |
| `POST` | `/stores/:storeId/products/:productId/images` | Add an image or video |
| `PATCH` | `/stores/:storeId/products/:productId/images/reorder` | Reorder all images |
| `PATCH` | `/stores/:storeId/products/:productId/images/:imageId/primary` | Set primary image |
| `DELETE` | `/stores/:storeId/products/:productId/images/:imageId` | Remove an image |
| `POST` | `/stores/:storeId/products/:productId/tags` | Add a tag |
| `DELETE` | `/stores/:storeId/products/:productId/tags/:tagId` | Remove a tag |
| `POST` | `/stores/:storeId/products/:productId/categories/:categoryId` | Link a platform category |
| `DELETE` | `/stores/:storeId/products/:productId/categories/:categoryId` | Unlink a platform category |
| `POST` | `/stores/:storeId/collections` | Create a collection |
| `PATCH` | `/stores/:storeId/collections/:collectionId` | Update a collection |
| `DELETE` | `/stores/:storeId/collections/:collectionId` | Delete a collection |
| `POST` | `/stores/:storeId/collections/:collectionId/products/:productId` | Add product to collection |
| `DELETE` | `/stores/:storeId/collections/:collectionId/products/:productId` | Remove product from collection |

### Admin Endpoints — require `ADMIN` role

| Method | Path | Description |
|---|---|---|
| `POST` | `/categories` | Create a platform category |
| `PATCH` | `/categories/:id` | Update a platform category |
| `DELETE` | `/categories/:id` | Delete a platform category |

### Public Endpoints — no auth required (used by merchant UI for reference data)

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories` | Get full category tree (used to populate category pickers) |

---

## Error Response Shape

All errors follow this structure:

```json
{
  "statusCode": 400,
  "message": "string or array of strings",
  "error": "string"
}
```

`message` is an **array of strings** on any `400` validation error — both DTO field validation and the activation requirements check. All other errors return a single string.

---

## Rate Limiting

All product module endpoints use the global throttle: **100 requests per 60 seconds** per IP.

---

## Product Lifecycle

```
DRAFT ──activate──▶ ACTIVE ──archive──▶ ARCHIVED
                       │
               (stock hits zero)
                       │
                OUT_OF_STOCK ──activate──▶ ACTIVE
                             ──archive──▶ ARCHIVED
```

| Status | Meaning | What's possible |
|---|---|---|
| `DRAFT` | Created but not published | Edit, activate (with validation), delete |
| `ACTIVE` | Live — visible to buyers | Edit, archive |
| `OUT_OF_STOCK` | Was active, stock depleted | Edit, re-activate, archive |
| `ARCHIVED` | Removed from sale | No edits — create a new product instead |

**Key rules:**
- Only `DRAFT` products can be deleted
- Only `DRAFT` / `OUT_OF_STOCK` products can be activated (ACTIVE is a no-op, not an error)
- Only `ACTIVE` / `OUT_OF_STOCK` products can be archived (ARCHIVED is a no-op, not an error)
- `ARCHIVED` products cannot be edited, updated, have variants/images/tags/categories modified

---

## Store Access Requirement

All product mutation endpoints (`POST`, `PATCH`, `DELETE`) run a two-part guard:

1. **`canManageStore`** — user must be the store owner OR an active accepted employee
2. **Store status** — store must be `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE`

If the store is `DRAFT` or `PENDING_REVIEW`, all product mutations return:

```
403 Forbidden — "Cannot manage products on a store with status <STATUS>. Store must be approved first."
```

The **read endpoints** (`GET /stores/:storeId/products` and `GET /stores/:storeId/products/:id`) only require `canManageStore` — they work regardless of store status.

The `:storeId` in all merchant paths is the store's **ID** (not slug). Use `GET /stores/me` to obtain it.

---

## Shared Response Shapes

### Product Object (full — returned by `GET /stores/:storeId/products/:id`)

The endpoint uses `include` (not `select`) so all scalar fields on the Product model are returned. Fields not included in the update DTO (`costInCents`, `lowStockThreshold`, dimensions, SEO, metrics) are read-only from the merchant frontend perspective — they are present in the response but cannot be set via `PATCH /stores/:storeId/products/:id`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `storeId` | string | |
| `title` | string | |
| `slug` | string | Auto-generated from title, unique per store |
| `description` | string \| null | |
| `status` | `DRAFT \| ACTIVE \| OUT_OF_STOCK \| ARCHIVED` | |
| `priceInCents` | number | Base price — fallback for variants with no price override |
| `comparePriceInCents` | number \| null | Strike-through / original price |
| `costInCents` | number \| null | Cost price for margin calculations — read-only, not settable via update |
| `sku` | string \| null | |
| `totalStock` | number | For bare products (no variants). Variants have their own stock. |
| `reservedStock` | number | Held by active carts — do not expose or allow editing |
| `lowStockThreshold` | number | Default 5 — read-only from merchant frontend |
| `weightInGrams` | number \| null | Read-only from merchant frontend |
| `lengthCm` | number \| null | Read-only from merchant frontend |
| `widthCm` | number \| null | Read-only from merchant frontend |
| `heightCm` | number \| null | Read-only from merchant frontend |
| `metaTitle` | string \| null | SEO — read-only from merchant frontend |
| `metaDescription` | string \| null | SEO — read-only from merchant frontend |
| `totalSold` | number | Denormalised metric — read-only |
| `viewCount` | number | Denormalised metric — read-only |
| `averageRating` | number | Denormalised metric — read-only |
| `reviewCount` | number | Denormalised metric — read-only |
| `isFeatured` | boolean | |
| `publishedAt` | ISO 8601 string \| null | Set when first activated |
| `createdAt` | ISO 8601 string | |
| `updatedAt` | ISO 8601 string | |
| `images` | `ProductImage[]` | Sorted by `sortOrder` asc |
| `variants` | `ProductVariant[]` | Sorted by `sortOrder` asc |
| `categories` | `{ category: { id, name, slug } }[]` | |
| `tags` | `{ tag: { id, name, slug } }[]` | |
| `collections` | `{ collection: { id, name, slug } }[]` | |

### Product List Item (returned by `GET /stores/:storeId/products`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | |
| `slug` | string | |
| `status` | `ProductStatus` | |
| `priceInCents` | number | |
| `comparePriceInCents` | number \| null | |
| `totalStock` | number | |
| `createdAt` | ISO 8601 string | |
| `_count` | `{ images, variants, categories }` | Counts only |
| `images` | `[{ url, altText }]` \| `[]` | Primary image only (max 1) |

### ProductImage Object

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `productId` | string | |
| `url` | string | |
| `altText` | string \| null | |
| `mediaType` | `IMAGE \| VIDEO` | Default `IMAGE` |
| `sortOrder` | number | 0-indexed display order |
| `isPrimary` | boolean | Exactly one image per product is primary at any time |
| `createdAt` | ISO 8601 string | |

### ProductVariant Object

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `productId` | string | |
| `name` | string | e.g. `"Black / Medium"` |
| `sku` | string \| null | |
| `priceInCents` | number \| null | Price override — if null, buyer pays the product's base price |
| `stock` | number | Variant-level stock (independent of product `totalStock`) |
| `reservedStock` | number | Held by carts — do not expose directly |
| `color` | string \| null | |
| `size` | string \| null | |
| `material` | string \| null | |
| `sortOrder` | number | |
| `createdAt` | ISO 8601 string | |
| `updatedAt` | ISO 8601 string | |

---

## Product Endpoints

---

### `GET /stores/:storeId/products`

**Protected. `MERCHANT` role. Owner or active employee.**

Returns a paginated, filterable list of the store's products. Works regardless of store status.

**Query parameters**

| Param | Type | Default | Options / Rules |
|---|---|---|---|
| `page` | integer | `1` | min 1 |
| `limit` | integer | `20` | min 1, max 50 |
| `status` | string | `"all"` | `"all"`, `"DRAFT"`, `"ACTIVE"`, `"OUT_OF_STOCK"`, `"ARCHIVED"` |
| `search` | string | — | Searches `title` and `sku` (case-insensitive) |
| `categoryId` | string | — | Filter by platform category ID |
| `collectionId` | string | — | Filter by store collection ID |
| `sortBy` | string | `"newest"` | `"newest"`, `"oldest"`, `"nameAsc"`, `"nameDesc"`, `"priceAsc"`, `"priceDesc"`, `"stockAsc"` |

**Success — `200`**

```json
{
  "data": "ProductListItem[]",
  "meta": {
    "total": "number",
    "page": "number",
    "limit": "number",
    "totalPages": "number"
  }
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee, or store does not exist |

---

### `GET /stores/:storeId/products/:id`

**Protected. `MERCHANT` role. Owner or active employee.**

Returns the full product detail including all images, variants, categories, tags, and collections. Works regardless of store status.

**No request body.**

**Success — `200`** — Returns the full Product Object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |

---

### `POST /stores/:storeId/products`

**Protected. `MERCHANT` role. Owner or active employee.**

Creates a new product in `DRAFT` status. The slug is auto-generated from the title and is unique within the store — it cannot be set directly.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `title` | string | yes | 2–120 chars |
| `priceInCents` | integer | yes | min 0 (in ZAR cents — e.g. R99.99 = 9999) |
| `description` | string | no | max 5000 chars |
| `comparePriceInCents` | integer | no | min 0 |
| `sku` | string | no | max 80 chars |
| `totalStock` | integer | no | min 0, default 0 — only relevant for bare products (no variants) |

**Success — `201`** — Returns the full product scalar fields (no images/variants/categories).

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `400` | validation errors array | Invalid input |

---

### `PATCH /stores/:storeId/products/:id`

**Protected. `MERCHANT` role. Owner or active employee.**

Updates product fields. All fields optional. Cannot update an `ARCHIVED` product.

**Note:** `totalStock` updates are for bare products only. If the product has variants, manage stock via the variant endpoints instead.

**Request body** — all fields optional

| Field | Type | Rules |
|---|---|---|
| `title` | string | 2–120 chars |
| `description` | string | max 5000 chars |
| `priceInCents` | integer | min 0 |
| `comparePriceInCents` | integer | min 0 |
| `sku` | string | max 80 chars |
| `totalStock` | integer | min 0 |

**Success — `200`** — Returns the updated product scalar fields.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot update an archived product. Create a new product instead."` | Product is `ARCHIVED` |

---

### `POST /stores/:storeId/products/:id/activate`

**Protected. `MERCHANT` role. Owner or active employee.**

Publishes the product — moves status to `ACTIVE`. If the product is already `ACTIVE`, returns the product as-is (no error).

**No request body.**

**Activation requirements** (all must pass):
- `title` is at least 2 characters
- `priceInCents` is greater than zero
- At least 1 image of type `IMAGE` added (videos alone do not count)
- At least 1 platform category linked
- If variants exist: any variant price override must be greater than zero (null overrides are fine — they inherit the base price)

All failing requirements are returned together in a single `400` error array.

**Success — `200`** — Returns the updated product with `status: "ACTIVE"` and `publishedAt` set.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot activate an archived product."` | Product is `ARCHIVED` |
| `400` | array of requirement strings | One or more activation requirements not met |

---

### `POST /stores/:storeId/products/:id/archive`

**Protected. `MERCHANT` role. Owner or active employee.**

Archives the product — removes it from sale. If already `ARCHIVED`, returns the product as-is (no error). Cannot archive a `DRAFT` — delete it instead.

**No request body.**

**Success — `200`** — Returns the updated product with `status: "ARCHIVED"`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot archive a draft product. Delete it instead."` | Product is `DRAFT` |

---

### `DELETE /stores/:storeId/products/:id`

**Protected. `MERCHANT` role. Owner or active employee.**

Permanently deletes a product. Only `DRAFT` products can be deleted — use archive to remove a live product.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Only draft products can be deleted. Use archive to remove a live product."` | Product is not `DRAFT` |

---

## Variant Endpoints

All variant endpoints require `MERCHANT` role, ownership or active employment, and the store to be `APPROVED` or beyond. An `ARCHIVED` product blocks all variant operations.

---

### `POST /stores/:storeId/products/:productId/variants`

Creates a new variant. The `sortOrder` defaults to the current variant count (appended last).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 2–80 chars — e.g. `"Black / Medium"` |
| `stock` | integer | yes | min 0 |
| `sku` | string | no | max 80 chars |
| `priceInCents` | integer | no | min 0 — if omitted or null, variant inherits the product's base price |
| `color` | string | no | — |
| `size` | string | no | — |
| `material` | string | no | — |
| `sortOrder` | integer | no | manual position override |

**Success — `201`** — Returns the full variant object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

### `PATCH /stores/:storeId/products/:productId/variants/:variantId`

Updates a variant. All fields optional. Send `priceInCents: null` to clear a price override and revert to the product base price.

**Request body** — all fields optional

| Field | Type | Rules |
|---|---|---|
| `name` | string | 2–80 chars |
| `sku` | string | max 80 chars |
| `priceInCents` | integer \| null | min 0, or null to clear override |
| `stock` | integer | min 0 |
| `color` | string | — |
| `size` | string | — |
| `material` | string | — |
| `sortOrder` | integer | — |

**Success — `200`** — Returns the updated variant object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Variant not found"` | Variant does not exist or belongs to a different product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

### `DELETE /stores/:storeId/products/:productId/variants/:variantId`

Permanently deletes a variant. After deletion, the remaining variants are automatically re-indexed (`sortOrder` compacted to 0, 1, 2...).

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Variant not found"` | Variant does not exist or belongs to a different product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

## Image Endpoints

Images are URLs — the frontend uploads files to cloud storage first and passes the resulting URL to these endpoints. The backend stores only the URL, not the file.

All image endpoints require `MERCHANT` role, ownership or active employment, store must be `APPROVED`+, and product must not be `ARCHIVED`.

---

### `POST /stores/:storeId/products/:productId/images`

Adds an image or video to the product. The first image added is automatically set as primary. Subsequent adds are non-primary by default unless `isPrimary: true` is passed.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `url` | string | yes | valid URL — upload to cloud storage first |
| `altText` | string | no | max 200 chars |
| `isPrimary` | boolean | no | if true, demotes any existing primary image |
| `mediaType` | `"IMAGE"` \| `"VIDEO"` | no | default `"IMAGE"` |

**Success — `201`** — Returns the created ProductImage object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

### `PATCH /stores/:storeId/products/:productId/images/reorder`

Reorders all images by specifying the desired order. The array **must contain every current image ID** — no more, no fewer. The position in the array determines the new `sortOrder`.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `imageIds` | string[] | yes | Must be the exact set of all current image IDs in desired order |

**Success — `200`** — Returns the full list of images for the product in the new order.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |
| `400` | `"imageIds must contain exactly the current set of image IDs"` | Wrong count |
| `400` | `"Image ID <id> does not belong to this product"` | Unknown ID included |

---

### `PATCH /stores/:storeId/products/:productId/images/:imageId/primary`

Sets an image as the primary (main) image. The previously primary image is automatically demoted. If the image is already primary, returns it as-is (no error).

**No request body.**

**Success — `200`** — Returns the updated ProductImage object with `isPrimary: true`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Image not found"` | Image does not exist or belongs to a different product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

### `DELETE /stores/:storeId/products/:productId/images/:imageId`

Removes an image. If the deleted image was primary, the next image in sort order is automatically promoted to primary. Cannot remove the last image from an `ACTIVE` product — add a replacement first or archive the product.

After deletion, remaining images are re-indexed (sortOrder compacted).

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Image not found"` | Image does not exist or belongs to a different product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |
| `409` | `"Cannot remove the last image from an active product. Add a replacement image first or archive the product."` | Last image on an `ACTIVE` product |

---

## Tag Endpoints

Tags are **platform-wide** — they are shared across all stores and products. When a merchant adds a tag by name, the tag is created globally if it doesn't exist, or reused if it does. Tag names are normalised to lowercase. Maximum 20 tags per product.

All tag endpoints require `MERCHANT` role, ownership or active employment, store must be `APPROVED`+, and product must not be `ARCHIVED`.

---

### `POST /stores/:storeId/products/:productId/tags`

Adds a tag to the product. If the tag name doesn't exist on the platform, it is created. If the product already has this tag, the existing link is returned silently (no error, no duplicate).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 2–30 chars — normalised to lowercase |

**Success — `200`** — Returns the ProductTag link object `{ id, productId, tagId, isAiGenerated, confidence, createdAt }`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |
| `400` | `"A product can have at most 20 tags"` | Tag limit reached |

---

### `DELETE /stores/:storeId/products/:productId/tags/:tagId`

Removes a tag from the product. The `:tagId` is the tag's ID from the `tags` array on the product object — not the ProductTag link ID.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Tag link not found"` | This tag is not linked to this product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

## Category Link Endpoints

Platform categories are maintained by admins. Merchants link their products to these categories to make them discoverable. An `ACTIVE` product must retain at least one category — removing the last is blocked.

All category link endpoints require `MERCHANT` role, ownership or active employment, store `APPROVED`+, product not `ARCHIVED`.

---

### `POST /stores/:storeId/products/:productId/categories/:categoryId`

Links a platform category to the product. If already linked, returns the existing link silently (no duplicate, no error).

**No request body.**

**Success — `200`** — Returns the ProductCategory link object `{ id, productId, categoryId, createdAt }`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Category not found"` | Category ID does not exist |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |

---

### `DELETE /stores/:storeId/products/:productId/categories/:categoryId`

Removes a category link from the product.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage products on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |
| `404` | `"Category link not found"` | This category is not linked to this product |
| `409` | `"Cannot modify an archived product"` | Product is `ARCHIVED` |
| `409` | `"Cannot remove the last category from an active product"` | Last category on an `ACTIVE` product |

---

## Collection Endpoints

Collections are **store-scoped** groupings (e.g. "Summer 2025", "Limited Edition"). They have no effect on platform-wide discovery — they are for organising a store's own storefront. The slug is auto-generated from the collection name and is unique per store.

All collection endpoints require `MERCHANT` role, ownership or active employment, and store `APPROVED`+.

---

### `POST /stores/:storeId/collections`

Creates a new collection for the store.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 2–80 chars |
| `description` | string | no | max 500 chars |
| `imageUrl` | string | no | valid URL |
| `sortOrder` | integer | no | min 0, default 0 |

**Success — `201`** — Returns the full StoreCollection object `{ id, storeId, name, slug, description, imageUrl, sortOrder, createdAt, updatedAt }`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage collections on a store with status <STATUS>..."` | Store not yet approved |

---

### `PATCH /stores/:storeId/collections/:collectionId`

Updates a collection. All fields optional. The slug is not re-generated when the name changes — it is fixed at creation time.

**Request body** — all fields optional

| Field | Type | Rules |
|---|---|---|
| `name` | string | 2–80 chars |
| `description` | string | max 500 chars |
| `imageUrl` | string | valid URL |
| `sortOrder` | integer | min 0 |

**Success — `200`** — Returns the updated StoreCollection object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage collections on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Collection not found"` | Collection does not exist or belongs to a different store |

---

### `DELETE /stores/:storeId/collections/:collectionId`

Deletes a collection. Products in the collection are not deleted — only the collection and its product links are removed.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage collections on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Collection not found"` | Collection does not exist or belongs to a different store |

---

### `POST /stores/:storeId/collections/:collectionId/products/:productId`

Adds a product to a collection. If already in the collection, returns the existing link silently (no duplicate).

**No request body.**

**Success — `200`** — Returns the ProductCollection link object `{ id, productId, collectionId, createdAt }`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage collections on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Collection not found"` | Collection does not exist or belongs to a different store |
| `404` | `"Product not found"` | Product does not exist or belongs to a different store |

---

### `DELETE /stores/:storeId/collections/:collectionId/products/:productId`

Removes a product from a collection.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `403` | `"Cannot manage collections on a store with status <STATUS>..."` | Store not yet approved |
| `404` | `"Collection not found"` | Collection does not exist or belongs to a different store |
| `404` | `"Product is not in this collection"` | Link does not exist |

---

## Admin: Category Endpoints

Platform categories are the taxonomy used for product discovery across all stores. They are hierarchical — a category can have a parent, forming a tree. Products are linked to any level in the tree; browsing a parent category automatically includes all descendant products.

---

### `GET /categories`

**Public — no authentication required.**

Returns the full category tree as a nested structure. Used by the merchant dashboard to populate category pickers and by the admin to view the current taxonomy.

**No request body.**

**Success — `200`**

Returns an array of root categories, each with a `children` array (which may also have `children`):

```json
[
  {
    "id": "string",
    "name": "string",
    "slug": "string",
    "description": "string | null",
    "imageUrl": "string | null",
    "parentId": null,
    "sortOrder": "number",
    "children": [
      {
        "id": "string",
        "name": "string",
        "slug": "string",
        "parentId": "string",
        "sortOrder": "number",
        "children": []
      }
    ]
  }
]
```

---

### `POST /categories`

**Protected. `ADMIN` role required.**

Creates a new platform category. Slug is auto-generated from the name. Optionally nests under a parent.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | 2–80 chars |
| `description` | string | no | max 500 chars |
| `imageUrl` | string | no | valid URL |
| `parentId` | string | no | ID of parent category |
| `sortOrder` | integer | no | min 0, default 0 |

**Success — `201`** — Returns the created category with its `parent` object: `{ id, name, slug, description, imageUrl, parentId, sortOrder, createdAt, updatedAt, parent: { id, name, slug } | null }`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"Parent category not found"` | `parentId` does not exist |
| `400` | validation errors array | Invalid input |

---

### `PATCH /categories/:id`

**Protected. `ADMIN` role required.**

Updates a category. All fields optional. Setting `parentId: null` moves the category to be a root. Cannot set a category as its own parent. Cannot create a cycle (e.g. moving a parent into one of its own children).

**Request body** — all fields optional

| Field | Type | Rules |
|---|---|---|
| `name` | string | 2–80 chars |
| `description` | string | max 500 chars |
| `imageUrl` | string | valid URL |
| `parentId` | string \| null | null = make root; string = new parent ID |
| `sortOrder` | integer | min 0 |

**Success — `200`** — Returns the updated category with `parent` object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"Category not found"` | Category does not exist |
| `404` | `"Parent category not found"` | New `parentId` does not exist |
| `400` | `"A category cannot be its own parent"` | `parentId` same as `id` |
| `400` | `"Reparenting would create a cycle"` | Moving category into its own descendant |

---

### `DELETE /categories/:id`

**Protected. `ADMIN` role required.**

Deletes a category. Blocked if the category has children, linked products, or store associations — all must be resolved first.

**No request body.**

**Success — `200`**
```json
{ "success": true }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"Category not found"` | Category does not exist |
| `409` | `"Cannot delete a category that has child categories. Move or delete the children first."` | Has child categories |
| `409` | `"Cannot delete a category that has products linked to it. Re-categorise the products first."` | Products are linked |
| `409` | `"Cannot delete a category that stores are associated with. Remove store associations first."` | Stores are associated |

---

## Connection Logic

### Stock model — bare product vs variants

The stock model is **independent**, not aggregated:

| Product type | Stock field | Location |
|---|---|---|
| Bare product (no variants) | `totalStock` | On the product |
| Product with variants | `stock` | On each variant individually |

A product with variants does **not** use `product.totalStock` for stock tracking — only the individual variant `stock` fields matter. Do not show or update `totalStock` on the product edit form once variants exist. Manage stock through the variant update endpoint instead.

`reservedStock` on both product and variant tracks items held in active carts. Do not display or allow editing of this field — it is managed entirely by the cart system.

### Activation checklist

Before showing the activate button, the frontend can pre-validate using data from `GET /stores/:storeId/products/:id`:

| Requirement | Check |
|---|---|
| Has title | `title.length >= 2` |
| Has valid price | `priceInCents > 0` |
| Has at least one IMAGE | `images.filter(i => i.mediaType === 'IMAGE').length >= 1` |
| Has at least one category | `categories.length >= 1` |
| All variant price overrides valid | `variants.every(v => v.priceInCents === null \|\| v.priceInCents > 0)` |

The backend validates all these on activate and returns the full list of failures in a single `400`.

### Image primary logic

- Exactly one image per product is primary at any time
- The first image added is automatically primary
- Deleting the primary image automatically promotes the next image (by sortOrder)
- Adding with `isPrimary: true` demotes the current primary
- The primary image is what appears in product list cards and search results

### Tag ID vs Tag name

Tags are added by **name** but removed by **tagId**. The `tagId` needed for removal is available in the product detail response under `product.tags[n].tag.id`. Store the tag ID when rendering the tag list so it can be passed to the delete endpoint.

### Listing a store's collections

There is no `GET /stores/:storeId/collections` merchant endpoint. To list a store's collections, use the public endpoint:

```
GET /stores/:slug/collections    (no auth required)
```

**Critical constraint:** this public endpoint only returns results for `ACTIVE` stores. If the store is `APPROVED` or `PENDING_GO_LIVE`, it returns `404`. This means a merchant in pre-launch stages cannot list their own collections through any current endpoint — they can only create, update, and delete them. The merchant dashboard should handle this gracefully (e.g. maintain a local collection list after creation until the store goes live).

The public collection response shape:
```json
[
  {
    "id": "string",
    "name": "string",
    "slug": "string",
    "description": "string | null",
    "imageUrl": "string | null",
    "sortOrder": "number",
    "productCount": "number"
  }
]
```

### Collection slug is fixed

Unlike product and store slugs, collection slugs are **not regenerated** when the name changes. The slug is set at creation time from the name and is permanent.

### Product slug is auto-generated and store-scoped

Product slugs are generated from the title and are unique within a store (not platform-wide). Two stores can have products with identical slugs. The slug cannot be set or changed directly.
