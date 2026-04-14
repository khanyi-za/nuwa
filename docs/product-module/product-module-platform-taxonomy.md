# YIIVA — Product Module: Platform Taxonomy (Steps 2–5)

> Admin-managed category tree and the public read endpoint that exposes it.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

1. [Context](#context)
2. [Step 2 — Admin: Create Platform Category](#step-2--admin-create-platform-category)
3. [Step 3 — Admin: Update Platform Category](#step-3--admin-update-platform-category)
4. [Step 4 — Admin: Delete Platform Category](#step-4--admin-delete-platform-category)
5. [Step 5 — Public: Get Category Tree](#step-5--public-get-category-tree)
6. [API Endpoints Summary (Steps 2–5)](#api-endpoints-summary-steps-25)

---

## Context

Phase 1 set up the schema and module scaffold. Phase 2 builds the platform-wide category taxonomy that everything downstream depends on.

Categories are platform-managed (not store-managed) so the buyer's browsing experience is consistent across the whole marketplace. A "Streetwear" category means the same thing whether you're looking at Brand A or Brand B. Only YIIVA admins can create, edit, or delete categories — merchants will later attach their products to existing categories (Phase 4, Step 13), but they don't get to define the taxonomy itself.

The category model is a self-referencing tree via `parentId`. A typical structure looks like Fashion → Streetwear → Hoodies, but there's no artificial depth limit — admins can nest as deep as the catalog needs.

**Why this phase comes first.** Step 1's deliverables noted that products must have at least one platform category before they can be published. That makes Phase 2 a hard prerequisite for Phase 3 (Product Core). Until admins have seeded at least a base set of categories, no merchant can activate a product. In practice, Phase 2 will be deployed and the first batch of categories created before merchant onboarding opens.

**Phase 2 covers four endpoints:**
- `POST /categories` — Admin creates a category (Step 2)
- `PATCH /categories/:id` — Admin updates a category (Step 3)
- `DELETE /categories/:id` — Admin deletes a category (Step 4)
- `GET /categories` — Public reads the full category tree (Step 5)

All four live in `src/product/category/`, scaffolded in Step 1.

---

## Step 2 — Admin: Create Platform Category

### What Step 2 Accomplishes

A YIIVA admin creates a new category. The category can be a root (no parent) or a child of an existing category. The slug is auto-generated from the name and made globally unique (with numeric suffixing on collision). Once created, the category is immediately available for merchants to link products to.

### Endpoint

```
POST /categories
```

**Auth:** `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.ADMIN)`
**Throttling:** Global default (no per-endpoint limit — ADMIN-only, low write volume)

### Schema Recap

The `Category` model already exists in `schema.prisma` (no migration needed for Phase 2):

```prisma
model Category {
  id          String     @id @default(cuid())
  name        String
  slug        String     @unique
  description String?
  imageUrl    String?
  parentId    String?
  sortOrder   Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  parent          Category?         @relation("CategoryTree", fields: [parentId], references: [id])
  children        Category[]        @relation("CategoryTree")
  products        ProductCategory[]
  storeCategories StoreCategory[]

  @@index([parentId])
  @@index([slug])
  @@map("categories")
}
```

Note: `slug` is `@unique` globally — not scoped to parent. Two categories cannot share a slug even if they're under different parents.

### DTO: create-category.dto.ts

Location: `src/product/dto/create-category.dto.ts`

```typescript
import { IsString, IsOptional, IsUrl, IsInt, Min, Length } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
```

The global `ValidationPipe` (already configured with `whitelist: true, forbidNonWhitelisted: true, transform: true`) strips unknown fields and coerces types. Unknown fields → `400 Bad Request`.

### Slug Generation

Slugs are generated using `src/product/utils/slugify.ts` — the same utility duplicated from the Store module per Step 1's "modules stay independent" principle. Do not import the npm `slugify` package directly in `category.service.ts`.

The generation rule:
1. Run `slugify(name)` to produce a base slug.
2. Query `prisma.category.findUnique({ where: { slug: candidate } })`.
3. If no row exists, use the base slug.
4. If a row exists, try `${base}-2`, then `${base}-3`, incrementing until a free slug is found.
5. Wrap the final `prisma.category.create()` call in defensive `P2002` handling — if a race condition causes the unique constraint to still fire, increment and retry once.

Example: creating two categories both named "Running Shoes" produces `running-shoes` and `running-shoes-2`.

### Service Logic: create()

Location: `src/product/category/category.service.ts`

```typescript
async create(dto: CreateCategoryDto) {
  // 1. Validate parent exists (if provided)
  if (dto.parentId) {
    const parent = await this.prisma.category.findUnique({
      where: { id: dto.parentId },
    });
    if (!parent) {
      throw new NotFoundException('Parent category not found');
    }
  }

  // 2. Generate unique slug
  const slug = await this.generateUniqueSlug(dto.name);

  // 3. Create the category
  return this.prisma.category.create({
    data: {
      name: dto.name.trim(),
      description: dto.description?.trim(),
      imageUrl: dto.imageUrl,
      parentId: dto.parentId,
      sortOrder: dto.sortOrder ?? 0,
      slug,
    },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
    },
  });
}

private async generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while (await this.prisma.category.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  return candidate;
}
```

### Controller

Location: `src/product/category/category.controller.ts`

```typescript
@Controller('categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCategoryDto) {
    return this.categoryService.create(dto);
  }
}
```

### Response Shape

`201 Created`:

```json
{
  "id": "clx9k2m1a0001abcdef",
  "name": "Running Shoes",
  "slug": "running-shoes",
  "description": "Performance footwear for runners",
  "imageUrl": "https://cdn.yiiva.co.za/categories/running-shoes.jpg",
  "parentId": "clx9k1234567footwear",
  "parent": {
    "id": "clx9k1234567footwear",
    "name": "Footwear",
    "slug": "footwear"
  },
  "sortOrder": 0,
  "createdAt": "2026-04-11T10:23:14.000Z",
  "updatedAt": "2026-04-11T10:23:14.000Z"
}
```

For root categories (no parent), `parentId` and `parent` are both `null`.

### Step 2 Error Cases

| Status | Cause | Response message |
|---|---|---|
| `400` | DTO validation failed | Array of validation errors |
| `400` | Unknown field in body | `"property X should not exist"` |
| `401` | No JWT or invalid JWT | `"Authentication required"` / `"Invalid access token"` |
| `403` | Authenticated but not ADMIN | `"Forbidden resource"` |
| `404` | `parentId` does not resolve | `"Parent category not found"` |

All errors follow the standard NestJS shape:
```json
{ "statusCode": 400, "message": "...", "error": "Bad Request" }
```

### What We're NOT Doing in Step 2

- **Linking stores or products to the category.** `StoreCategory` (which signals "this brand sells in this category") and `ProductCategory` (which links a specific product to a category) are separate join tables managed by merchants in later phases. Step 2 only creates nodes in the taxonomy tree.
- **Depth limits.** No artificial cap on tree depth. The schema doc explicitly endorses arbitrary nesting.
- **Bulk creation.** One category per request. If admins need to seed many categories, that's a separate seeding script, not an API concern.
- **Image upload.** `imageUrl` is a URL string — the actual file lives in external storage handled outside this module.

---

## Step 3 — Admin: Update Platform Category

### What Step 3 Accomplishes

An admin edits an existing category — renaming it, updating its description or image, changing its sort order, or moving it to a different parent (re-parenting). The slug is **not** regenerated on rename, even if the name changes — once a slug is published, changing it would break URLs and any external references. Admins who need a new slug must delete and recreate the category.

### Endpoint

```
PATCH /categories/:id
```

**Auth:** `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.ADMIN)`

### DTO: update-category.dto.ts

Location: `src/product/dto/update-category.dto.ts`

All fields optional. Same validation rules as `CreateCategoryDto`.

```typescript
import { IsString, IsOptional, IsUrl, IsInt, Min, Length } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
```

`parentId` accepts `null` explicitly to allow promoting a child category to a root category.

### Service Logic: update()

```typescript
async update(id: string, dto: UpdateCategoryDto) {
  // 1. Confirm the category exists
  const existing = await this.prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundException('Category not found');
  }

  // 2. If reparenting, validate the new parent
  if (dto.parentId !== undefined && dto.parentId !== null) {
    if (dto.parentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }
    const newParent = await this.prisma.category.findUnique({
      where: { id: dto.parentId },
    });
    if (!newParent) {
      throw new NotFoundException('Parent category not found');
    }
    // Prevent cycles: walk up the new parent's ancestors and ensure `id` is not among them
    await this.assertNoCycle(id, dto.parentId);
  }

  // 3. Apply the update (slug is intentionally never touched)
  return this.prisma.category.update({
    where: { id },
    data: {
      name: dto.name?.trim(),
      description: dto.description?.trim(),
      imageUrl: dto.imageUrl,
      parentId: dto.parentId, // explicit null allowed
      sortOrder: dto.sortOrder,
    },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
    },
  });
}

private async assertNoCycle(categoryId: string, newParentId: string) {
  let cursor: string | null = newParentId;
  while (cursor) {
    if (cursor === categoryId) {
      throw new BadRequestException('Reparenting would create a cycle');
    }
    const node = await this.prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = node?.parentId ?? null;
  }
}
```

### Controller

```typescript
@Patch(':id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
  return this.categoryService.update(id, dto);
}
```

### Step 3 Error Cases

| Status | Cause |
|---|---|
| `400` | DTO validation failed, self-parent, or cycle detected |
| `401` | No JWT or invalid JWT |
| `403` | Not ADMIN |
| `404` | Category `id` not found, or `parentId` not found |

### What We're NOT Doing in Step 3

- **Slug regeneration.** Slugs are immutable after creation. URL stability matters more than name accuracy.
- **Bulk re-ordering.** If an admin needs to reorder many siblings at once, they call PATCH multiple times. Bulk endpoints can come later if needed.

---

## Step 4 — Admin: Delete Platform Category

### What Step 4 Accomplishes

An admin removes a category from the taxonomy. Deletion is **blocked** if the category has any children, any linked products, or any linked stores — admins must resolve those references first. This is intentional: silent cascade deletes on a taxonomy node could remove products from the catalog or strip stores of their identity tags without warning.

### Endpoint

```
DELETE /categories/:id
```

**Auth:** `JwtAuthGuard` + `RolesGuard`, `@Roles(UserRole.ADMIN)`

### Service Logic: delete()

```typescript
async delete(id: string) {
  const category = await this.prisma.category.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          children: true,
          products: true,        // ProductCategory join rows
          storeCategories: true, // StoreCategory join rows
        },
      },
    },
  });

  if (!category) {
    throw new NotFoundException('Category not found');
  }

  if (category._count.children > 0) {
    throw new ConflictException(
      'Cannot delete a category that has child categories. Move or delete the children first.',
    );
  }

  if (category._count.products > 0) {
    throw new ConflictException(
      'Cannot delete a category that has products linked to it. Re-categorise the products first.',
    );
  }

  if (category._count.storeCategories > 0) {
    throw new ConflictException(
      'Cannot delete a category that stores are associated with. Remove store associations first.',
    );
  }

  await this.prisma.category.delete({ where: { id } });
  return { success: true };
}
```

### Controller

```typescript
@Delete(':id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@HttpCode(HttpStatus.OK)
delete(@Param('id') id: string) {
  return this.categoryService.delete(id);
}
```

### Step 4 Error Cases

| Status | Cause |
|---|---|
| `401` | No JWT or invalid JWT |
| `403` | Not ADMIN |
| `404` | Category `id` not found |
| `409` | Category has children, products, or store associations |

### What We're NOT Doing in Step 4

- **Cascade deletion.** Explicitly avoided — too dangerous on a taxonomy node.
- **Soft delete.** Categories are either present or gone. There's no archived state. If admins want to hide a category temporarily, that's a future enhancement (e.g., an `isActive` flag), not Step 4's concern.
- **Move-then-delete in one call.** If an admin wants to delete a category and reassign its children to a new parent, that's two calls: PATCH the children to a new parent, then DELETE the empty category.

---

## Step 5 — Public: Get Category Tree

### What Step 5 Accomplishes

Anyone — authenticated or not — can fetch the full category tree. This is the read endpoint that powers buyer-app navigation menus, the admin panel's category browser, and the merchant onboarding flow when a merchant picks which categories their store operates in. The response is a nested tree, not a flat list, so the client doesn't have to assemble the hierarchy itself.

### Endpoint

```
GET /categories
```

**Auth:** None — public endpoint
**Throttling:** Global default (100 req/min). Caching is recommended at the edge or in-memory; the tree changes infrequently.

### Service Logic: getTree()

The simplest correct approach: fetch all categories in one query, then build the tree in memory. The category table will never be large enough (low thousands at most) for this to matter performance-wise, and a single query beats recursive CTEs for readability.

```typescript
async getTree() {
  const all = await this.prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      parentId: true,
      sortOrder: true,
    },
  });

  // Build a lookup map
  const byId = new Map<string, any>();
  all.forEach((c) => byId.set(c.id, { ...c, children: [] }));

  // Wire up the tree
  const roots: any[] = [];
  for (const node of byId.values()) {
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
```

### Controller

```typescript
@Get()
getTree() {
  return this.categoryService.getTree();
}
```

No guards. Public.

### Response Shape

`200 OK`:

```json
[
  {
    "id": "clx9k1234567footwear",
    "name": "Footwear",
    "slug": "footwear",
    "description": "All footwear",
    "imageUrl": "https://cdn.yiiva.co.za/categories/footwear.jpg",
    "parentId": null,
    "sortOrder": 0,
    "children": [
      {
        "id": "clx9k2m1a0001abcdef",
        "name": "Running Shoes",
        "slug": "running-shoes",
        "description": "Performance footwear for runners",
        "imageUrl": "https://cdn.yiiva.co.za/categories/running-shoes.jpg",
        "parentId": "clx9k1234567footwear",
        "sortOrder": 0,
        "children": []
      }
    ]
  },
  {
    "id": "clx9k7654321fashion",
    "name": "Fashion",
    "slug": "fashion",
    "parentId": null,
    "sortOrder": 1,
    "children": [ ... ]
  }
]
```

Roots are returned in `sortOrder` ascending. Children at every level are also sorted by `sortOrder` ascending (because the underlying `findMany` orders the entire result set, and the in-memory tree-building preserves that order).

### Step 5 Error Cases

None expected under normal operation. A `500` would only fire if the database is unreachable.

### What We're NOT Doing in Step 5

- **Filtering by depth or root.** Returns the entire tree. If clients want a sub-tree, they can walk to the relevant node themselves. A `?rootSlug=fashion` parameter could be added later if real usage demands it.
- **Product counts per category.** Tempting, but the join would slow down what's meant to be a hot, cached endpoint. Counts can come from a separate `GET /categories/:slug/stats` endpoint in a later phase.
- **Single-category lookup by slug.** That's a separate endpoint (`GET /categories/:slug`) and arguably belongs in Phase 6 (Product Views) since it's typically used to render a category landing page alongside the products inside it.

---

## API Endpoints Summary (Steps 2–5)

| Method | Path | Auth | Purpose | Step |
|---|---|---|---|---|
| `POST` | `/categories` | ADMIN | Create a category | 2 |
| `PATCH` | `/categories/:id` | ADMIN | Update a category | 3 |
| `DELETE` | `/categories/:id` | ADMIN | Delete a category (blocked if non-empty) | 4 |
| `GET` | `/categories` | Public | Get the full category tree | 5 |

---

## Phase 2 Deliverables

When Phase 2 is complete:
1. `src/product/category/category.controller.ts` exposes all four routes above
2. `src/product/category/category.service.ts` implements `create()`, `update()`, `delete()`, `getTree()`, plus the private helpers `generateUniqueSlug()` and `assertNoCycle()`
3. `src/product/dto/create-category.dto.ts` and `src/product/dto/update-category.dto.ts` are wired in
4. The slugify utility at `src/product/utils/slugify.ts` is in use (from Step 1)
5. An admin can create a small seed taxonomy (e.g., Fashion → Streetwear → Hoodies) end-to-end
6. The public `GET /categories` endpoint returns that taxonomy as a nested tree
7. Deletion is correctly blocked when a category has children, products, or store associations
8. Reparenting is correctly blocked when it would create a cycle

From here, Phase 3 (Steps 6–10) builds the merchant-side product CRUD, which depends on Phase 2 being live so merchants can attach their products to real categories.
