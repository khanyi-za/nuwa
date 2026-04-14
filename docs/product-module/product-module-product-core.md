# YIIVA — Product Module: Product Core (Steps 6–10)

> Merchant-side product CRUD: create, update, activate, archive, delete.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

1. [Context](#context)
2. [Step 6 — Merchant: Create Product (Draft)](#step-6--merchant-create-product-draft)
3. [Step 7 — Merchant: Update Product](#step-7--merchant-update-product)
4. [Step 8 — Merchant: Activate Product](#step-8--merchant-activate-product)
5. [Step 9 — Merchant: Archive Product](#step-9--merchant-archive-product)
6. [Step 10 — Merchant: Delete Product](#step-10--merchant-delete-product)
7. [API Endpoints Summary (Steps 6–10)](#api-endpoints-summary-steps-610)

---

## Context

Phase 2 built the platform-wide category taxonomy. Phase 3 builds the merchant side: the actual product CRUD that merchants use to populate their stores. This is the heart of the Product module and the part merchants interact with most.

The flow mirrors how a real merchant works. They create a product in `DRAFT`, fill in the details over time (often across multiple sessions), attach images, link categories, optionally define variants, and only when everything looks right do they activate it. Activation flips the status from `DRAFT` to `ACTIVE` and makes the product visible to buyers in the catalog. Unlike stores — which require admin review before going live — products do **not** have an admin review gate. The merchant is fully responsible for what they publish.

**Architectural patterns established in Phase 3** (referenced by every step in this phase and reused later in Phases 4 and 5):

- **Ownership check via Store module.** Every merchant-facing endpoint calls `StoreService.canManageStore(userId, storeId)`. This is the single source of truth for "is this user allowed to act on this store?" — it covers both the store owner and any employees with the right scope. The Product module never inspects `Store.userId` directly. This honours the cross-module dependency rule from Step 1: Product → Store, never the reverse.

- **Store status gate.** Merchants can only mutate products on stores in `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE` status. Stores in `DRAFT`, `PENDING_REVIEW`, `SUSPENDED`, or `CLOSED` cannot have products created, updated, activated, or deleted. This check runs in every product mutation endpoint, immediately after the ownership check. It prevents merchants from building a catalog before they've been approved by YIIVA.

- **Per-store slug uniqueness.** Product slugs are unique per store, not platform-wide. Two different stores can both sell a product called `vintage-tee` — the URL will be disambiguated by the store slug (`/stores/brand-a/products/vintage-tee` vs `/stores/brand-b/products/vintage-tee`). This matches how `StoreCollection` handles slugs and contrasts with `Category`, where slugs are global. The schema enforces this with `@@unique([storeId, slug])` on the `Product` model.

- **DRAFT is the default.** Every product is born in `DRAFT`. There is no way to create a product directly in `ACTIVE`. Activation is always an explicit second step (Step 8) so the merchant has a clear moment of "this is ready to publish."

**Phase 3 covers five endpoints, all nested under the merchant's store:**

- `POST /stores/:storeId/products` — Create a draft (Step 6)
- `PATCH /stores/:storeId/products/:id` — Update a draft or active product (Step 7)
- `POST /stores/:storeId/products/:id/activate` — Flip DRAFT → ACTIVE with validation (Step 8)
- `POST /stores/:storeId/products/:id/archive` — Flip ACTIVE → ARCHIVED (Step 9)
- `DELETE /stores/:storeId/products/:id` — Hard delete (only DRAFT) (Step 10)

All five live in `src/product/product.controller.ts` and `src/product/product.service.ts`, scaffolded in Step 1.

---

## Step 6 — Merchant: Create Product (Draft)

### What Step 6 Accomplishes

A merchant creates a new product in their store. The product is born in `DRAFT` status, with only the bare minimum required fields. Everything else — images, variants, categories, tags, collections — is added later through the sub-resource endpoints in Phase 4. This step is intentionally permissive: the merchant should be able to create a placeholder quickly, then come back and fill in the details over time without ever hitting validation friction. The strict validation happens at activation (Step 8), not at creation.

### Endpoint

```
POST /stores/:storeId/products
```

**Auth:** `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.MERCHANT)`
**Throttling:** Global default (100 req/min)

### Schema Recap

The `Product` model already exists in `schema.prisma` (no migration needed for Phase 3):

```prisma
model Product {
  id              String        @id @default(cuid())
  storeId         String
  title           String
  slug            String
  description     String?
  status          ProductStatus @default(DRAFT)

  // Pricing (in ZAR cents — avoids floating-point issues)
  priceInCents        Int
  comparePriceInCents Int?
  costInCents         Int?

  // Inventory
  sku              String?
  totalStock       Int      @default(0)
  lowStockThreshold Int     @default(5)

  // Shipping
  weightInGrams Int?
  lengthCm      Float?
  widthCm       Float?
  heightCm      Float?

  // SEO / Discovery
  metaTitle       String?
  metaDescription String?

  // Metrics (denormalized)
  totalSold     Int     @default(0)
  viewCount     Int     @default(0)
  averageRating Float   @default(0)
  reviewCount   Int     @default(0)

  isFeatured  Boolean   @default(false)
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  store       Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  variants    ProductVariant[]
  images      ProductImage[]
  categories  ProductCategory[]
  tags        ProductTag[]
  collections ProductCollection[]
  // ... reviews, wishlistItems, cartItems, orderItems, contentProducts

  @@unique([storeId, slug])
  @@index([storeId])
  @@index([status])
  @@index([priceInCents])
  @@index([createdAt])
  @@index([isFeatured])
  @@map("products")
}
```

The relevant `ProductStatus` enum values for Phase 3: `DRAFT`, `ACTIVE`, `ARCHIVED`. (`OUT_OF_STOCK` exists in the schema for future use but is not touched in this phase.)

Note: `slug` is unique per store via `@@unique([storeId, slug])` — not globally. All prices are stored as ZAR cents (integers). `priceInCents` is required even for drafts; merchants can pass `0` as a placeholder and update it later. `publishedAt` is set when the product is first activated.

### DTO: create-product.dto.ts

Location: `src/product/dto/create-product.dto.ts`

```typescript
import { IsString, IsOptional, IsInt, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @Length(2, 120)
  title: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceInCents: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comparePriceInCents?: number;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalStock?: number;
}
```

Only `title` and `priceInCents` are strictly required. Everything else is optional at the DRAFT stage. The merchant can save a barely-filled product and come back to it. Prices are always ZAR cents — R249.00 = `priceInCents: 24900`.

### Slug Generation

Slugs are generated using `src/product/utils/slugify.ts` (the same utility used in Phase 2 for categories). Uniqueness is **scoped to the store**, not the platform — the lookup query and collision strategy must respect that scope.

```typescript
private async generateUniqueSlug(storeId: string, title: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;

  while (
    await this.prisma.product.findUnique({
      where: { storeId_slug: { storeId, slug: candidate } },
    })
  ) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  return candidate;
}
```

Two products in the same store named "Vintage Tee" produce `vintage-tee` and `vintage-tee-2`. Two products in **different** stores can both have the slug `vintage-tee` — there is no conflict.

### Service Logic: create()

Location: `src/product/product.service.ts`

The two recurring checks (ownership + store status gate) are extracted into a private `assertCanMutateProducts(userId, storeId)` helper that every mutation method calls first. This avoids repeating the same 15 lines across all five service methods.

```typescript
async create(userId: string, storeId: string, dto: CreateProductDto) {
  // 1. Ownership check + store status gate (via shared private helper)
  await this.assertCanMutateProducts(userId, storeId);

  // 2. Generate per-store unique slug
  const slug = await this.generateUniqueSlug(storeId, dto.title);

  // 3. Create the product in DRAFT
  return this.prisma.product.create({
    data: {
      storeId,
      title: dto.title.trim(),
      slug,
      description: dto.description?.trim(),
      priceInCents: dto.priceInCents,
      comparePriceInCents: dto.comparePriceInCents,
      sku: dto.sku?.trim(),
      totalStock: dto.totalStock ?? 0,
      status: ProductStatus.DRAFT,
    },
  });
}

// Called at the top of every mutation method.
private async assertCanMutateProducts(userId: string, storeId: string): Promise<void> {
  const canManage = await this.storeService.canManageStore(userId, storeId);
  if (!canManage) {
    throw new ForbiddenException('You do not have permission to manage this store');
  }

  const store = await this.prisma.store.findUnique({
    where: { id: storeId },
    select: { status: true },
  });
  if (!store) {
    throw new NotFoundException('Store not found');
  }

  const allowedStatuses: StoreStatus[] = [
    StoreStatus.APPROVED,
    StoreStatus.PENDING_GO_LIVE,
    StoreStatus.ACTIVE,
  ];
  if (!allowedStatuses.includes(store.status)) {
    throw new ForbiddenException(
      `Cannot manage products on a store with status ${store.status}. Store must be approved first.`,
    );
  }
}
```

### Controller

Location: `src/product/product.controller.ts`

`JwtAuthGuard` is globally registered via `APP_GUARD` in `AuthModule` — it applies to every route automatically. `RolesGuard` and `@Roles` are applied at the **controller class level** since all five product routes share the same `MERCHANT` role requirement — no need to repeat them per method.

```typescript
@Controller('stores/:storeId/products')
@UseGuards(RolesGuard)
@Roles(UserRole.MERCHANT)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productService.create(userId, storeId, dto);
  }
}
```

### Response Shape

`201 Created`:

```json
{
  "id": "clxprod0001abcdef",
  "storeId": "clxstore123",
  "title": "Vintage Tee",
  "slug": "vintage-tee",
  "description": null,
  "priceInCents": 24900,
  "comparePriceInCents": null,
  "costInCents": null,
  "sku": null,
  "totalStock": 0,
  "status": "DRAFT",
  "publishedAt": null,
  "createdAt": "2026-04-11T10:23:14.000Z",
  "updatedAt": "2026-04-11T10:23:14.000Z"
}
```

### Step 6 Error Cases

| Status | Cause | Response message |
|---|---|---|
| `400` | DTO validation failed | Array of validation errors |
| `401` | No JWT or invalid JWT | `"Authentication required"` / `"Invalid access token"` |
| `403` | Not MERCHANT, or `canManageStore` returned false | `"You do not have permission to manage this store"` |
| `403` | Store status is not `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` | `"Cannot create products on a store with status X. Store must be approved first."` |
| `404` | `storeId` does not resolve | `"Store not found"` |

All errors follow the standard NestJS shape: `{ statusCode, message, error }`.

### What We're NOT Doing in Step 6

- **Images, variants, categories, tags, collections.** All sub-resources are added through dedicated endpoints in Phase 4. Step 6 creates the bare product row only.
- **Required-field validation for publishing.** A merchant can create a product with `priceInCents: 0`, no description, no SKU, no stock. Strict validation lives at activation (Step 8), not creation.
- **Auto-activation.** No `?activate=true` shortcut. Merchants must explicitly call the activation endpoint after the product is fully populated.
- **Bulk creation.** One product per request.

---

## Step 7 — Merchant: Update Product

### What Step 7 Accomplishes

A merchant edits an existing product. The endpoint works on both `DRAFT` and `ACTIVE` products — there is no separate "edit live product" flow. All fields from `CreateProductDto` are editable except the slug, which is immutable after creation (same rule as `Category` in Phase 2: URL stability matters more than name accuracy). Status transitions are **not** handled here — flipping DRAFT → ACTIVE goes through Step 8, ACTIVE → ARCHIVED through Step 9. Step 7 only edits content fields.

### Endpoint

```
PATCH /stores/:storeId/products/:id
```

**Auth:** `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.MERCHANT)`

### DTO: update-product.dto.ts

Location: `src/product/dto/update-product.dto.ts`

All fields optional. Same validation rules as `CreateProductDto`.

```typescript
import { IsString, IsOptional, IsInt, Min, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceInCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comparePriceInCents?: number;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalStock?: number;
}
```

Note that there is no `status` field on this DTO. Status changes go through dedicated endpoints (Steps 8 and 9), never through PATCH. This prevents accidental status flips and keeps each transition observable as its own audited action.

### Service Logic: update()

```typescript
async update(
  userId: string,
  storeId: string,
  productId: string,
  dto: UpdateProductDto,
) {
  // 1. Ownership check + store status gate
  await this.assertCanMutateProducts(userId, storeId);

  // 2. Confirm the product exists and belongs to this store
  const product = await this.prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, storeId: true, status: true },
  });
  if (!product || product.storeId !== storeId) {
    throw new NotFoundException('Product not found'); // 404, not 403 — don't leak existence
  }

  // 3. Block updates on archived products
  if (product.status === ProductStatus.ARCHIVED) {
    throw new ConflictException(
      'Cannot update an archived product. Create a new product instead.',
    );
  }

  // 4. Apply the update (slug is intentionally never touched)
  return this.prisma.product.update({
    where: { id: productId },
    data: {
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      priceInCents: dto.priceInCents,
      comparePriceInCents: dto.comparePriceInCents,
      sku: dto.sku?.trim(),
      totalStock: dto.totalStock,
    },
  });
}
```

A few details worth highlighting:

- **The store-mismatch case returns 404, not 403.** If the product exists but belongs to a different store than the URL says, we return "Product not found" rather than "Forbidden." This avoids leaking the existence of products in other stores to a merchant who guesses IDs.
- **Archived products are read-only.** Once a product is archived, it cannot be edited. The merchant must create a new product. Phase 3 treats archive as a one-way operation for simplicity.
- **No partial-field validation tied to status.** A merchant can set `priceInCents: 0` on an `ACTIVE` product if they want to. That's their call. We don't second-guess merchant decisions on live products in Phase 3 — order-aware safeguards (e.g., warning when changing price on a product with open orders) belong in a later iteration.

### Controller

```typescript
@Patch(':id')
update(
  @CurrentUser('id') userId: string,
  @Param('storeId') storeId: string,
  @Param('id') productId: string,
  @Body() dto: UpdateProductDto,
) {
  return this.productService.update(userId, storeId, productId, dto);
}
```

### Response Shape

`200 OK` — same shape as the Step 6 response, with the updated field values.

### Step 7 Error Cases

| Status | Cause |
|---|---|
| `400` | DTO validation failed |
| `401` | No JWT or invalid JWT |
| `403` | Not MERCHANT, or `canManageStore` returned false |
| `403` | Store status is not `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` |
| `404` | `storeId` not found, or `productId` not found, or product belongs to a different store |
| `409` | Product is `ARCHIVED` (read-only) |

### What We're NOT Doing in Step 7

- **Status changes.** No `status` field on the DTO. Status flips go through dedicated endpoints (Steps 8 and 9).
- **Slug regeneration.** Slugs are immutable after creation. URL stability matters more than name accuracy — same rule as `Category` in Phase 2.
- **Sub-resource updates.** Images, variants, categories, tags, and collections are managed through their own endpoints in Phase 4. PATCH does not accept nested arrays.
- **Order-aware safeguards.** Editing price/stock on a product with open orders is allowed without warning in Phase 3. Order-aware safeguards (e.g., "this product has 3 open orders — are you sure?") belong in a later iteration.
- **Reactivating archived products.** Treated as out of scope for Phase 3. If a merchant needs an archived product back, they create a new one. A reactivation endpoint can be added later if real usage demands it.

---

## Step 8 — Merchant: Activate Product

### What Step 8 Accomplishes

A merchant flips a product from `DRAFT` to `ACTIVE`, making it visible to buyers in the catalog. Activation is where the strict validation lives — the create and update endpoints are deliberately permissive so merchants can save partial work, but activation enforces a "ready to publish" contract. If any required field is missing or invalid, the request is rejected and the response lists **every** problem at once, not one at a time, so the merchant can fix everything in a single pass and try again.

This step is the spiritual equivalent of the Store module's "submit for review," but without an admin gate. The merchant is fully responsible for what they publish — there is no YIIVA staff in the loop. The validation contract is what protects buyers from broken or incomplete listings.

### Endpoint

`POST /stores/:storeId/products/:id/activate`

Auth: `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.MERCHANT)`. No request body — the action is the entire intent.

### Functionality and Logic

The service method `activate(userId, storeId, productId)` runs in this order:

1. **Ownership check** via `StoreService.canManageStore`. Same as Steps 6 and 7.
2. **Store status gate.** Same `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` rule. A merchant whose store has been suspended cannot activate new products even if the products themselves are valid.
3. **Load the product with all its relations needed for validation.** A single Prisma query fetches the product plus counts of its images, linked platform categories, and (if applicable) variants. This avoids multiple round-trips during the validation pass.
4. **Verify the product belongs to the store in the URL.** Same 404-not-403 rule as Step 7 to avoid leaking existence.
5. **Verify the product is currently `DRAFT`.** If it's already `ACTIVE`, the request is a no-op success (200, return the product as-is). If it's `ARCHIVED`, the request is rejected — archived products cannot be reactivated in Phase 3.
6. **Run the activation validation contract** (described in detail below). Collect every failure into an array. If the array is non-empty, throw a `BadRequestException` whose `message` is that array — matching the validation-error shape from the auth guide where `message` is a string array for 400s.
7. **Flip the status** from `DRAFT` to `ACTIVE` in a single Prisma update. Also sets `publishedAt` to the current timestamp — this is the canonical "when did this product go live" field. Return the updated product.

### The Activation Validation Contract

A product is "ready to publish" when **all** of the following are true. Each failed check produces one entry in the error array:

- **Title** is present and at least 2 characters. (Normally guaranteed by Step 6, but defensive — the row could have been seeded by a script.)
- **Price** is greater than zero. A draft can have `priceInCents: 0` as a placeholder; an active product cannot be free.
- **At least one image** (`mediaType: IMAGE`) is linked via `ProductImage`. Video-only products fail this check — buyers need a photo. Products with both images and videos satisfy it.
- **At least one platform category** is linked via `ProductCategory`. Required before a product can be published — categories drive platform-wide discovery.
- **If the product has variants**, at least one variant must have `stock > 0`, and every variant with an explicit `priceInCents` override must have `priceInCents > 0`. A `null` variant price means "inherit the product price" and is valid. If the product has no variants, this check is skipped.

### Why a Single-Pass Error Array

The most frustrating activation flow is the one where you fix the price, retry, get told you also need an image, fix that, retry, get told you also need a category, and so on. Each round-trip wastes the merchant's time and feels like the system is hiding problems. By collecting every failure in one pass and returning them as an array, the merchant sees the full checklist on the first try and can fix everything before retrying. This is the same UX principle the auth module follows for password validation (returning multiple `class-validator` errors at once).

The response shape on validation failure exactly matches NestJS's standard 400 with `message: string[]`:

```json
{
  "statusCode": 400,
  "message": [
    "Price must be greater than zero",
    "Product must have at least one image",
    "Product must be linked to at least one platform category"
  ],
  "error": "Bad Request"
}
```

### Response Shape (Success)

`200 OK`. The full product row with `status: "ACTIVE"` and a refreshed `updatedAt`. Same shape as the Step 6/7 responses.

### DTOs

None. The endpoint takes no request body — the URL plus the merchant's identity is the entire intent. Validation happens against the existing database row, not against incoming user input. This is deliberate: activation is a verb on a resource, not a content edit.

### Error Cases

| Status | Cause |
|---|---|
| `400` | Activation validation contract failed (one or more fields missing/invalid) — `message` is a string array |
| `401` | No JWT or invalid JWT |
| `403` | Not MERCHANT, or `canManageStore` returned false |
| `403` | Store status is not `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` |
| `404` | `storeId` not found, or `productId` not found, or product belongs to a different store |
| `409` | Product is `ARCHIVED` — cannot be reactivated in Phase 3 |
| `200` | Product is already `ACTIVE` — idempotent no-op success |

The idempotent `200` for already-active products is a deliberate UX choice. If a merchant clicks "Activate" twice, or two browser tabs race the same action, the second call should succeed silently rather than throw a confusing error. This matches REST conventions for idempotent actions.

### What We're NOT Doing in Step 8

- **Admin review.** Explicitly out of scope for the entire Product module per the locked-in architectural decisions. Merchants self-publish.
- **Scheduled activation.** No "go live at 9am tomorrow" feature. Activation is immediate.
- **Notifications on activation.** No email or push to followers. Notification triggers belong in a separate Notifications module wired up later.
- **Search index updates.** When search comes online, indexing will be triggered by a database event or queue, not by this endpoint directly. Step 8 stays focused on the state transition.
- **Reactivating archived products.** Same exclusion as Step 7. Archive is one-way in Phase 3.
- **Variant-level activation.** Variants are part of the parent product's lifecycle. There is no separate "activate this variant" endpoint.

---

## Step 9 — Merchant: Archive Product

### What Step 9 Accomplishes

A merchant takes a product off sale without deleting it. Archive is the soft-removal path: the product flips from `ACTIVE` to `ARCHIVED`, becomes invisible to buyers immediately, but remains in the database with all its history intact. Order references, reviews, analytics, and any past customer interactions all stay linked to the row. This is the right tool for "we're not selling this anymore" — discontinued lines, sold-out limited editions, seasonal items going off-catalog.

Archive is intentionally one-way in Phase 3. There is no reactivation endpoint. If a merchant wants the product back on sale, they create a new one. This keeps the state machine simple and avoids edge cases around stale data, outdated images, and reactivated products with hanging order references.

### Endpoint

`POST /stores/:storeId/products/:id/archive`

Auth: `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.MERCHANT)`. No request body.

### Functionality and Logic

The service method `archive(userId, storeId, productId)` runs in this order:

1. **Ownership check** via `StoreService.canManageStore`.
2. **Store status gate.** Same `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` rule as the rest of Phase 3.
3. **Load the product** and verify it exists and belongs to the store in the URL (404-not-403 rule).
4. **Verify the current status is `ACTIVE`.** Archive only applies to live products. A `DRAFT` product should be deleted (Step 10), not archived — there's nothing live to take down. An already-`ARCHIVED` product is an idempotent 200 no-op, same pattern as Step 8.
5. **Flip the status** from `ACTIVE` to `ARCHIVED` in a single Prisma update. Return the updated product.

No cascading happens. Sub-resources (images, variants, categories, tags, collection memberships) stay attached to the archived row — they're invisible to buyers because the parent product is filtered out of every public read endpoint, but they're preserved in case you ever need to inspect what an archived product used to look like.

### DTOs

None. Same reasoning as Step 8 — archive is a verb on a resource, not a content edit.

### Error Cases

| Status | Cause |
|---|---|
| `401` | No JWT or invalid JWT |
| `403` | Not MERCHANT, or `canManageStore` returned false |
| `403` | Store status is not `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` |
| `404` | `storeId` not found, or `productId` not found, or product belongs to a different store |
| `409` | Product is `DRAFT` — drafts should be deleted, not archived |
| `200` | Product is already `ARCHIVED` — idempotent no-op success |

### What We're NOT Doing in Step 9

- **Reactivation.** Archive is one-way in Phase 3. No `POST /products/:id/reactivate` endpoint.
- **Bulk archive.** One product per request.
- **Buyer notifications.** Followers of the brand are not notified when a product is archived. That belongs in a future Notifications module.
- **Cleanup of cart and wishlist references.** If a buyer has an archived product in their cart or wishlist, the row stays but read endpoints will need to handle the archived state gracefully. That's a Cart/Wishlist module concern, not Phase 3's.

---

## Step 10 — Merchant: Delete Product

### What Step 10 Accomplishes

A merchant permanently removes a product that was never published. Delete is the hard-removal path: the row is gone, the slug becomes available for reuse, and all sub-resources (images, variants, categories, tags, collection memberships) cascade-delete along with the parent. This is **only** allowed on `DRAFT` products. Once a product has gone `ACTIVE` even once, it can never be hard-deleted — the merchant must use archive instead. This preserves order history, review history, and audit integrity.

The rule is simple: drafts can be deleted because nothing real has happened to them yet. Anything that's been live has accumulated state we're not willing to lose.

### Endpoint

`DELETE /stores/:storeId/products/:id`

Auth: `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.MERCHANT)`. No request body.

### Functionality and Logic

The service method `delete(userId, storeId, productId)` runs in this order:

1. **Ownership check** via `StoreService.canManageStore`.
2. **Store status gate.** Same rule.
3. **Load the product** and verify it exists and belongs to the store in the URL (404-not-403 rule).
4. **Verify the current status is `DRAFT`.** If the product is `ACTIVE` or `ARCHIVED`, the request is rejected with a 409 explaining that only drafts can be deleted and pointing the merchant toward the archive endpoint.
5. **Delete the product** via `prisma.product.delete`. The schema's cascade rules on `ProductImage`, `ProductVariant`, `ProductCategory`, `ProductTag`, and `ProductCollection` foreign keys handle the sub-resource cleanup automatically — no manual deletion of children needed.
6. **Return a success envelope.** Same shape as Phase 2's category delete: `{ success: true }`.

### DTOs

None.

### Error Cases

| Status | Cause |
|---|---|
| `401` | No JWT or invalid JWT |
| `403` | Not MERCHANT, or `canManageStore` returned false |
| `403` | Store status is not `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` |
| `404` | `storeId` not found, or `productId` not found, or product belongs to a different store |
| `409` | Product is `ACTIVE` or `ARCHIVED` — only `DRAFT` products can be deleted. The error message explicitly suggests using archive instead. |

### What We're NOT Doing in Step 10

- **Soft delete on active products.** That's what archive is for. Delete is reserved for drafts.
- **Cascade override.** The schema's cascade rules are trusted to handle sub-resource cleanup. No manual `deleteMany` calls in service code.
- **Undo / restore from trash.** Once deleted, gone. If a merchant deletes a draft by mistake, they recreate it. A trash-and-restore system can be added later if real usage demands it.
- **Audit log of deletions.** Out of scope for Phase 3. A general audit-logging story belongs to a cross-cutting concern, not the Product module specifically.

---

## API Endpoints Summary (Steps 6–10)

| Method | Path | Auth | Purpose | Step |
|---|---|---|---|---|
| `POST` | `/stores/:storeId/products` | MERCHANT | Create a product in DRAFT | 6 |
| `PATCH` | `/stores/:storeId/products/:id` | MERCHANT | Update content fields on DRAFT or ACTIVE | 7 |
| `POST` | `/stores/:storeId/products/:id/activate` | MERCHANT | Validate and flip DRAFT → ACTIVE | 8 |
| `POST` | `/stores/:storeId/products/:id/archive` | MERCHANT | Flip ACTIVE → ARCHIVED (one-way) | 9 |
| `DELETE` | `/stores/:storeId/products/:id` | MERCHANT | Hard-delete a DRAFT product | 10 |

---

## Phase 3 Deliverables

When Phase 3 is complete:

1. `src/product/product.controller.ts` exposes all five routes above, all nested under `/stores/:storeId/products`.
2. `src/product/product.service.ts` implements `create()`, `update()`, `activate()`, `archive()`, `delete()`, plus the private helper `generateUniqueSlug(storeId, name)`.
3. `src/product/dto/create-product.dto.ts` and `src/product/dto/update-product.dto.ts` are wired in. Steps 8, 9, and 10 take no DTOs.
4. The slugify utility from Step 1 is reused for per-store slug generation.
5. Every mutation endpoint calls `StoreService.canManageStore()` for the ownership check and enforces the `APPROVED`/`PENDING_GO_LIVE`/`ACTIVE` store-status gate before touching any product data.
6. The activation contract in Step 8 returns a string-array `400` listing every failing check at once, never one at a time.
7. The state machine is enforced: products are born `DRAFT`, can be edited at any non-archived status, can flip to `ACTIVE` only via Step 8, can flip to `ARCHIVED` only via Step 9, and can be hard-deleted only while still `DRAFT`.
8. A merchant can take a brand new product from `POST /stores/:storeId/products` through `activate` and out to a buyer-visible state end-to-end (pending the public read endpoints in Phase 6).

From here, Phase 4 (Steps 11–14) builds the product sub-resources — images, variants, platform category links, and tags — that the activation contract in Step 8 depends on. Until Phase 4 is live, the activation endpoint will reject every product because no product can satisfy the "at least one image" and "at least one platform category" requirements. Phase 4 is the natural next priority.

