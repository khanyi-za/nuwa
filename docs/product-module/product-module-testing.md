# YIIVA — Product Module: Consolidated Testing Plan (Step 25)

> Comprehensive three-layer testing plan covering the entire Product module — every endpoint, every edge case, every state transition.
> Stack: NestJS + Prisma + PostgreSQL + Jest

---

## Table of Contents

- [Context](#context)
- [Testing Philosophy](#testing-philosophy)
- [Test Setup](#test-setup)
  - [Test Database](#test-database)
  - [Mock Configuration](#mock-configuration)
  - [Test Utilities](#test-utilities)
- [Layer 1 — Unit Tests](#layer-1--unit-tests)
  - [What Unit Tests Cover](#what-unit-tests-cover)
  - [Phase 2: Platform Taxonomy](#phase-2-platform-taxonomy)
  - [Phase 3: Product Core](#phase-3-product-core)
  - [Phase 4: Sub-Resources](#phase-4-sub-resources)
  - [Phase 5: Collections](#phase-5-collections)
  - [Phase 6: Product Views](#phase-6-product-views)
- [Layer 2 — Integration Tests](#layer-2--integration-tests)
  - [What Integration Tests Cover](#what-integration-tests-cover)
  - [Journey 1: The Master Happy Path](#journey-1-the-master-happy-path)
  - [Journey 2: Activation Rejection and Recovery](#journey-2-activation-rejection-and-recovery)
  - [Journey 3: Archive Flow](#journey-3-archive-flow)
  - [Journey 4: Cross-Store Leak Prevention](#journey-4-cross-store-leak-prevention)
  - [Journey 5: Store-Status Gate](#journey-5-store-status-gate)
  - [Journey 6: Category Cascade Prevention](#journey-6-category-cascade-prevention)
  - [Journey 7: Public Field Leak Audit](#journey-7-public-field-leak-audit)
  - [Journey 8: Collection Lifecycle](#journey-8-collection-lifecycle)
- [Layer 3 — Manual End-to-End Validation](#layer-3--manual-end-to-end-validation)
- [Definition of Done](#definition-of-done)

---

## Context

This document is the consolidated testing plan for the entire Product module. While each phase's documentation includes its own notes, this file brings everything together into a single reference that the implementation team can work through systematically.

The Product module is the largest module in YIIVA. It has:

- **20+ endpoints** across admin taxonomy, merchant CRUD, sub-resources (images, variants, category links, tags), collections, and public views
- **A state machine** (DRAFT → ACTIVE → ARCHIVED) with a multi-field activation contract
- **6 public read endpoints** with overlapping but distinct projections and field visibility rules
- **A store-status gate** enforced in ~15 places across mutation endpoints
- **Cross-module dependency** on the Store module for ownership and permission checks
- **Tree-inclusive category matching** for public discovery endpoints

Testing this thoroughly is essential because the Product module is the core of the commerce platform. Bugs here mean products can't be listed, bought, or discovered — which breaks the entire buyer experience.

---

## Testing Philosophy

Same three-layer approach as the Store module:

**Layer 1 — Unit tests.** Mock everything (Prisma, StoreService). Test business logic in isolation. Verify the service makes the right decisions given specific inputs and database states. Fast, deterministic, run frequently during development.

**Layer 2 — Integration tests (e2e).** Spin up the actual NestJS app with a real PostgreSQL test database. Mock only the email service. Send real HTTP requests through the full stack — controllers, validation pipes, guards, services, Prisma. Slower than unit tests but verify the whole system works together.

**Layer 3 — Manual testing.** Human walks through flows against a running instance with real database. Catches things automated tests miss — visual ordering of images, UX of multi-field error arrays, real catalog browsing behaviour.

All three layers are necessary. Unit tests prove logic correctness. Integration tests prove the system is wired together correctly. Manual tests prove the experience works for actual humans.

---

## Test Setup

### Test Database

Reuse the same separate PostgreSQL database from the Store module tests:

```dotenv
# .env.test
DATABASE_URL="postgresql://user:pass@localhost:5432/yiiva_test?schema=public"
JWT_SECRET="test-jwt-secret-not-for-production"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN_DAYS="7"
EMAIL_VERIFY_EXPIRES_IN_HOURS="24"
PASSWORD_RESET_EXPIRES_IN_HOURS="1"
RESEND_API_KEY="not-needed-mocked"
EMAIL_FROM="YIIVA <test@test.com>"
FRONTEND_URL="http://localhost:3000"
```

Before tests run, push the schema to the test database:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/yiiva_test?schema=public" npx prisma db push
```

Between tests (or test groups), clean all tables:

```sql
TRUNCATE
  product_tags, tags, product_categories, product_collections,
  product_images, product_variants, products, store_collections,
  categories, store_employees, store_addresses, store_followers,
  stores, refresh_tokens, users
CASCADE;
```

The `CASCADE` ensures rows in dependent tables are also cleared. Run this in a `beforeEach` hook.

### Mock Configuration

In integration tests, override the Email service with a mock:

```typescript
const mockEmailService = {
  sendVerificationEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendStoreApprovalEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendStoreRejectionEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendStoreLiveEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendGoLiveRejectionEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
  sendStoreInviteEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'mock' }),
};

const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(EmailService)
  .useValue(mockEmailService)
  .compile();
```

Disable the throttler in tests unless you're specifically testing rate limiting. Otherwise rapid sequential test requests will hit rate limits and fail.

### Test Utilities

Extend the existing Store module test utilities with product-specific helpers:

```typescript
import { PrismaService } from '../src/prisma/prisma.service';
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';

// ─── Database ──────────────────────────────────────────────────────────────────

export async function cleanDatabase(prisma: PrismaService) {
  await prisma.$executeRaw`TRUNCATE
    product_tags, tags, product_categories, product_collections,
    product_images, product_variants, products, store_collections,
    categories, store_employees, store_addresses, store_followers,
    stores, refresh_tokens, users
  CASCADE`;
}

// ─── Users ─────────────────────────────────────────────────────────────────────

export async function createTestUser(prisma: PrismaService, overrides = {}) {
  const passwordHash = await bcrypt.hash('TestPass123', 12);
  return prisma.user.create({
    data: {
      email: 'test@example.com',
      passwordHash,
      firstName: 'Test',
      lastName: 'User',
      role: 'BUYER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
      ...overrides,
    },
  });
}

export async function createTestMerchant(prisma: PrismaService, overrides = {}) {
  return createTestUser(prisma, {
    email: 'merchant@test.com',
    role: 'MERCHANT',
    ...overrides,
  });
}

export async function createTestAdmin(prisma: PrismaService, overrides = {}) {
  return createTestUser(prisma, {
    email: 'admin@test.com',
    role: 'ADMIN',
    ...overrides,
  });
}

export async function getAccessToken(
  app: INestApplication,
  email: string,
  password = 'TestPass123',
) {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  return response.body.accessToken;
}

// ─── Stores ────────────────────────────────────────────────────────────────────

export async function createCompleteStore(
  prisma: PrismaService,
  ownerId: string,
  overrides = {},
) {
  return prisma.store.create({
    data: {
      ownerId,
      companyName: 'Test Company (Pty) Ltd',
      displayName: 'Test Store',
      slug: 'test-store',
      description: 'A test store',
      logoUrl: 'https://example.com/logo.png',
      contactEmail: 'contact@test.com',
      contactPhone: '+27 11 123 4567',
      businessRegNo: '2024/123456/07',
      bankName: 'FNB',
      bankAccountNo: '12345678',
      bankBranchCode: '250655',
      bankAccountType: 'Cheque',
      status: 'DRAFT',
      ...overrides,
    },
  });
}

export async function createApprovedStore(
  prisma: PrismaService,
  ownerId: string,
  overrides = {},
) {
  return createCompleteStore(prisma, ownerId, {
    status: 'APPROVED',
    ...overrides,
  });
}

export async function createActiveStore(
  prisma: PrismaService,
  ownerId: string,
  overrides = {},
) {
  return createCompleteStore(prisma, ownerId, {
    status: 'ACTIVE',
    bannerUrl: 'https://example.com/banner.png',
    story: 'Our story starts in 2019...',
    ...overrides,
  });
}

// ─── Categories ────────────────────────────────────────────────────────────────

export async function createTestCategory(prisma: PrismaService, overrides = {}) {
  return prisma.category.create({
    data: {
      name: 'Test Category',
      slug: 'test-category',
      ...overrides,
    },
  });
}

export async function createCategoryTree(prisma: PrismaService) {
  const parent = await createTestCategory(prisma, {
    name: 'Footwear',
    slug: 'footwear',
  });
  const child = await createTestCategory(prisma, {
    name: 'Running Shoes',
    slug: 'running-shoes',
    parentId: parent.id,
  });
  const grandchild = await createTestCategory(prisma, {
    name: 'Trail Running',
    slug: 'trail-running',
    parentId: child.id,
  });
  return { parent, child, grandchild };
}

// ─── Products ──────────────────────────────────────────────────────────────────

export async function createTestProduct(
  prisma: PrismaService,
  storeId: string,
  overrides = {},
) {
  return prisma.product.create({
    data: {
      storeId,
      title: 'Test Product',
      slug: 'test-product',
      priceInCents: 10000,
      status: 'DRAFT',
      ...overrides,
    },
  });
}

/**
 * Creates a product that passes the full activation contract:
 * - title ≥ 2 chars
 * - priceInCents > 0
 * - at least 1 image
 * - at least 1 platform category link
 */
export async function createActivatableProduct(
  prisma: PrismaService,
  storeId: string,
  categoryId: string,
  overrides = {},
) {
  const product = await createTestProduct(prisma, storeId, {
    priceInCents: 15000,
    totalStock: 10,
    ...overrides,
  });

  await prisma.productImage.create({
    data: {
      productId: product.id,
      url: 'https://example.com/image.jpg',
      isPrimary: true,
      sortOrder: 0,
    },
  });

  await prisma.productCategory.create({
    data: { productId: product.id, categoryId },
  });

  return product;
}

/**
 * Creates an already-active product with all sub-resources.
 * Useful for testing archive flows and public read endpoints.
 */
export async function createActiveProduct(
  prisma: PrismaService,
  storeId: string,
  categoryId: string,
  overrides = {},
) {
  const product = await createActivatableProduct(prisma, storeId, categoryId, {
    status: 'ACTIVE',
    publishedAt: new Date(),
    ...overrides,
  });
  return product;
}
```

These utilities reduce boilerplate across tests and ensure consistency. The product-specific helpers build on the Store module's user/store helpers.

---

## Layer 1 — Unit Tests

### What Unit Tests Cover

Every service method gets unit tests covering:
- The happy path (valid input → expected output)
- Each error case (invalid input → expected exception)
- Edge cases (empty inputs, boundary values, unusual states)
- Side effects (database calls, transactions)

Unit tests do NOT cover:
- HTTP layer (controllers, guards, validation pipes)
- Database queries actually working (covered by integration tests)

---

### Phase 2: Platform Taxonomy

#### Step 2 — Create Category

**Successful creation with all fields:**
- Mock `prisma.category.findUnique` for slug collision check (returns null)
- Mock `prisma.category.create` returning the created category
- Verify: slug generated from name, sortOrder defaults to 0, parent included in response

**Successful creation with parent:**
- Mock parent category found
- Verify: `parentId` set on created category

**Parent not found:**
- Mock parent category query returning null
- Verify: NotFoundException with "Parent category not found"

**Slug collision:**
- Mock first slug check returning existing category, second returning null
- Verify: slug gets numeric suffix (e.g., "streetwear-2")

**Name trimming:**
- Pass name with leading/trailing whitespace
- Verify: name is trimmed in the create call

#### Step 3 — Update Category

**Successful update:**
- Mock category found
- Pass DTO with updated name and description
- Verify: fields updated, slug NOT regenerated

**Slug immutability:**
- Pass DTO with new name
- Verify: slug field is NOT included in the update call

**Category not found:**
- Mock category query returning null
- Verify: NotFoundException

**Self-parenting:**
- Pass DTO with `parentId` equal to the category's own id
- Verify: BadRequestException with "A category cannot be its own parent"

**New parent not found:**
- Mock new parent query returning null
- Verify: NotFoundException with "Parent category not found"

**Cycle detection:**
- Set up mock chain: A → B → C, then try to set C's parent to A
- Mock the ancestor walk to discover the cycle
- Verify: BadRequestException with "Reparenting would create a cycle"

#### Step 4 — Delete Category

**Successful deletion:**
- Mock category found with all `_count` values at 0
- Verify: category deleted, returns `{ success: true }`

**Has child categories:**
- Mock `_count.children > 0`
- Verify: ConflictException with "has child categories"

**Has products linked:**
- Mock `_count.products > 0`
- Verify: ConflictException with "has products linked"

**Has store associations:**
- Mock `_count.storeCategories > 0`
- Verify: ConflictException with "stores are associated"

**Category not found:**
- Verify: NotFoundException

#### Step 5 — Get Category Tree

**Returns nested tree:**
- Mock flat list of categories with parent-child relationships
- Verify: output is a nested tree with `children` arrays

**Empty database:**
- Mock empty category list
- Verify: returns empty array

**Multi-level nesting:**
- Mock 3 levels of categories
- Verify: grandchildren nested under children nested under roots

**Sort order respected:**
- Mock categories with different sortOrder values
- Verify: siblings sorted by sortOrder ascending, then name ascending

---

### Phase 3: Product Core

#### Step 6 — Create Product

**Successful creation:**
- Mock `canManageStore` returning true
- Mock store found with APPROVED status
- Mock slug generation (no collision)
- Verify: product created in DRAFT status, slug from title, priceInCents preserved

**Slug collision:**
- Mock first slug check returning existing product, second returning null
- Verify: slug gets numeric suffix (e.g., "test-product-2")

**Only required fields (title + priceInCents):**
- Pass DTO with only title and priceInCents
- Verify: optional fields (description, sku, etc.) are null/default

**Non-owner/non-employee:**
- Mock `canManageStore` returning false
- Verify: ForbiddenException

**Store not found:**
- Mock `canManageStore` returning true, store query returning null
- Verify: NotFoundException

**Store in each disallowed status:**
- DRAFT → ForbiddenException
- PENDING_REVIEW → ForbiddenException
- SUSPENDED → ForbiddenException
- CLOSED → ForbiddenException

**Store in each allowed status:**
- APPROVED → success
- PENDING_GO_LIVE → success
- ACTIVE → success

#### Step 7 — Update Product

**Successful partial update:**
- Mock product found in DRAFT, owner matches
- Pass DTO with only description
- Verify: only description changes

**Slug immutability:**
- Pass DTO with new title
- Verify: slug is NOT regenerated (slug field not in update data)

**Product not found:**
- Mock product query returning null
- Verify: NotFoundException

**Product belongs to different store:**
- Mock product found but storeId doesn't match
- Verify: NotFoundException (not 403, to prevent enumeration)

**Archived product:**
- Mock product in ARCHIVED status
- Verify: ConflictException with "Cannot update an archived product"

**DRAFT and ACTIVE products can be updated:**
- Verify both succeed

#### Step 8 — Activate Product

This step gets the heaviest unit test coverage because it's the gravitational centre of the module.

**Successful activation:**
- Mock product in DRAFT with all requirements met (title ≥ 2 chars, price > 0, ≥ 1 image, ≥ 1 category)
- Verify: status updated to ACTIVE, `publishedAt` set to current time

**Already ACTIVE (idempotent):**
- Mock product in ACTIVE status
- Verify: returns product as-is, no update call made (200 no-op)

**Archived product:**
- Verify: ConflictException with "Cannot activate an archived product"

**Missing title (< 2 chars):**
- Mock product with title "A" (1 char)
- Verify: BadRequestException with "Product title must be at least 2 characters" in errors array

**Price zero:**
- Mock product with priceInCents = 0
- Verify: "Price must be greater than zero" in errors array

**Price negative:**
- Mock product with priceInCents = -100
- Verify: same price error

**No images:**
- Mock `_count.images = 0`
- Verify: "Product must have at least one image" in errors array

**No categories:**
- Mock `_count.categories = 0`
- Verify: "Product must be linked to at least one platform category" in errors array

**Multiple validation failures at once:**
- Mock product with price = 0, no images, no categories
- Verify: BadRequestException contains ALL three error messages (not just the first)
- This is the most important test — the error array must collect everything

**Variant with invalid price override:**
- Mock product with variants, one having `priceInCents = -50`
- Verify: "All variant price overrides must be greater than zero" in errors array

**Variant with null price override (valid):**
- Mock variant with `priceInCents = null`
- Verify: no error (null means "fall back to parent price")

**Variant with price = 0:**
- Mock variant with `priceInCents = 0`
- Verify: error (price override must be > 0)

**Variant stock is irrelevant to activation:**
- Mock variants with `stock = 0` on all variants
- Verify: activation succeeds (stock is informational, `totalStock` on product is authoritative)

**Product with no variants passes activation:**
- Mock product with empty variants array but all other requirements met
- Verify: activation succeeds

#### Step 9 — Archive Product

**ACTIVE → ARCHIVED:**
- Verify: status updated to ARCHIVED

**Already ARCHIVED (idempotent):**
- Verify: returns product as-is, no update call

**DRAFT product:**
- Verify: ConflictException with "Cannot archive a draft product. Delete it instead."

**Product not found / wrong store:**
- Verify: NotFoundException

#### Step 10 — Delete Product

**DRAFT → hard deleted:**
- Verify: `prisma.product.delete` called, returns `{ success: true }`

**ACTIVE product:**
- Verify: ConflictException with "Only draft products can be deleted. Use archive to remove a live product."

**ARCHIVED product:**
- Verify: same ConflictException

**Product not found / wrong store:**
- Verify: NotFoundException

---

### Phase 4: Sub-Resources

#### Step 11 — Images (ImageService)

**11a — Add Image**

**First image auto-primary:**
- Mock 0 existing images
- Verify: `isPrimary = true` on created image, `sortOrder = 0`

**Second image not primary by default:**
- Mock 1 existing image
- Pass DTO without `isPrimary`
- Verify: `isPrimary = false`, `sortOrder = 1`

**Explicit primary via DTO swaps in transaction:**
- Mock 2 existing images, one is primary
- Pass DTO with `isPrimary = true`
- Verify: transaction called — all existing images set `isPrimary = false`, new image set `isPrimary = true`

**Default mediaType is IMAGE:**
- Pass DTO without `mediaType`
- Verify: `mediaType = 'IMAGE'` on created record

**Archived product:**
- Verify: ConflictException with "Cannot modify an archived product"

**Wrong store:**
- Verify: NotFoundException

**11b — Reorder Images**

**Successful reorder:**
- Mock 3 images for product
- Pass imageIds in new order
- Verify: batch update with correct sortOrder values (0, 1, 2)

**Missing image ID:**
- Pass imageIds array missing one of the existing IDs
- Verify: BadRequestException

**Extra image ID:**
- Pass imageIds array with an ID that doesn't belong to this product
- Verify: BadRequestException

**Duplicate image ID:**
- Pass imageIds with a duplicated ID (length mismatch catches this)
- Verify: BadRequestException

**11c — Set Primary Image**

**Successful primary swap:**
- Mock image found, not currently primary
- Verify: transaction — all images set `isPrimary = false`, target set `isPrimary = true`

**Already primary (idempotent):**
- Mock image already `isPrimary = true`
- Verify: returns image as-is, no transaction

**Image not found / wrong product:**
- Verify: NotFoundException

**11d — Remove Image**

**Successful removal:**
- Mock 3 images, delete the middle one
- Verify: image deleted, sortOrder renormalized (0, 1)

**Last image on ACTIVE product:**
- Mock 1 image, product status ACTIVE
- Verify: ConflictException with "Cannot remove the last image from an active product. Add a replacement image first or archive the product."

**Last image on DRAFT product:**
- Mock 1 image, product status DRAFT
- Verify: deletion succeeds (no protection on drafts)

**Primary image deleted — promotion:**
- Mock 2 images, delete the primary one
- Verify: remaining image promoted to primary (isPrimary = true)

**Non-primary image deleted:**
- Mock 3 images, delete a non-primary one
- Verify: primary status unchanged on remaining images

#### Step 12 — Variants (VariantService)

**Create variant:**
- Verify: name trimmed, priceInCents defaults to null, sortOrder defaults to count
- Verify: color, size, material stored when provided

**Update variant — partial:**
- Pass DTO with only `stock` changed
- Verify: only stock updated

**Update variant — clear price override:**
- Pass DTO with `priceInCents: null`
- Verify: priceInCents set to null in update

**Variant not found / wrong product:**
- Verify: NotFoundException

**Delete variant — sortOrder renormalized:**
- Mock 3 variants, delete the middle one
- Verify: remaining 2 variants have sortOrder 0 and 1

**Delete last variant on ACTIVE product:**
- Mock 1 variant, product ACTIVE
- Verify: deletion succeeds (product reverts to variantless behaviour)

**Archived product:**
- Verify: ConflictException on create, update, and delete

#### Step 13 — Category Links (CategoryLinkService)

**Link category:**
- Verify: ProductCategory record created

**Link already exists (idempotent):**
- Mock existing ProductCategory link
- Verify: returns existing record, no new create call

**Category not found:**
- Verify: NotFoundException with "Category not found"

**Unlink category:**
- Verify: ProductCategory record deleted, returns `{ success: true }`

**Unlink last category on ACTIVE product:**
- Mock 1 category link, product ACTIVE
- Verify: ConflictException with "Cannot remove the last category from an active product"

**Unlink last category on DRAFT product:**
- Verify: deletion succeeds

**Link not found on unlink:**
- Verify: NotFoundException

#### Step 14 — Tags (TagService)

**Add tag — new tag:**
- Mock tag not found in DB
- Verify: tag upserted with normalized name (trimmed, lowercased), slug generated via slugify
- Verify: ProductTag created with `isAiGenerated = false`, `confidence = null`
- Verify: `usageCount` incremented in same transaction

**Add tag — existing tag:**
- Mock tag already exists
- Verify: existing tag reused, new ProductTag created, usageCount incremented

**Add tag — already linked (idempotent):**
- Mock existing ProductTag link
- Verify: returns existing link, no new create, no usageCount change

**Tag name normalization:**
- Pass "  Street Wear  " → verify stored as "street wear", slug as "street-wear"

**20-tag cap:**
- Mock 20 existing ProductTag records
- Verify: BadRequestException with "A product can have at most 20 tags"

**19 tags (at cap - 1):**
- Mock 19 existing tags
- Verify: 20th tag succeeds

**Remove tag:**
- Verify: ProductTag deleted, usageCount decremented in same transaction

**Remove tag — link not found:**
- Verify: NotFoundException with "Tag link not found"

---

### Phase 5: Collections

#### Step 15 — Create Collection

**Successful creation:**
- Mock `canManageStore` returning true, store APPROVED
- Verify: collection created with slug from name, sortOrder defaults to 0

**Slug collision:**
- Mock first slug check returning existing collection, second returning null
- Verify: slug gets numeric suffix

**Per-store slug uniqueness:**
- Verify: slug lookup uses `storeId_slug` composite unique, not global slug

#### Step 16 — Update / Delete Collection

**Successful update:**
- Verify: name, description, imageUrl, sortOrder updated

**Slug immutability:**
- Pass DTO with new name
- Verify: slug NOT regenerated

**Collection not found / wrong store:**
- Verify: NotFoundException

**Successful deletion:**
- Verify: collection deleted, returns `{ success: true }`
- Verify: no "last collection" protection (collections are optional)

#### Step 17 — Add / Remove Products

**Add product to collection:**
- Mock collection and product both belong to same store
- Verify: ProductCollection record created

**Add product — idempotent:**
- Mock existing ProductCollection link
- Verify: returns existing record

**Product in different store:**
- Mock product with different storeId
- Verify: NotFoundException (not 403)

**Remove product from collection:**
- Verify: ProductCollection deleted, returns `{ success: true }`

**Remove product — not in collection:**
- Verify: NotFoundException

#### Step 18 — Public Collections

**Successful read:**
- Mock store found by slug, status ACTIVE
- Mock collections with `_count.products`
- Verify: returns collections sorted by sortOrder, each with `productCount`

**Store not ACTIVE:**
- Mock store in DRAFT / SUSPENDED / etc.
- Verify: NotFoundException

**Store not found:**
- Verify: NotFoundException

---

### Phase 6: Product Views

#### Step 19 — Merchant: List Products

**No store-status gate:**
- Mock store in SUSPENDED status
- Mock `canManageStore` returning true
- Verify: list succeeds (merchants can read even on suspended stores)

**Default pagination:**
- Verify: page 1, limit 20 when no query params

**Status filter — DRAFT only:**
- Pass `status=DRAFT`
- Verify: where clause includes `status: 'DRAFT'`

**Status filter — all (default):**
- Pass no status or `status=all`
- Verify: no status filter in where clause

**Search matches title and SKU:**
- Pass `search=test`
- Verify: OR clause with title contains (insensitive) AND sku contains (insensitive)

**Category filter:**
- Pass `categoryId=xxx`
- Verify: `categories: { some: { categoryId } }` in where

**Collection filter:**
- Pass `collectionId=xxx`
- Verify: `collections: { some: { collectionId } }` in where

**Sort options (all 7):**
- `newest` → `{ createdAt: 'desc' }`
- `oldest` → `{ createdAt: 'asc' }`
- `nameAsc` → `{ title: 'asc' }`
- `nameDesc` → `{ title: 'desc' }`
- `priceAsc` → `{ priceInCents: 'asc' }`
- `priceDesc` → `{ priceInCents: 'desc' }`
- `stockAsc` → `{ totalStock: 'asc' }`

**Response includes _count badges:**
- Verify: each product has `_count` with images, variants, categories

**Response includes primary image:**
- Verify: `images` array with `isPrimary: true` filter, take 1

**Pagination meta:**
- Mock 55 products, request page 2 limit 20
- Verify: `meta.total = 55`, `meta.page = 2`, `meta.limit = 20`, `meta.totalPages = 3`
- Verify: `skip = 20`, `take = 20`

#### Step 20 — Merchant: Get Single Product

**Full product with all relations:**
- Verify: images (sorted), variants (sorted), categories (with category name/slug), tags (with tag name/slug), collections (with collection name/slug)

**No store-status gate:**
- Mock store in SUSPENDED
- Verify: succeeds

**Product not found / wrong store:**
- Verify: NotFoundException

#### Step 21 — Public: Get Product Detail

**Successful read:**
- Mock ACTIVE store, ACTIVE product with all sub-resources
- Verify: response contains public fields only

**Store not ACTIVE:**
- Mock store in DRAFT / APPROVED / SUSPENDED
- Verify: NotFoundException

**Product not ACTIVE:**
- Mock ACTIVE store, product in DRAFT
- Verify: NotFoundException

**Internal fields NOT in response:**
- Verify absence of: `sku`, `costInCents`, `metaTitle`, `metaDescription`, `storeId`, `status`, `updatedAt`

**Variant effectivePriceInCents — override:**
- Mock variant with `priceInCents = 8000`, product `priceInCents = 10000`
- Verify: `effectivePriceInCents = 8000`

**Variant effectivePriceInCents — fallback:**
- Mock variant with `priceInCents = null`, product `priceInCents = 10000`
- Verify: `effectivePriceInCents = 10000`

**Store summary embedded:**
- Verify: response includes `store: { displayName, slug, logoUrl, followerCount }`

#### Step 22 — Public: Global Catalog

**Only ACTIVE products from ACTIVE stores:**
- Verify: where includes `status: ACTIVE` AND `store: { status: ACTIVE }`

**Category filter — tree-inclusive:**
- Mock category with children
- Verify: `getDescendantIds` called, where uses `categoryId: { in: [...] }`

**Tag filter — normalized:**
- Pass `tagName=" Street Wear "`
- Verify: query uses `"street wear"` (trimmed, lowercased)

**Price range — min only:**
- Pass `priceMin=5000`
- Verify: `priceInCents: { gte: 5000 }`

**Price range — max only:**
- Pass `priceMax=20000`
- Verify: `priceInCents: { lte: 20000 }`

**Price range — both:**
- Pass `priceMin=5000, priceMax=20000`
- Verify: `priceInCents: { gte: 5000, lte: 20000 }`

**Search — title only:**
- Pass `search=test`
- Verify: `title: { contains: 'test', mode: 'insensitive' }` (NOT sku — public doesn't search by SKU)

**Lightweight projection:**
- Verify: only `id, title, slug, priceInCents, comparePriceInCents, images (primary), store (displayName, slug)`
- Verify: no variants, no tags, no categories, no sku, no stock

**Sort options (3):**
- `newest`, `priceAsc`, `priceDesc`

#### Step 23 — Public: Products by Category

**Category not found:**
- Verify: NotFoundException

**Tree-inclusive matching:**
- Mock parent category with child and grandchild
- Verify: `getDescendantIds` returns all three IDs
- Verify: products linked to any of the three are returned

**Returns category metadata:**
- Verify: response includes `category: { id, name, slug, description, imageUrl }`

**Same projection as global catalog:**
- Verify: same product fields as Step 22

**getDescendantIds — BFS correctness:**
- Mock tree: A → B → C, A → D
- Verify: `getDescendantIds(A)` returns `[A, B, D, C]` (BFS order)
- Verify: `getDescendantIds(B)` returns `[B, C]`
- Verify: `getDescendantIds(C)` returns `[C]` (leaf node)

#### Step 24 — Public: Products by Store

**Store not ACTIVE:**
- Verify: NotFoundException

**Without collection filter:**
- Verify: returns all ACTIVE products for the store

**With collection filter:**
- Pass `collectionSlug=summer-2025`
- Verify: collection resolved by `storeId_slug` composite
- Verify: products filtered by `collections: { some: { collectionId } }`

**Collection not found:**
- Pass invalid collectionSlug
- Verify: NotFoundException

**Same projection as global catalog minus store info:**
- Verify: product items do NOT include store data (caller already knows the store)

---

## Layer 2 — Integration Tests

### What Integration Tests Cover

Integration tests verify the full request lifecycle: HTTP request → controller → validation pipe → guard → service → Prisma → PostgreSQL → response. They catch wiring issues that unit tests miss — wrong route paths, missing guards, incorrect select/include shapes, transaction failures.

Each journey tests a multi-step user flow against a real database.

---

### Journey 1: The Master Happy Path

The end-to-end flow from category creation to buyer discovery.

1. **Admin creates a category** — `POST /categories` with auth → 201, slug generated
2. **User registers** — `POST /auth/register` → 201
3. **User verifies email** — `POST /auth/verify-email` → 200, gets tokens
4. **User creates a store** — `POST /stores` → 201, store in DRAFT
5. **User submits store** — set all required fields via DB, `POST /stores/:id/submit` → 200
6. **Admin approves store** — `POST /stores/:id/review` with `APPROVE` → 200, user now MERCHANT
7. **Merchant creates a product** — `POST /stores/:storeId/products` with title + priceInCents → 201, product in DRAFT
8. **Merchant adds an image** — `POST /stores/:storeId/products/:id/images` → 201, auto-primary
9. **Merchant links the category** — `POST /stores/:storeId/products/:id/categories/:categoryId` → 200
10. **Merchant activates** — `POST /stores/:storeId/products/:id/activate` → 200, status ACTIVE
11. **Admin approves go-live** — set go-live requirements via DB, `POST /stores/:id/request-go-live`, admin `POST /stores/:id/review-go-live` with `APPROVE` → store ACTIVE
12. **Buyer fetches public product detail** — `GET /stores/:storeSlug/products/:productSlug` → 200, all public fields present, internal fields absent
13. **Buyer fetches global catalog** — `GET /products` → 200, product in results
14. **Buyer fetches category landing** — `GET /categories/:slug/products` → 200, product in results

### Journey 2: Activation Rejection and Recovery

1. **Setup:** approved store, draft product with only title + priceInCents
2. **Merchant tries to activate** → 400 with errors array containing "at least one image" and "at least one platform category"
3. **Merchant adds an image** → 201
4. **Merchant tries to activate** → 400 with "at least one platform category" (image error gone)
5. **Merchant links a category** → 200
6. **Merchant activates** → 200, status ACTIVE, `publishedAt` set

### Journey 3: Archive Flow

1. **Setup:** active store, active product (via test utility)
2. **Merchant archives** — `POST .../archive` → 200, status ARCHIVED
3. **Public product detail** → 404 (product not ACTIVE)
4. **Global catalog** → product absent from results
5. **Merchant tries to update product** → 409 "Cannot update an archived product"
6. **Merchant tries to add image** → 409 "Cannot modify an archived product"
7. **Merchant tries to link category** → 409 "Cannot modify an archived product"
8. **Merchant tries to add tag** → 409 "Cannot modify an archived product"
9. **Merchant can still view product** — `GET /stores/:storeId/products/:id` → 200 (read is allowed)

### Journey 4: Cross-Store Leak Prevention

1. **Merchant A** creates store + product (via test utilities)
2. **Merchant B** creates store (different user, different store)
3. **Merchant B tries to list Merchant A's products** — `GET /stores/:storeAId/products` with B's token → 403
4. **Merchant B tries to update Merchant A's product** — `PATCH /stores/:storeAId/products/:productId` → 403
5. **Merchant B tries to access A's product via B's store URL** — `GET /stores/:storeBId/products/:productAId` → 404 (storeId mismatch, not 403)
6. **Merchant B tries to add A's product to B's collection** — `POST /stores/:storeBId/collections/:collId/products/:productAId` → 404 (product.storeId !== storeId)

### Journey 5: Store-Status Gate

1. **Setup:** active store with active product, merchant token
2. **Suspend the store** (direct DB update: `status = 'SUSPENDED'`)
3. **Merchant tries to create new product** → 403 "Cannot manage products on a store with status SUSPENDED"
4. **Merchant tries to update existing product** → 403
5. **Merchant tries to add image** → 403
6. **Merchant tries to add variant** → 403
7. **Merchant tries to link category** → 403
8. **Merchant tries to add tag** → 403
9. **Merchant CAN list their products** — `GET /stores/:storeId/products` → 200 (no status gate on reads)
10. **Merchant CAN view single product** — `GET /stores/:storeId/products/:id` → 200
11. **Public product detail** → 404 (store not ACTIVE)
12. **Public global catalog** → product absent (store not ACTIVE)

### Journey 6: Category Cascade Prevention

1. **Admin creates a category** → 201
2. **Merchant links a product to the category** (via test utility)
3. **Admin tries to delete the category** → 409 "Cannot delete a category that has products linked"
4. **Merchant unlinks the product** → 200
5. **Admin deletes the category** → 200, `{ success: true }`

### Journey 7: Public Field Leak Audit

This journey explicitly verifies that no internal field surfaces in any public endpoint. This is the test the "Risks Worth Tracking" section specifically calls out.

1. **Setup:** active store, active product with all sub-resources (image, variant, category link, tag, collection membership). Product has values set for: `sku`, `costInCents`, `metaTitle`, `metaDescription`
2. **Public product detail** — `GET /stores/:slug/products/:slug` → 200
   - Assert response does NOT contain keys: `sku`, `costInCents`, `metaTitle`, `metaDescription`, `storeId`, `updatedAt`
   - Assert `status` is NOT in the response (it's always ACTIVE, no need to expose)
3. **Global catalog** — `GET /products` → 200
   - Assert each item does NOT contain: `sku`, `costInCents`, `totalStock`, `status`, `storeId`, `description`, `variants`
4. **Category landing** — `GET /categories/:slug/products` → 200
   - Same field checks as global catalog
5. **Store catalog** — `GET /stores/:slug/products` → 200
   - Same field checks, also verify no `store` embed (caller already knows the store)

### Journey 8: Collection Lifecycle

1. **Merchant creates a collection** — `POST /stores/:storeId/collections` → 201
2. **Merchant adds 3 active products** — 3x `POST .../collections/:id/products/:pid` → 200
3. **Public fetches store collections** — `GET /stores/:slug/collections` → 200, `productCount = 3`
4. **Public fetches store catalog with collection filter** — `GET /stores/:slug/products?collectionSlug=xxx` → 200, 3 products
5. **Merchant removes 1 product** — `DELETE .../collections/:id/products/:pid` → 200
6. **Public collections** → `productCount = 2`
7. **Public catalog with filter** → 2 products
8. **Merchant deletes the collection** → 200
9. **Public collections** → collection no longer in results
10. **Products still exist** — `GET /stores/:storeId/products` → still shows all 3 products (collection membership doesn't affect product existence)

---

## Layer 3 — Manual End-to-End Validation

### Setup

Run the application against a real local database with `npm run start:dev`. Use an API client (Postman, Insomnia, or curl) to execute requests.

### The Full Manual Test Suite

1. **Image ordering lifecycle** — Add 5 images, reorder them, delete the middle one, verify sortOrder renormalizes correctly and primary stays consistent. Visual check that the order matches expectations.

2. **Activation error array UX** — Create a completely empty draft product (just title + price), try to activate. Verify the error response lists ALL missing requirements in a single array, not one at a time.

3. **Category tree depth** — Create a 3-level category tree (e.g., Clothing → Footwear → Running Shoes). Link a product to "Running Shoes". Browse "Clothing" category landing — verify the product appears (tree-inclusive matching). Browse "Footwear" — same product appears. Browse "Running Shoes" — same product appears.

4. **Public catalog pagination at boundaries** — Create exactly 21 active products. Fetch page 1 (limit 20) — verify 20 items. Fetch page 2 — verify 1 item. Fetch page 3 — verify empty data array with correct meta.

5. **Collection filter on brand storefront** — Create 2 collections, put different products in each. Use `?collectionSlug=` filter on the store catalog endpoint. Verify only the correct subset appears for each collection.

6. **Tag normalization with edge cases** — Add tags with spaces (" street wear "), mixed case ("StreetWear"), and accented characters. Verify slug generation produces clean URL-safe values. Verify searching by the normalized name returns correct results.

7. **Variant price display** — Create a product at R150, add 3 variants: one with price override R120, one with null (fallback), one with R200. Fetch public product detail. Verify `effectivePriceInCents` shows 12000, 15000, 20000 respectively.

8. **Cross-store isolation** — Log in as two different merchants. Verify merchant A cannot see, edit, or link products across to merchant B's store via any endpoint (mutation or read). Verify 404 (not 403) for cross-store product ID guesses.

---

## Definition of Done

The Product module testing is complete when:

- [ ] All Layer 1 unit tests pass (every service method in CategoryService, ProductService, ImageService, VariantService, CategoryLinkService, TagService, CollectionService)
- [ ] All Layer 2 integration tests pass (all 8 journeys)
- [ ] All Layer 3 manual checks have been walked through and verified
- [ ] No internal field leaks in any public endpoint (Journey 7 passes)
- [ ] No cross-store data access possible (Journey 4 passes)
- [ ] Store-status gate blocks all 6 mutation surfaces (Journey 5 passes)
- [ ] Activation contract correctly validates all fields and returns complete error arrays
- [ ] Test coverage report shows ≥ 90% line coverage for all product module services
