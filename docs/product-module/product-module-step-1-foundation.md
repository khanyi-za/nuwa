# YIIVA — Product Module: Foundation (Step 1)

> Schema changes, module structure, and cross-module dependencies for the Product module.
> Stack: NestJS + Prisma + PostgreSQL

---

## Context

Before writing any business logic, we set up the database schema changes needed for the Product module, create the module scaffold, and wire everything into `AppModule`. No endpoints yet — just the foundation that everything else will sit on.

Most of the Product module's schema already exists. The Prisma schema has `Product`, `ProductVariant`, `ProductImage`, `ProductCategory`, `Category`, `Tag`, and `ProductTag` models. What we need to add are two new models for store-scoped collections.

**Architecture decisions locked in:**
- No admin review gate for products — merchants create in DRAFT, mark ACTIVE when ready
- Variants are optional — simple products have none, complex products have many
- Platform categories (admin-managed) are required — every product needs at least one
- Store collections (merchant-managed) are optional groupings — don't affect platform discovery
- No AI tagging in this build — manual tags only

---

## Schema Changes

### New Model: StoreCollection

Merchant-created grouping of products within their own store. Examples: "Summer 2025", "Limited Edition", "Winter Essentials". Only visible on the merchant's store page — does not affect platform-wide discovery.

```prisma
model StoreCollection {
  id          String   @id @default(cuid())
  storeId     String
  name        String
  slug        String
  description String?
  imageUrl    String?
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  store       Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  products    ProductCollection[]

  @@unique([storeId, slug])
  @@index([storeId])
  @@map("store_collections")
}
```

**Field details:**
- `id` — CUID primary key
- `storeId` (FK) — which store this collection belongs to. Cascade on delete.
- `name` — the collection name shown to buyers. Required.
- `slug` — URL-friendly identifier, generated from name. Unique per store, not platform-wide.
- `description` — optional description shown on the collection page
- `imageUrl` — optional hero image
- `sortOrder` — manual ordering within the store. Lower numbers appear first.

**Constraints:**
- `@@unique([storeId, slug])` — prevents duplicate slugs within a single store
- `@@index([storeId])` — fast lookup of all collections for a store

### New Model: ProductCollection (Join Table)

Many-to-many relationship between products and store collections.

```prisma
model ProductCollection {
  id           String   @id @default(cuid())
  productId    String
  collectionId String
  createdAt    DateTime @default(now())

  product      Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  collection   StoreCollection @relation(fields: [collectionId], references: [id], onDelete: Cascade)

  @@unique([productId, collectionId])
  @@map("product_collections")
}
```

### Relation Updates

On `Store` model, add:
```prisma
collections StoreCollection[]
```

On `Product` model, add:
```prisma
collections ProductCollection[]
```

### Migration

```bash
npx prisma migrate dev --name add_store_collections
```

Creates the two new tables, adds foreign keys, sets up constraints and indexes. No changes to existing data.

---

## Module Files

```
src/
├── product/
│   ├── product.module.ts
│   ├── product.controller.ts
│   ├── product.service.ts
│   ├── category/
│   │   ├── category.controller.ts
│   │   └── category.service.ts
│   ├── collection/
│   │   ├── collection.controller.ts
│   │   └── collection.service.ts
│   ├── utils/
│   │   └── slugify.ts
│   └── dto/
│       └── (added per step)
```

The module is split into three sub-areas: main product CRUD, platform categories (admin), and store collections (merchant). All three are part of `ProductModule` — subfolders are for code clarity only.

**`product.module.ts`** — registers all three services and controllers, imports `StoreModule` for cross-module access, exports `ProductService`.

**`product.controller.ts`** — main product CRUD routes (`/products/*`), built across Steps 6–14.

**`product.service.ts`** — product business logic, ownership checks via Store module's helpers, slug generation, stock management, active product counts.

**`category/category.controller.ts`** — platform category routes (`/categories/*`) for admin CRUD and public listing.

**`category/category.service.ts`** — category tree/hierarchy handling, admin CRUD, product count per category.

**`collection/collection.controller.ts`** — store collection routes nested under `/stores/:storeId/collections/*`.

**`collection/collection.service.ts`** — collection CRUD, permission checks, adding/removing products, store-scoped slug generation.

**`utils/slugify.ts`** — pure slug generation function duplicated from the Store module (same transformation rules) to keep modules independent.

---

## Module Registration

In `AppModule`:
```typescript
@Module({
  imports: [
    AuthModule,
    StoreModule,
    ProductModule, // new
  ],
})
export class AppModule {}
```

---

## Cross-Module Dependencies

### Product depends on Store

`ProductModule` imports `StoreModule` to use `StoreService.canManageStore(userId, storeId)` for ownership checks. This keeps "who can manage this store" logic as the single source of truth in the Store module.

```typescript
@Module({
  imports: [StoreModule],
  // ...
})
export class ProductModule {}
```

```typescript
@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private storeService: StoreService,
  ) {}
}
```

### Store does NOT depend on Product (avoiding circular dependency)

The Store module's go-live validation needs to count active products, but instead of importing `ProductService` (which would create a circular dependency), the Store module queries Prisma directly:

```typescript
const productCount = await this.prisma.product.count({
  where: { storeId, status: 'ACTIVE' }
});
```

Prisma models are globally accessible — any service can query any table. This keeps the dependency one-way: `Product → Store`, never the reverse.

### Store Status Gate

Products can only be added to stores in `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE` status. Merchants in DRAFT or PENDING_REVIEW can't build a catalog yet — they haven't been approved. This check happens in every product mutation endpoint.

---

## Request Lifecycle

Same pipeline as Auth and Store modules:

```
Request → ThrottlerGuard → JwtAuthGuard → JwtStrategy.validate()
→ RolesGuard → ValidationPipe → Controller → Service → Response
```

All infrastructure already exists — Product module just plugs in.

---

## What We're NOT Doing in Step 1

- No endpoints, DTOs, or service methods (added per step)
- No AI tagging (explicitly out of scope)
- No file upload handling (images use URLs from external storage)
- No analytics or reviews (separate modules)

---

## Step 1 Deliverables

When Step 1 is complete:
1. `StoreCollection` and `ProductCollection` models exist in the database
2. Prisma client is regenerated to include the new models
3. `ProductModule` exists with scaffolded files (empty controllers and services)
4. `ProductModule` is registered in `AppModule`
5. `ProductModule` imports `StoreModule` for cross-module access
6. `StoreModule` does NOT import `ProductModule` — avoids circular dependency
7. Request lifecycle pipeline works for product routes

From here, Step 2 builds the first feature — admin creates a platform category. Categories are the foundation everything depends on (products must have at least one platform category before they can be published).
