# YIIVA — Product Module: Store Collections (Steps 15–18)

> Merchant-managed collections and public collection browsing.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

1. [Context](#context)
2. [Step 15 — Collection CRUD](#step-15--collection-crud)
3. [Step 16 — Collection–Product Membership](#step-16--collectionproduct-membership)
4. [Step 17 — Public Collection Listing](#step-17--public-collection-listing)
5. [Step 18 — Module Registration](#step-18--module-registration)
6. [API Endpoints Summary (Steps 15–18)](#api-endpoints-summary-steps-1518)

---

## Context

Phase 5 introduces store collections — merchant-curated groupings of products (e.g. "Summer 2026", "Staff Picks", "Sale Items"). Collections are scoped to a single store and live in `StoreCollection`. Products are linked via the `ProductCollection` join table. A product can belong to many collections, and a collection can contain many products.

**Key distinction from platform categories:** Categories are global, admin-managed, and hierarchical. Collections are per-store, merchant-managed, and flat.

**Architectural patterns in Phase 5:**

- **Own service and controller pair.** `CollectionService` and `CollectionController` follow the same isolation pattern as Phase 4 sub-resources.

- **Separate public controller (Option B).** Public collection browsing lives in `PublicCollectionController` at `stores/:slug/collections` — a separate controller file that uses `@Public()` and resolves by store slug. The merchant controller at `stores/:storeId/collections` uses store UUID and role guards.

- **Per-store slug uniqueness.** `@@unique([storeId, slug])` on `StoreCollection`. Two stores can each have a collection named "summer-drop". The `generateUniqueSlug` helper appends `-2`, `-3`, etc. on collision within the same store.

- **Duplicated `assertCanMutateProducts`.** Same pattern as Phase 4 — private copy of the ownership + store-status gate check.

**Design decisions locked in before Phase 5 implementation:**

- **Cross-store product add:** Returns 404 (not 403) to prevent store enumeration.
- **Idempotent membership add:** Adding a product that is already in the collection returns 200 with the existing record.
- **Collection deletion:** Cascade-deletes `ProductCollection` links via Prisma relation cascade. No orphan protection — collections are lightweight and can be freely deleted.
- **Public listing gate:** Only shows collections for stores with `status: ACTIVE`. Non-active stores return 404.

**Files introduced in Phase 5:**

```
src/product/
  collection/
    collection.service.ts
    collection.controller.ts
    public-collection.controller.ts
  dto/
    create-collection.dto.ts
    update-collection.dto.ts
```

---

## Step 15 — Collection CRUD

### What Step 15 Accomplishes

Merchants can create, update, and delete collections on their store. Each collection gets an auto-generated slug (per-store unique), optional description, optional image URL, and sortOrder for storefront display ordering.

### Schema Recap

```prisma
model StoreCollection {
  id          String              @id @default(uuid())
  storeId     String
  name        String
  slug        String
  description String?
  imageUrl    String?
  sortOrder   Int                 @default(0)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  store       Store               @relation(fields: [storeId], references: [id])
  products    ProductCollection[]

  @@unique([storeId, slug])
}
```

### Endpoints

| Method   | Path                                          | Auth     | Status |
|----------|-----------------------------------------------|----------|--------|
| `POST`   | `/stores/:storeId/collections`                | MERCHANT | 201    |
| `PATCH`  | `/stores/:storeId/collections/:collectionId`  | MERCHANT | 200    |
| `DELETE` | `/stores/:storeId/collections/:collectionId`  | MERCHANT | 200    |

### DTOs

**`CreateCollectionDto`** (`src/product/dto/create-collection.dto.ts`)

```typescript
export class CreateCollectionDto {
  @IsString() @Length(2, 80)
  name: string;

  @IsOptional() @IsString() @Length(0, 500)
  description?: string;

  @IsOptional() @IsUrl()
  imageUrl?: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
```

**`UpdateCollectionDto`** (`src/product/dto/update-collection.dto.ts`)

All fields optional. Same validators as create, with `@IsOptional()` on every field including `name`.

### Service Logic — `CollectionService`

**`create(userId, storeId, dto)`**
1. `assertCanMutateProducts(userId, storeId)` — ownership + store-status gate.
2. Generate per-store unique slug via `generateUniqueSlug(storeId, dto.name)`.
3. `prisma.storeCollection.create(...)` with trimmed `name`, `description`, and raw `imageUrl`/`sortOrder`.

**`update(userId, storeId, collectionId, dto)`**
1. `assertCanMutateProducts(userId, storeId)`.
2. `assertCollectionBelongsToStore(collectionId, storeId)` — 404 on mismatch.
3. `prisma.storeCollection.update(...)` with trimmed fields.

Note: Updating `name` does **not** regenerate the slug. Slugs are immutable after creation to avoid breaking bookmarked URLs.

**`delete(userId, storeId, collectionId)`**
1. `assertCanMutateProducts(userId, storeId)`.
2. `assertCollectionBelongsToStore(collectionId, storeId)`.
3. `prisma.storeCollection.delete(...)` — cascade removes `ProductCollection` join records.
4. Returns `{ success: true }`.

### Private Helpers

**`assertCanMutateProducts(userId, storeId)`** — Same pattern as all sub-services. Checks `storeService.canManageStore()` then verifies store status is `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE`.

**`assertCollectionBelongsToStore(collectionId, storeId)`** — Finds collection by ID, verifies `collection.storeId === storeId`. Returns 404 on mismatch to prevent cross-store enumeration.

**`generateUniqueSlug(storeId, name)`** — Slugifies the name, then loops checking `storeId_slug` uniqueness. Appends `-2`, `-3`, etc. on collision.

### Error Cases

| Scenario                         | HTTP | Message                                     |
|----------------------------------|------|---------------------------------------------|
| Not store owner/employee         | 403  | You do not have permission to manage...     |
| Store status not allowed         | 403  | Cannot manage collections on a store with...  |
| Store not found                  | 404  | Store not found                             |
| Collection not in this store     | 404  | Collection not found                        |

---

## Step 16 — Collection–Product Membership

### What Step 16 Accomplishes

Merchants can add products to a collection and remove them. This is the join between `StoreCollection` and `Product` via the `ProductCollection` table.

### Schema Recap

```prisma
model ProductCollection {
  productId    String
  collectionId String

  product      Product          @relation(fields: [productId], references: [id])
  collection   StoreCollection  @relation(fields: [collectionId], references: [id])

  @@id([productId, collectionId])
}
```

### Endpoints

| Method   | Path                                                                    | Auth     | Status |
|----------|-------------------------------------------------------------------------|----------|--------|
| `POST`   | `/stores/:storeId/collections/:collectionId/products/:productId`        | MERCHANT | 200    |
| `DELETE` | `/stores/:storeId/collections/:collectionId/products/:productId`        | MERCHANT | 200    |

### Service Logic

**`addProduct(userId, storeId, collectionId, productId)`**
1. `assertCanMutateProducts(userId, storeId)`.
2. `assertCollectionBelongsToStore(collectionId, storeId)`.
3. **Cross-store guard:** Fetch product, verify `product.storeId === storeId`. If product not found or belongs to another store → 404 (not 403, to prevent enumeration).
4. **Idempotency check:** Look up existing `ProductCollection` by composite key `{ productId, collectionId }`. If already exists → return existing record (200).
5. Otherwise, create the `ProductCollection` link.

**`removeProduct(userId, storeId, collectionId, productId)`**
1. `assertCanMutateProducts(userId, storeId)`.
2. `assertCollectionBelongsToStore(collectionId, storeId)`.
3. Find the `ProductCollection` link. If not found → 404 "Product is not in this collection".
4. Delete the link. Return `{ success: true }`.

### Error Cases

| Scenario                                    | HTTP | Message                           |
|---------------------------------------------|------|-----------------------------------|
| Product not found or belongs to other store | 404  | Product not found                 |
| Product not in this collection              | 404  | Product is not in this collection |
| Already in collection (idempotent)          | 200  | Returns existing record           |

---

## Step 17 — Public Collection Listing

### What Step 17 Accomplishes

Public buyers can browse a store's collections. This enables storefront collection navigation (e.g. "Shop by Collection" grid on a store page).

### Endpoint

| Method | Path                           | Auth   | Status |
|--------|--------------------------------|--------|--------|
| `GET`  | `/stores/:slug/collections`    | Public | 200    |

Note: Uses store **slug** (not UUID) in the URL — this is the public-facing route.

### Controller — `PublicCollectionController`

```typescript
@Controller('stores/:slug/collections')
export class PublicCollectionController {
  @Public()
  @Get()
  getPublicCollections(@Param('slug') slug: string) {
    return this.collectionService.getPublicCollections(slug);
  }
}
```

### Service Logic — `getPublicCollections(storeSlug)`

1. **Store lookup + ACTIVE gate:** Find store by slug. If not found or `status !== 'ACTIVE'` → 404.
2. **Fetch collections** with `select` allowlist:
   - `id`, `name`, `slug`, `description`, `imageUrl`, `sortOrder`
   - `_count: { select: { products: true } }` — product count per collection
3. **Order by** `sortOrder ASC`.
4. **Map response** — flattens `_count.products` to `productCount` for cleaner API shape.

### Response Shape

```json
[
  {
    "id": "uuid",
    "name": "Summer Drop",
    "slug": "summer-drop",
    "description": "Our latest summer collection",
    "imageUrl": "https://...",
    "sortOrder": 0,
    "productCount": 12
  }
]
```

### Error Cases

| Scenario                              | HTTP | Message         |
|---------------------------------------|------|-----------------|
| Store not found or status not ACTIVE  | 404  | Store not found |

---

## Step 18 — Module Registration

All Phase 5 components are registered in `ProductModule`:

```typescript
@Module({
  imports: [StoreModule],
  controllers: [
    // ...Phase 3-4 controllers
    CollectionController,
    PublicCollectionController,
  ],
  providers: [
    // ...Phase 3-4 services
    CollectionService,
  ],
})
export class ProductModule {}
```

---

## API Endpoints Summary (Steps 15–18)

| Step | Method   | Path                                                                 | Auth     | Description                        |
|------|----------|----------------------------------------------------------------------|----------|------------------------------------|
| 15   | `POST`   | `/stores/:storeId/collections`                                       | MERCHANT | Create collection                  |
| 15   | `PATCH`  | `/stores/:storeId/collections/:collectionId`                         | MERCHANT | Update collection                  |
| 15   | `DELETE` | `/stores/:storeId/collections/:collectionId`                         | MERCHANT | Delete collection                  |
| 16   | `POST`   | `/stores/:storeId/collections/:collectionId/products/:productId`     | MERCHANT | Add product to collection          |
| 16   | `DELETE` | `/stores/:storeId/collections/:collectionId/products/:productId`     | MERCHANT | Remove product from collection     |
| 17   | `GET`    | `/stores/:slug/collections`                                          | Public   | List store collections (public)    |
