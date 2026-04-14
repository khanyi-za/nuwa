# YIIVA — Product Module: Sub-Resources (Steps 11–14)

> Product images, variants, platform category links, and tags.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

1. [Context](#context)
2. [Step 11 — Product Images CRUD](#step-11--product-images-crud)
3. [Step 12 — Product Variants CRUD](#step-12--product-variants-crud)
4. [Step 13 — Product Platform Category Links](#step-13--product-platform-category-links)
5. [Step 14 — Product Tags](#step-14--product-tags)
6. [API Endpoints Summary (Steps 11–14)](#api-endpoints-summary-steps-1114)

---

## Context

Phase 4 builds the sub-resources that hang off a product. These are the things a merchant attaches to a product after creating it in DRAFT (Phase 3) and before activating it (Step 8). Without Phase 4, no product can ever pass the activation contract — activation requires at least one image (Step 11) and at least one platform category link (Step 13). Variants (Step 12) and tags (Step 14) are optional but enrich the product for discovery and purchasing.

**Architectural patterns established in Phase 4:**

- **Each sub-resource gets its own service and controller.** `ImageService`, `VariantService`, `CategoryLinkService`, and `TagService` are separate classes with their own files, registered in `ProductModule`. This avoids bloating `ProductService` with image-ordering logic and tag-normalization code that doesn't belong in the core CRUD.

- **Each sub-service has its own `assertCanMutateProducts` copy.** Rather than importing `ProductService` (which risks circular dependencies in Phase 6) or extracting a shared utility (premature abstraction for ~12 lines), each sub-service carries its own private copy of the ownership + store-status gate check. The logic is identical: call `StoreService.canManageStore(userId, storeId)`, then verify the store is in `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE` status.

- **Each sub-service has its own `assertProductBelongsToStore` helper.** Finds the product by ID, verifies `product.storeId === storeId` (404 on mismatch to prevent cross-store enumeration), and rejects archived products with a 409.

- **All controllers use class-level `@UseGuards(RolesGuard)` + `@Roles(UserRole.MERCHANT)`.** Same pattern as `ProductController` from Phase 3.

- **All endpoints nest under `stores/:storeId/products/:productId/...`** — images, variants, categories, tags each get their own sub-path.

**Design decisions locked in before Phase 4 implementation:**

- **Step 11d — Last image on ACTIVE product:** Hard 409. Merchant must add a replacement first or archive the product.
- **Step 12 — Variant stock:** `totalStock` on the product is authoritative. Variant `stock` is informational only. Activation does NOT check variant stock.
- **Step 12 — Last variant deletion on ACTIVE product:** Allowed. Product reverts to variantless behaviour.
- **Step 13/14 — Idempotency:** Linking an already-linked category or adding an already-added tag returns 200 with the existing record (not 409).
- **Step 14 — Tag cap:** Soft limit of 20 tags per product.
- **Step 14 — `Tag.usageCount`:** Incremented on add, decremented on remove, in the same transaction as the `ProductTag` create/delete.
- **Step 14 — `ProductTag.isAiGenerated` and `confidence`:** Manual tags always set `isAiGenerated: false`, `confidence: null`.

**Module structure after Phase 4:**

```
src/product/
  image/
    image.service.ts
    image.controller.ts
  variant/
    variant.service.ts
    variant.controller.ts
  category-link/
    category-link.service.ts
    category-link.controller.ts
  tag/
    tag.service.ts
    tag.controller.ts
  dto/
    add-image.dto.ts
    reorder-images.dto.ts
    create-variant.dto.ts
    update-variant.dto.ts
    add-tag.dto.ts
  ...existing Phase 1-3 files
```

---

## Step 11 — Product Images CRUD

### What Step 11 Accomplishes

Merchants can add images to a product, reorder them, set a primary image, and remove images. Images are the first thing buyers see in the catalog and the first requirement of the activation contract (at least 1 image with `mediaType: IMAGE`). The `isPrimary` flag determines which image appears as the thumbnail in list views.

### Schema Recap

```prisma
model ProductImage {
  id          String    @id @default(cuid())
  productId   String
  url         String
  altText     String?
  mediaType   MediaType @default(IMAGE)
  sortOrder   Int       @default(0)
  isPrimary   Boolean   @default(false)
  createdAt   DateTime  @default(now())

  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
  @@map("product_images")
}

enum MediaType {
  IMAGE
  VIDEO
}
```

### Endpoints

All endpoints are MERCHANT-only, nested under `stores/:storeId/products/:productId/images`.

**Controller:** `src/product/image/image.controller.ts`
**Service:** `src/product/image/image.service.ts`

Route ordering matters: `PATCH reorder` is declared before `PATCH :imageId/primary` so NestJS doesn't match "reorder" as an imageId param value.

### 11a — Add Image

```
POST /stores/:storeId/products/:productId/images
```

**DTO:** `src/product/dto/add-image.dto.ts`

```typescript
export class AddImageDto {
  @IsUrl()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;
}
```

**Logic:**

1. `assertCanMutateProducts(userId, storeId)`
2. `assertProductBelongsToStore(productId, storeId)` — also blocks archived products
3. Count existing images — `sortOrder` = current count (append to end)
4. If this is the first image, `isPrimary = true` automatically (regardless of DTO value)
5. If `dto.isPrimary` is true and images already exist, run a transaction: set all existing images `isPrimary = false`, then create the new image with `isPrimary = true`
6. If `dto.isPrimary` is false or omitted (and not first image), create with `isPrimary = false`
7. Default `mediaType` to `IMAGE` if not provided

**Response:** 201 with the created `ProductImage` record.

### 11b — Reorder Images

```
PATCH /stores/:storeId/products/:productId/images/reorder
```

**DTO:** `src/product/dto/reorder-images.dto.ts`

```typescript
export class ReorderImagesDto {
  @IsArray()
  @IsString({ each: true })
  imageIds: string[];
}
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Fetch all image IDs for this product
3. Validate that `dto.imageIds` contains exactly the same set — same length, no missing, no extras. If not: 400 "imageIds must contain exactly the current set of image IDs"
4. Validate each ID belongs to this product. If not: 400 "Image ID {id} does not belong to this product"
5. Batch update `sortOrder` for each image based on array index (0, 1, 2, ...) in a `$transaction`
6. Return the reordered image list sorted by `sortOrder asc`

**Response:** 200 with the full image list in new order.

### 11c — Set Primary Image

```
PATCH /stores/:storeId/products/:productId/images/:imageId/primary
```

No request body.

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find image by ID, verify `image.productId === productId` (404)
3. If image is already `isPrimary: true` — idempotent 200, return the image as-is
4. Transaction: set all product images `isPrimary = false`, then set target image `isPrimary = true`

**Response:** 200 with the updated image.

### 11d — Remove Image

```
DELETE /stores/:storeId/products/:productId/images/:imageId
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find image, verify it belongs to this product (404)
3. Count images for this product. If count ≤ 1 AND product is ACTIVE → **409**: "Cannot remove the last image from an active product. Add a replacement image first or archive the product."
4. Record whether the deleted image was primary
5. Delete the image
6. If remaining images exist:
   - Set all remaining images `isPrimary = false`
   - Re-normalize `sortOrder` values (0, 1, 2, ...) based on current order
   - If the deleted image was primary, set the image now at `sortOrder = 0` to `isPrimary = true`

**Response:** 200 with `{ success: true }`.

### Error Cases (All of Step 11)

| Condition | Status | Message |
|-----------|--------|---------|
| Non-owner/non-employee | 403 | "You do not have permission to manage this store" |
| Store in DRAFT/PENDING_REVIEW/SUSPENDED/CLOSED | 403 | "Cannot manage products on a store with status {status}" |
| Product not found or wrong store | 404 | "Product not found" |
| Product is ARCHIVED | 409 | "Cannot modify an archived product" |
| Image not found or wrong product | 404 | "Image not found" |
| Last image on ACTIVE product (11d) | 409 | "Cannot remove the last image from an active product..." |
| imageIds set mismatch (11b) | 400 | "imageIds must contain exactly the current set of image IDs" |

---

## Step 12 — Product Variants CRUD

### What Step 12 Accomplishes

Merchants can define variants of a product — different sizes, colours, materials. Variants are optional; simple products work fine without them. Each variant can have a price override (nullable — null means "use the parent product's price") and informational stock. The `totalStock` field on the product remains authoritative for inventory purposes.

### Schema Recap

```prisma
model ProductVariant {
  id            String   @id @default(cuid())
  productId     String
  name          String   // e.g. "Black / Medium"
  sku           String?  @unique
  priceInCents  Int?     // Override product price if set
  stock         Int      @default(0)
  sortOrder     Int      @default(0)

  // Variant options (existing columns, not JSON)
  color         String?
  size          String?
  material      String?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@map("product_variants")
}
```

**Key decision:** We use the existing `color`, `size`, `material` columns (Option A) rather than adding a JSON `attributes` column. No migration needed.

### Endpoints

All endpoints are MERCHANT-only, nested under `stores/:storeId/products/:productId/variants`.

**Controller:** `src/product/variant/variant.controller.ts`
**Service:** `src/product/variant/variant.service.ts`

### 12a — Create Variant

```
POST /stores/:storeId/products/:productId/variants
```

**DTO:** `src/product/dto/create-variant.dto.ts`

```typescript
export class CreateVariantDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceInCents?: number;

  @IsInt()
  @Min(0)
  stock: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  material?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Default `sortOrder` to current variant count (append)
3. Create variant with `priceInCents` defaulting to null (no override)
4. All string fields trimmed

**Response:** 201 with the created variant.

### 12b — Update Variant

```
PATCH /stores/:storeId/products/:productId/variants/:variantId
```

**DTO:** `src/product/dto/update-variant.dto.ts`

Same fields as create, all optional. `priceInCents` is `number | null` with a `@ValidateIf` guard that only validates when the value is not null — this allows explicitly passing `null` to clear a price override.

```typescript
@ValidateIf((o) => o.priceInCents !== null)
@IsOptional()
@IsInt()
@Min(0)
priceInCents?: number | null;
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find variant, verify `variant.productId === productId` (404)
3. Update with provided fields

**Response:** 200 with the updated variant.

### 12c — Delete Variant

```
DELETE /stores/:storeId/products/:productId/variants/:variantId
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find variant, verify it belongs to this product (404)
3. Delete the variant — no last-variant protection. If this was the only variant, the product reverts to variantless behaviour (stock managed directly via `totalStock`)
4. Re-normalize `sortOrder` on remaining variants (0, 1, 2, ...)

**Response:** 200 with `{ success: true }`.

### Activation Contract Impact

Phase 4 updated the activation contract in `product.service.ts` to reflect the variant stock decision:

- **Removed:** "At least one variant must have stock greater than zero" — variant stock is informational
- **Kept:** "All variant price overrides must be greater than zero" — a variant with `priceInCents = 0` is invalid; `null` (no override) is valid

---

## Step 13 — Product Platform Category Links

### What Step 13 Accomplishes

Merchants link their products to admin-managed platform categories (created in Phase 2). At least one category link is required for activation. A product can be linked to multiple categories. This is the merchant-side counterpart to Phase 2 — admins create the taxonomy, merchants attach to it.

### Schema Recap

```prisma
model ProductCategory {
  id          String   @id @default(cuid())
  productId   String
  categoryId  String
  createdAt   DateTime @default(now())

  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  category    Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([productId, categoryId])
  @@map("product_categories")
}
```

### Endpoints

**Controller:** `src/product/category-link/category-link.controller.ts`
**Service:** `src/product/category-link/category-link.service.ts`

Separate from the admin `CategoryController` to avoid mixing merchant and admin concerns.

### 13a — Link Category

```
POST /stores/:storeId/products/:productId/categories/:categoryId
```

No request body — category ID is in the URL.

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Verify category exists (404: "Category not found")
3. Check for existing `ProductCategory` link — if exists, **idempotent 200**, return existing record
4. Create `ProductCategory` record

**Response:** 200 with the `ProductCategory` record.

### 13b — Unlink Category

```
DELETE /stores/:storeId/products/:productId/categories/:categoryId
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find the `ProductCategory` link (404: "Category link not found")
3. If product is ACTIVE, count remaining category links. If this is the last one → **409**: "Cannot remove the last category from an active product"
4. Delete the link

**Response:** 200 with `{ success: true }`.

---

## Step 14 — Product Tags

### What Step 14 Accomplishes

Merchants can tag their products with free-text labels for discovery. Tags are normalized (trimmed, lowercased), stored in a shared `Tag` pool across the platform, and linked to products via `ProductTag`. The same tag can be used by any merchant. A product can have at most 20 tags (soft cap to prevent discovery gaming).

### Schema Recap

```prisma
model Tag {
  id            String       @id @default(cuid())
  name          String       @unique
  slug          String       @unique
  isAiGenerated Boolean      @default(false)
  usageCount    Int          @default(0)
  createdAt     DateTime     @default(now())

  products      ProductTag[]

  @@index([slug])
  @@index([usageCount])
  @@map("tags")
}

model ProductTag {
  id            String   @id @default(cuid())
  productId     String
  tagId         String
  confidence    Float?   // AI confidence score — null for manual tags
  isAiGenerated Boolean  @default(false)
  createdAt     DateTime @default(now())

  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  tag           Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([productId, tagId])
  @@map("product_tags")
}
```

### Endpoints

**Controller:** `src/product/tag/tag.controller.ts`
**Service:** `src/product/tag/tag.service.ts`

### 14a — Add Tag

```
POST /stores/:storeId/products/:productId/tags
```

**DTO:** `src/product/dto/add-tag.dto.ts`

```typescript
export class AddTagDto {
  @IsString()
  @Length(2, 30)
  name: string;
}
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Normalize tag name: `dto.name.trim().toLowerCase()`
3. Count existing tags for this product. If ≥ 20 → **400**: "A product can have at most 20 tags"
4. Upsert the `Tag`: find by normalized name, create if not found. Slug generated via `slugify(normalizedName)` so "street wear" becomes slug "street-wear" (not "street wear" with a space)
5. Check for existing `ProductTag` link — if exists, **idempotent 200**, return existing record
6. Transaction: create `ProductTag` with `isAiGenerated: false`, `confidence: null`, AND increment `Tag.usageCount` by 1

**Response:** 200 with the `ProductTag` record.

### 14b — Remove Tag

```
DELETE /stores/:storeId/products/:productId/tags/:tagId
```

**Logic:**

1. `assertCanMutateProducts` + `assertProductBelongsToStore`
2. Find the `ProductTag` link (404: "Tag link not found")
3. Transaction: delete `ProductTag` AND decrement `Tag.usageCount` by 1
4. The `Tag` record itself stays in the pool — it's shared across the platform

**Response:** 200 with `{ success: true }`.

---

## API Endpoints Summary (Steps 11–14)

| Step | Method | Endpoint | Auth | Description |
|------|--------|----------|------|-------------|
| 11a | POST | `/stores/:storeId/products/:productId/images` | MERCHANT | Add image |
| 11b | PATCH | `/stores/:storeId/products/:productId/images/reorder` | MERCHANT | Reorder images |
| 11c | PATCH | `/stores/:storeId/products/:productId/images/:imageId/primary` | MERCHANT | Set primary image |
| 11d | DELETE | `/stores/:storeId/products/:productId/images/:imageId` | MERCHANT | Remove image |
| 12a | POST | `/stores/:storeId/products/:productId/variants` | MERCHANT | Create variant |
| 12b | PATCH | `/stores/:storeId/products/:productId/variants/:variantId` | MERCHANT | Update variant |
| 12c | DELETE | `/stores/:storeId/products/:productId/variants/:variantId` | MERCHANT | Delete variant |
| 13a | POST | `/stores/:storeId/products/:productId/categories/:categoryId` | MERCHANT | Link category |
| 13b | DELETE | `/stores/:storeId/products/:productId/categories/:categoryId` | MERCHANT | Unlink category |
| 14a | POST | `/stores/:storeId/products/:productId/tags` | MERCHANT | Add tag |
| 14b | DELETE | `/stores/:storeId/products/:productId/tags/:tagId` | MERCHANT | Remove tag |
