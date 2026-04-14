# YIIVA — Product Module: Product Views (Steps 19–24)

> Merchant product listing, product detail, public catalog, and storefront views.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

1. [Context](#context)
2. [Step 19 — Merchant Product List](#step-19--merchant-product-list)
3. [Step 20 — Merchant Product Detail](#step-20--merchant-product-detail)
4. [Step 21 — Public Product Detail](#step-21--public-product-detail)
5. [Step 22 — Global Public Catalog](#step-22--global-public-catalog)
6. [Step 23 — Category Landing Page](#step-23--category-landing-page)
7. [Step 24 — Store Public Catalog](#step-24--store-public-catalog)
8. [API Endpoints Summary (Steps 19–24)](#api-endpoints-summary-steps-1924)

---

## Context

Phase 6 adds the read layer — the views that let merchants manage their inventory and buyers discover products. These endpoints are purely read-only; no mutations happen here.

**Two audiences, two levels of data exposure:**

- **Merchant views (Steps 19–20):** Full data access. All fields, all statuses, all relations. Guarded by ownership check (`canManageStore`). No store-status gate — merchants can view their product list even on a `PENDING_REVIEW` store.

- **Public views (Steps 21–24):** Restricted data exposure. Uses `select` allowlists (not `include`) to prevent accidental field leaks. Only shows `ACTIVE` products on `ACTIVE` stores. Internal fields like `storeId` and `status` are never exposed.

**Key architectural patterns in Phase 6:**

- **Select-allowlist pattern for public endpoints.** Every public query uses explicit `select: { ... }` rather than `include` + destructure denylist. This is a security-by-default pattern — new schema columns are hidden until explicitly added to the select.

- **Tree-inclusive category matching.** When filtering by category (Steps 22, 23), the system finds all descendant category IDs via BFS (`getDescendantIds`) and queries with `{ in: allIds }`. Selecting "Fashion" also returns products tagged "Streetwear" or "Formal" if those are children of "Fashion".

- **`effectivePriceInCents` computation.** Public product detail (Step 21) computes `effectivePriceInCents` on each variant: if the variant has a `priceInCents` override, use it; otherwise fall back to the product's `priceInCents`. This is a runtime computation, not stored in the database.

- **ProductService now injects CategoryService.** Required for `getDescendantIds()` in the public catalog filter. This is safe because CategoryService does not depend on ProductService (no circular dependency).

**New controllers introduced in Phase 6:**

- `PublicProductController` at `stores/:slug/products` — store-scoped public product detail and store catalog.
- `PublicCatalogController` at `/products` — global cross-store catalog.

**New DTOs:**

```
src/product/dto/
  list-products.dto.ts    — merchant list filters/sort/pagination
  catalog-query.dto.ts    — public catalog filters/sort/pagination
```

---

## Step 19 — Merchant Product List

### What Step 19 Accomplishes

Merchants can view a paginated, filterable, sortable list of all their products across all statuses. This powers the merchant dashboard's inventory table.

### Endpoint

| Method | Path                            | Auth     | Status |
|--------|---------------------------------|----------|--------|
| `GET`  | `/stores/:storeId/products`     | MERCHANT | 200    |

### DTO — `ListProductsDto`

```typescript
export class ListProductsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number = 20;

  @IsOptional() @IsString()
  status?: ProductStatus | 'all' = 'all';

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  categoryId?: string;

  @IsOptional() @IsString()
  collectionId?: string;

  @IsOptional()
  @IsIn(['newest', 'oldest', 'nameAsc', 'nameDesc', 'priceAsc', 'priceDesc', 'stockAsc'])
  sortBy?: string = 'newest';
}
```

### Service Logic — `listProducts(userId, storeId, dto)`

1. **Ownership check only** — `canManageStore(userId, storeId)`. No store-status gate. Merchants can view products regardless of store status.

2. **Build `where` clause:**
   - Always scoped to `{ storeId }`.
   - If `status` is provided and not `'all'`, filter by that `ProductStatus`.
   - If `search` is provided, match on `title` OR `sku` (case-insensitive `contains`).
   - If `categoryId` is provided, filter products that have that category link.
   - If `collectionId` is provided, filter products in that collection.

3. **Sort mapping:**

   | `sortBy` value | Prisma orderBy                |
   |----------------|-------------------------------|
   | `newest`       | `{ createdAt: 'desc' }`       |
   | `oldest`       | `{ createdAt: 'asc' }`        |
   | `nameAsc`      | `{ title: 'asc' }`            |
   | `nameDesc`     | `{ title: 'desc' }`           |
   | `priceAsc`     | `{ priceInCents: 'asc' }`     |
   | `priceDesc`    | `{ priceInCents: 'desc' }`    |
   | `stockAsc`     | `{ totalStock: 'asc' }`       |

4. **Paginated query** via `$transaction([count, findMany])` for consistent total/page counts.

5. **Select shape** — summary view with counts:
   - `id`, `title`, `slug`, `status`, `priceInCents`, `comparePriceInCents`, `totalStock`, `createdAt`
   - `_count: { images, variants, categories }` — for dashboard indicators
   - `images` — only the primary image (`where: { isPrimary: true }, take: 1`) with `url` and `altText`

### Response Shape

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Summer Tee",
      "slug": "summer-tee",
      "status": "ACTIVE",
      "priceInCents": 29900,
      "comparePriceInCents": null,
      "totalStock": 50,
      "createdAt": "2026-04-10T...",
      "_count": { "images": 3, "variants": 2, "categories": 1 },
      "images": [{ "url": "https://...", "altText": "Front view" }]
    }
  ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

## Step 20 — Merchant Product Detail

### What Step 20 Accomplishes

Merchants can view the full detail of a single product, including all relations. This powers the merchant product editor page.

### Endpoint

| Method | Path                                  | Auth     | Status |
|--------|---------------------------------------|----------|--------|
| `GET`  | `/stores/:storeId/products/:id`       | MERCHANT | 200    |

### Service Logic — `getProduct(userId, storeId, productId)`

1. **Ownership check** — `canManageStore(userId, storeId)`. No store-status gate.

2. **Full `include` query** — this is the merchant view, so all fields are returned:
   - `images` — ordered by `sortOrder ASC`
   - `variants` — ordered by `sortOrder ASC`
   - `categories` — with nested `category: { id, name, slug }`
   - `tags` — with nested `tag: { id, name, slug }`
   - `collections` — with nested `collection: { id, name, slug }`

3. **Ownership verification** — after fetch, verify `product.storeId === storeId`. Returns 404 on mismatch.

### Response Shape

Full product object with all Prisma fields plus all relations expanded. No field filtering — merchants see everything.

### Error Cases

| Scenario                         | HTTP | Message                                     |
|----------------------------------|------|---------------------------------------------|
| Not store owner/employee         | 403  | You do not have permission to manage...     |
| Product not found or wrong store | 404  | Product not found                           |

---

## Step 21 — Public Product Detail

### What Step 21 Accomplishes

Public buyers can view a product's full detail page. This is the product detail page (PDP) that buyers land on from the catalog or a shared link.

### Endpoint

| Method | Path                                           | Auth   | Status |
|--------|-------------------------------------------------|--------|--------|
| `GET`  | `/stores/:slug/products/:productSlug`           | Public | 200    |

Note: Both store and product are resolved by **slug**, not UUID.

### Service Logic — `getPublicProduct(storeSlug, productSlug)`

1. **Store lookup + ACTIVE gate:**
   - Find store by slug with select: `id`, `status`, `displayName`, `slug`, `logoUrl`, `followerCount`.
   - If not found or `status !== ACTIVE` → 404.

2. **Product lookup via composite key** — `storeId_slug: { storeId, slug: productSlug }`:
   - Uses `select` allowlist (not `include`):
     - `id`, `title`, `slug`, `description`, `status`, `priceInCents`, `comparePriceInCents`, `totalStock`, `publishedAt`
     - `images` — ordered by sortOrder: `id`, `url`, `altText`, `mediaType`, `sortOrder`, `isPrimary`
     - `variants` — ordered by sortOrder: `id`, `name`, `color`, `size`, `material`, `priceInCents`, `stock`, `sortOrder`
     - `categories` — nested: `category.id`, `category.name`, `category.slug`
     - `tags` — nested: `tag.id`, `tag.name`, `tag.slug`
   - `status` is fetched for the ACTIVE gate check but stripped from the response.

3. **ACTIVE gate** — if product not found or `status !== ACTIVE` → 404. Products in DRAFT or ARCHIVED are invisible to public.

4. **Status stripping** — `const { status: _status, ...publicFields } = product;`

5. **`effectivePriceInCents` computation** on variants:
   ```typescript
   variants: product.variants.map((v) => ({
     ...v,
     effectivePriceInCents: v.priceInCents ?? product.priceInCents,
   }))
   ```

6. **Store context** — appended to response for storefront header:
   ```json
   "store": {
     "displayName": "The Drip Store",
     "slug": "the-drip-store",
     "logoUrl": "https://...",
     "followerCount": 1234
   }
   ```

### Why Select-Allowlist (Not Include + Destructure)

The original implementation used `include` (which fetches all columns) and then destructured out unwanted fields. This is brittle:
- Adding a new column to the `Product` schema automatically exposes it in the public API.
- `storeId` (internal UUID) leaked in the public response.

The fix: explicit `select` on every level. New fields are hidden by default — they must be added to the select to appear publicly. Only `status` still needs runtime stripping (required for the ACTIVE gate check, then discarded).

### Response Shape

```json
{
  "id": "uuid",
  "title": "Summer Tee",
  "slug": "summer-tee",
  "description": "A fresh summer t-shirt...",
  "priceInCents": 29900,
  "comparePriceInCents": 35000,
  "totalStock": 50,
  "publishedAt": "2026-04-10T...",
  "images": [
    { "id": "uuid", "url": "https://...", "altText": "...", "mediaType": "IMAGE", "sortOrder": 0, "isPrimary": true }
  ],
  "variants": [
    { "id": "uuid", "name": "Small / Black", "color": "Black", "size": "S", "material": null, "priceInCents": null, "stock": 10, "sortOrder": 0, "effectivePriceInCents": 29900 }
  ],
  "categories": [
    { "category": { "id": "uuid", "name": "Streetwear", "slug": "streetwear" } }
  ],
  "tags": [
    { "tag": { "id": "uuid", "name": "summer", "slug": "summer" } }
  ],
  "store": {
    "displayName": "The Drip Store",
    "slug": "the-drip-store",
    "logoUrl": "https://...",
    "followerCount": 1234
  }
}
```

### Error Cases

| Scenario                                 | HTTP | Message           |
|------------------------------------------|------|-------------------|
| Store not found or not ACTIVE            | 404  | Store not found   |
| Product not found or not ACTIVE          | 404  | Product not found |

---

## Step 22 — Global Public Catalog

### What Step 22 Accomplishes

Public buyers can browse all ACTIVE products across all ACTIVE stores on the platform. This is the YIIVA marketplace landing page — the global discovery surface.

### Endpoint

| Method | Path        | Auth   | Status |
|--------|-------------|--------|--------|
| `GET`  | `/products` | Public | 200    |

### Controller — `PublicCatalogController`

```typescript
@Controller('products')
export class PublicCatalogController {
  @Public()
  @Get()
  getPublicCatalog(@Query() query: CatalogQueryDto) {
    return this.productService.getPublicCatalog(query);
  }
}
```

### DTO — `CatalogQueryDto`

```typescript
export class CatalogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number = 20;

  @IsOptional() @IsString()
  categorySlug?: string;

  @IsOptional() @IsString()
  tagName?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceMin?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceMax?: number;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsIn(['newest', 'priceAsc', 'priceDesc'])
  sortBy?: string = 'newest';

  @IsOptional() @IsString()
  collectionSlug?: string;
}
```

Note: `collectionSlug` is present in the DTO but only used by Step 24 (store catalog). The global catalog ignores it.

### Service Logic — `getPublicCatalog(query)`

1. **Base filter** — always `{ status: ACTIVE, store: { status: ACTIVE } }`. Only products on live stores.

2. **Category filter (tree-inclusive):**
   - Look up category by `categorySlug`. 404 if not found.
   - Call `categoryService.getDescendantIds(category.id)` to get all descendant IDs via BFS.
   - Filter: `categories: { some: { categoryId: { in: allIds } } }`.
   - Example: filtering by "fashion" also matches products tagged "streetwear" (child of "fashion").

3. **Tag filter** — `tags: { some: { tag: { name: query.tagName.trim().toLowerCase() } } }`. Normalized to match the tag normalization from Step 14.

4. **Price range filter** — `priceInCents: { gte: priceMin, lte: priceMax }`. Either bound is optional.

5. **Search** — `title: { contains: query.search, mode: 'insensitive' }`. Title-only search (no SKU in public).

6. **Sort mapping:**

   | `sortBy` value | Prisma orderBy                |
   |----------------|-------------------------------|
   | `newest`       | `{ createdAt: 'desc' }`       |
   | `priceAsc`     | `{ priceInCents: 'asc' }`     |
   | `priceDesc`    | `{ priceInCents: 'desc' }`    |

7. **Paginated query** via `$transaction([count, findMany])`.

8. **Select shape** — catalog card data:
   - `id`, `title`, `slug`, `priceInCents`, `comparePriceInCents`
   - `images` — primary only (`where: { isPrimary: true }, take: 1`) with `url`, `altText`
   - `store` — `displayName`, `slug` (for "Sold by" badge and link)

### Response Shape

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Summer Tee",
      "slug": "summer-tee",
      "priceInCents": 29900,
      "comparePriceInCents": 35000,
      "images": [{ "url": "https://...", "altText": "..." }],
      "store": { "displayName": "The Drip Store", "slug": "the-drip-store" }
    }
  ],
  "meta": { "total": 150, "page": 1, "limit": 20, "totalPages": 8 }
}
```

### Error Cases

| Scenario              | HTTP | Message             |
|-----------------------|------|---------------------|
| Category slug invalid | 404  | Category not found  |

---

## Step 23 — Category Landing Page

### What Step 23 Accomplishes

Public buyers can view all products in a specific platform category, including products in all child categories. This powers category landing pages like `/categories/fashion/products`.

### Endpoint

| Method | Path                              | Auth   | Status |
|--------|-----------------------------------|--------|--------|
| `GET`  | `/categories/:slug/products`      | Public | 200    |

### Service Logic — `CategoryService.getProductsByCategory(slug, query)`

1. **Category lookup** — find by slug. 404 if not found.

2. **Tree-inclusive matching** — `getDescendantIds(category.id)`:
   - Fetches all categories (just `id` and `parentId`).
   - Builds a `childrenMap: Map<parentId, childIds[]>`.
   - BFS walk from the target category, collecting all descendant IDs.
   - Returns `[targetId, ...allDescendantIds]`.

3. **Product filter** — `{ status: ACTIVE, store: { status: ACTIVE }, categories: { some: { categoryId: { in: allCategoryIds } } } }`.

4. **Sort and pagination** — same as global catalog (CatalogQueryDto).

5. **Select shape** — same as global catalog card data, including `store: { displayName, slug }`.

### Response Shape

```json
{
  "category": {
    "id": "uuid",
    "name": "Fashion",
    "slug": "fashion",
    "description": "Clothing and accessories",
    "imageUrl": "https://..."
  },
  "data": [ /* same card shape as global catalog */ ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

Note: The response includes the `category` metadata alongside `data` and `meta`. This allows the frontend to render the category header without a separate API call.

### BFS Walk — `getDescendantIds(categoryId)`

```typescript
async getDescendantIds(categoryId: string): Promise<string[]> {
  const all = await this.prisma.category.findMany({
    select: { id: true, parentId: true },
  });

  const childrenMap = new Map<string, string[]>();
  for (const c of all) {
    if (c.parentId) {
      const siblings = childrenMap.get(c.parentId) ?? [];
      siblings.push(c.id);
      childrenMap.set(c.parentId, siblings);
    }
  }

  const result: string[] = [categoryId];
  const queue = [categoryId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      result.push(child);
      queue.push(child);
    }
  }

  return result;
}
```

This is a public method on `CategoryService`, also used by `ProductService.getPublicCatalog()` in Step 22.

### Error Cases

| Scenario           | HTTP | Message            |
|--------------------|------|--------------------|
| Category not found | 404  | Category not found |

---

## Step 24 — Store Public Catalog

### What Step 24 Accomplishes

Public buyers can browse all ACTIVE products for a specific store, optionally filtered by collection. This is the store's product listing page.

### Endpoint

| Method | Path                              | Auth   | Status |
|--------|-----------------------------------|--------|--------|
| `GET`  | `/stores/:slug/products`          | Public | 200    |

### Controller — `PublicProductController`

```typescript
@Controller('stores/:slug/products')
export class PublicProductController {
  @Public()
  @Get()
  getStorePublicCatalog(
    @Param('slug') slug: string,
    @Query() query: CatalogQueryDto,
  ) { ... }

  @Public()
  @Get(':productSlug')
  getPublicProduct(
    @Param('slug') storeSlug: string,
    @Param('productSlug') productSlug: string,
  ) { ... }
}
```

This controller serves both the store catalog (Step 24) and individual product detail (Step 21).

### Service Logic — `getStorePublicCatalog(storeSlug, query)`

1. **Store lookup + ACTIVE gate** — find by slug. 404 if not found or not ACTIVE.

2. **Base filter** — `{ storeId: store.id, status: ACTIVE }`. Store-scoped, ACTIVE products only.

3. **Collection filter** (unique to store catalog):
   - If `collectionSlug` is provided, look up `StoreCollection` by composite key `storeId_slug: { storeId, slug: collectionSlug }`.
   - If not found → 404.
   - Filter: `collections: { some: { collectionId: collection.id } }`.

4. **Sort and pagination** — same as global catalog.

5. **Select shape** — catalog card data (same as global catalog but without `store` — the store is already known from the URL context):
   - `id`, `title`, `slug`, `priceInCents`, `comparePriceInCents`
   - `images` — primary only

### Response Shape

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Summer Tee",
      "slug": "summer-tee",
      "priceInCents": 29900,
      "comparePriceInCents": 35000,
      "images": [{ "url": "https://...", "altText": "..." }]
    }
  ],
  "meta": { "total": 12, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Note: No `store` object in the card data — the frontend already knows which store it's browsing.

### Error Cases

| Scenario                              | HTTP | Message             |
|---------------------------------------|------|---------------------|
| Store not found or not ACTIVE         | 404  | Store not found     |
| Collection slug not found in store    | 404  | Collection not found|

---

## API Endpoints Summary (Steps 19–24)

| Step | Method | Path                                         | Auth     | Description                      |
|------|--------|----------------------------------------------|----------|----------------------------------|
| 19   | `GET`  | `/stores/:storeId/products`                  | MERCHANT | Merchant product list            |
| 20   | `GET`  | `/stores/:storeId/products/:id`              | MERCHANT | Merchant product detail          |
| 21   | `GET`  | `/stores/:slug/products/:productSlug`        | Public   | Public product detail (PDP)      |
| 22   | `GET`  | `/products`                                  | Public   | Global catalog (marketplace)     |
| 23   | `GET`  | `/categories/:slug/products`                 | Public   | Category landing page            |
| 24   | `GET`  | `/stores/:slug/products`                     | Public   | Store catalog (storefront)       |

### Route Coexistence Note

Steps 19/20 and Steps 21/24 both match `/stores/:param/products`. They coexist because:
- **Merchant routes** use `stores/:storeId/products` where `:storeId` is a UUID, guarded by `@Roles(MERCHANT)`.
- **Public routes** use `stores/:slug/products` where `:slug` is a text slug, decorated with `@Public()`.
- NestJS resolves them to different controllers (`ProductController` vs `PublicProductController`), and the service methods resolve the parameter differently (UUID lookup vs slug lookup).
