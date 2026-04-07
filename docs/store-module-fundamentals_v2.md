# YIIVA — Store Module Fundamentals

> Technical reference for the Store module — schema changes, module structure, and the first three features: create store, update store, and submit for review.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Context](#context)
- [Step 1 — Schema Changes & Module Structure](#step-1--schema-changes--module-structure)
  - [Schema Changes](#schema-changes)
    - [Store Model Changes](#store-model-changes)
    - [New Model: StoreAddress](#new-model-storeaddress)
    - [New Model: StoreEmployee](#new-model-storeemployee)
    - [Relation Updates](#relation-updates)
    - [Migration](#migration)
  - [Module Files](#module-files)
    - [store.module.ts](#storemodulets)
    - [store.controller.ts](#storecontrollerts)
    - [store.service.ts](#storeservicets)
    - [utils/slugify.ts](#utilsslugifyts)
    - [dto/create-store.dto.ts](#dtocreate-storedtots)
  - [Route Registration & Request Lifecycle](#route-registration--request-lifecycle)
- [Step 2 — Create Store (Draft)](#step-2--create-store-draft)
  - [What This Step Accomplishes](#what-step-2-accomplishes)
  - [DTO: create-store.dto.ts](#dto-create-storedtots-1)
    - [Required Fields](#required-fields)
    - [Optional Fields](#optional-fields)
    - [Fields Not Accepted at Creation](#fields-not-accepted-at-creation)
  - [Slug Generation](#slug-generation)
  - [Service Logic: create()](#service-logic-create)
  - [Controller](#controller)
  - [Error Cases](#error-cases)
  - [What We Are NOT Doing in This Step](#what-we-are-not-doing-in-this-step)
  - [What the Frontend Does With This](#what-the-frontend-does-with-this)
- [Step 3 — Update Store (Draft Stage)](#step-3--update-store-draft-stage)
  - [What This Step Accomplishes](#what-step-3-accomplishes)
  - [DTO: update-store.dto.ts](#dto-update-storedtots)
    - [Updatable Fields](#updatable-fields)
    - [Fields Not Updatable Through This Endpoint](#fields-not-updatable-through-this-endpoint)
  - [Service Logic: update()](#service-logic-update)
  - [Controller](#controller-1)
  - [Error Cases](#error-cases-1)
- [Step 4 — Submit Store for Review](#step-4--submit-store-for-review)
  - [What This Step Accomplishes](#what-step-4-accomplishes)
  - [Required Fields Validation](#required-fields-validation)
    - [Brand Identity (Required)](#brand-identity-required)
    - [Contact (Required)](#contact-required)
    - [Payout (Required)](#payout-required)
    - [Not Required for Submission](#not-required-for-submission)
  - [Service Logic: submit()](#service-logic-submit)
  - [Controller](#controller-2)
  - [Error Cases](#error-cases-2)
  - [The Resubmission Flow](#the-resubmission-flow)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Manual Checks](#manual-checks)
- [API Endpoints Summary (Steps 1–4)](#api-endpoints-summary-steps-14)

---

## Context

### Why the Store Module Exists

The Store module is the bridge between the Auth module (which manages user identity) and everything that comes after (products, orders, payments, shipping). It handles the entire lifecycle of a brand on YIIVA — from a buyer applying to open a store, through admin review, to a fully operational merchant dashboard.

The Store module unlocks the BUYER → MERCHANT upgrade flow. Without it, every user is stuck as a BUYER with no way to sell on the platform.

### How We Got Here

During planning, three requirements emerged that shaped the module's design:

1. **Store addresses** — a store can have multiple physical locations (like Instagram business location tags). These are displayed on the store's public profile for trust and discovery, not for shipping logistics. Delivery is handled entirely at checkout through TCG/ShipLogic.

2. **Company name vs display name** — South African businesses often have a registered company name (from CIPC) that differs from their trading/brand name. The schema needs both. Both must be unique across the platform, which eliminates the need for slug collision handling.

3. **Store employees** — a store can have multiple team members who help manage it. All employees have the same access level — they can edit the store profile, products, story, and content, but they cannot delete or deactivate the store. Only the creator (owner) has deletion/deactivation rights and the ability to invite or remove employees.

### The BUYER → MERCHANT Flow

This is the user journey that the Store module enables:

1. User registers (becomes BUYER)
2. User creates a store (store status: DRAFT, user stays BUYER)
3. User fills in store details incrementally (update endpoint)
4. User submits store for review (store status: PENDING_REVIEW)
5. Admin reviews and approves (store status: ACTIVE, user role: MERCHANT)
6. User can now access the merchant dashboard on both mobile and web

Steps 1–4 of the module plan are covered in this document. Steps 5–6 (admin review and approval) will be documented separately.

---

## Step 1 — Schema Changes & Module Structure

### Schema Changes

#### Store Model Changes

The Store model needs the following modifications:

**Remove:**
- `name` — replaced by `companyName` and `displayName`
- `city` — physical location now handled by `StoreAddress` model
- `province` — same reason

**Add:**
- `companyName` (String, unique) — the registered legal entity name. Example: "Khanyi Creative Ventures (Pty) Ltd". Used for invoices, payouts, tax documents, compliance. Not public-facing on the storefront. Must be unique across the platform so no two stores can register under the same company.

- `displayName` (String, unique) — the brand name that buyers see everywhere: storefront, search results, discovery feed. Example: "BOLD Streetwear". Must be unique across the platform. The slug is derived from this field, and since the display name is unique, the slug is inherently unique — no suffix logic needed.

- `rejectionReason` (String, nullable) — set by the admin when a store application is rejected. Contains the reason or feedback explaining what needs to change. Cleared when the merchant resubmits (status goes back to PENDING_REVIEW or APPROVED). Nullable because it's only populated after a rejection.

- `websiteUrl` (String, nullable) — the brand's external website URL. Optional. Displayed on the public store profile so buyers can visit the brand's external site. Not all brands have a website (many SA creators sell exclusively through YIIVA and Instagram), so this remains optional even at go-live.

**The `slug` field remains** but its generation logic changes. It's now derived directly from `displayName` with no random suffix fallback. Since `displayName` is unique, slug collisions are effectively impossible. If two different display names somehow produce the same slug (they'd have to differ only in special characters), the unique constraint on `slug` catches it.

**Updated StoreStatus enum:**

The store lifecycle now includes two review gates instead of one. The full enum is:

```prisma
enum StoreStatus {
  DRAFT              // merchant is filling in details
  PENDING_REVIEW     // 1st review — admin verifies legitimacy
  APPROVED           // approved by admin, can add products, not yet visible to buyers
  PENDING_GO_LIVE    // 2nd review — admin verifies launch readiness
  ACTIVE             // live and visible to buyers on the mobile app
  SUSPENDED          // temporarily disabled by admin
  CLOSED             // permanently closed
}
```

The two review gates serve different purposes:

1. **PENDING_REVIEW (1st gate)** — admin verifies the brand is legitimate, the company is real, the bank details are valid. This is the curation gate that prevents spam and fraud from entering the platform. Approval here grants MERCHANT role and dashboard access.

2. **PENDING_GO_LIVE (2nd gate)** — admin verifies the store is ready for buyers. Has all fields filled in, has a banner, has at least 7 active products, has at least one physical location. This is the readiness gate that prevents empty/incomplete stores from appearing in the buyer feed. Approval here makes the store visible to buyers.

Between APPROVED and ACTIVE, the merchant has full dashboard access but their store is invisible to buyers — they're in the "ramp up" phase where they add products, refine their branding, and prepare for launch.

#### New Model: StoreAddress

Represents a physical location where the brand operates — a shop, studio, warehouse, or pop-up. Displayed on the store's public profile for trust and discovery, similar to Instagram business location tags.

This is NOT related to shipping logistics. Delivery options and addresses are handled entirely at checkout through TCG/ShipLogic. Store addresses are a "find us" feature.

```prisma
model StoreAddress {
  id            String   @id @default(cuid())
  storeId       String
  streetNumber  String
  streetName    String
  buildingName  String?
  city          String
  postalCode    String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  store         Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
  @@map("store_addresses")
}
```

**Field details:**

- `streetNumber` — the number on the street, e.g. "42", "180". Required because a physical location needs a number.
- `streetName` — the name of the street, e.g. "Bree Street", "Katherine Street". Required.
- `buildingName` — the name of the building, complex, mall, or shopping centre. Optional because not every location is in a named building. Examples: "The Foundry", "Sandton City", "Rosebank Mall".
- `city` — the city or town, e.g. "Johannesburg", "Cape Town". Required.
- `postalCode` — South African postal code, e.g. "2000", "8001". Required.
- No `province` field — city and postal code are sufficient for a location tag.
- No `type` enum — all addresses serve the same purpose (physical presence).
- No `isHeadquarters` flag — keeping it simple. If the brand has multiple locations, they're all equal.

A store can have zero or more addresses. Not all brands have a physical presence — many SA creators sell exclusively online.

#### New Model: StoreEmployee

Represents a team member who has been invited to help manage a store. All employees have the same access level — there is no role hierarchy among employees. The only distinction is between the store owner (identified by `Store.ownerId`) and employees.

```prisma
model StoreEmployee {
  id             String    @id @default(cuid())
  storeId        String
  userId         String?
  email          String
  employeeNumber String?
  inviteToken    String?
  inviteExpiry   DateTime?
  acceptedAt     DateTime?
  isActive       Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  store          Store     @relation(fields: [storeId], references: [id], onDelete: Cascade)
  user           User?     @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([storeId, email])
  @@index([storeId])
  @@index([userId])
  @@index([email])
  @@map("store_employees")
}
```

**Field details:**

- `storeId` (FK) — which store this employee belongs to. Cascades on delete — if the store is deleted, all employee records go with it.

- `userId` (FK, nullable) — the YIIVA user account linked to this employee. Nullable because when the owner sends an invite, the person might not have a YIIVA account yet. This gets set when they accept the invite and either sign up or log in. `onDelete: SetNull` because if the user account is deleted, the employee record persists (audit trail) but is unlinked.

- `email` — the email address the invite was sent to. Always present, set at invite time. Used to match the invite to the person when they accept.

- `employeeNumber` — an optional identifier provided by the employee themselves during the invite acceptance flow. Not generated by the system, not required. Some businesses track their team members by employee numbers.

- `inviteToken` — the SHA256 hash of the invite token. The raw token is sent via email, the hash is stored in the database. Same security pattern as verification and password reset tokens. Cleared after the invite is accepted.

- `inviteExpiry` — when the invite link expires. Set at invite creation time. After this datetime, the invite is invalid and the owner needs to send a new one.

- `acceptedAt` — timestamp of when the employee accepted the invite. Null until they accept. Used to distinguish pending invites from accepted employees.

- `isActive` — whether the employee currently has access. The owner can deactivate an employee (set to `false`) to revoke their dashboard access without deleting the record. Can be reactivated (set to `true`).

**Constraints:**

- `@@unique([storeId, email])` — prevents inviting the same email address twice to the same store. One person, one invite per store.

**Permissions model:**

The permission system is simple — no role hierarchy, no granular permissions:

| Action | Owner | Employee |
|--------|-------|----------|
| Edit store profile, description, story | Yes | Yes |
| Edit products, content | Yes | Yes |
| View orders, analytics | Yes | Yes |
| Edit bank/payout details | Yes | No |
| Invite employees | Yes | No |
| Remove employees | Yes | No |
| Deactivate/delete the store | Yes | No |
| Submit store for review | Yes | No |

The owner is identified by `Store.ownerId`. The owner does NOT have a `StoreEmployee` record — they are identified through the Store model directly. `StoreEmployee` records are only for invited team members.

**The invite flow (implemented in a later step):**

1. Store owner enters an email address in the dashboard
2. Backend creates a `StoreEmployee` record with the email and a hashed invite token
3. An invite email is sent via Resend with a link containing the raw token
4. The person clicks the link
5. If they don't have a YIIVA account, they register (standard registration + invite context)
6. If they already have a YIIVA account, they log in
7. Once authenticated, the invite token links them to the `StoreEmployee` record — `userId` is set, `acceptedAt` is stamped, `inviteToken` and `inviteExpiry` are cleared
8. They now have access to that store's dashboard

#### Relation Updates

**On the Store model, add:**

```prisma
addresses       StoreAddress[]
employees       StoreEmployee[]
```

**On the User model, add:**

```prisma
storeEmployments  StoreEmployee[]
```

#### Migration

After updating `schema.prisma` with all changes:

```bash
npx prisma migrate dev --name store_module_schema_changes
```

This generates a SQL migration that:
- Renames/replaces the `name` column on `stores` with `companyName` and `displayName`
- Removes `city` and `province` columns from `stores`
- Adds `rejectionReason` column to `stores`
- Adds `websiteUrl` column to `stores`
- Updates the `StoreStatus` enum to include `APPROVED` and `PENDING_GO_LIVE` values
- Creates the `store_addresses` table with foreign key to `stores`
- Creates the `store_employees` table with foreign keys to `stores` and `users`
- Sets up unique constraints on `companyName`, `displayName`, and `[storeId, email]`

If you have existing data in the `stores` table, you'll need to handle the migration carefully — rename `name` to `displayName` and populate `companyName` with the same value temporarily. For a fresh database (no existing stores), the migration runs cleanly.

---

### Module Files

The initial file structure for Steps 2–4:

```
src/
├── store/
│   ├── store.module.ts
│   ├── store.controller.ts
│   ├── store.service.ts
│   ├── utils/
│   │   └── slugify.ts
│   └── dto/
│       ├── create-store.dto.ts
│       └── update-store.dto.ts
```

Only the files needed for Steps 2–4. Other DTOs and files are added when their steps are built. No empty placeholder files.

#### store.module.ts

A standard NestJS module. Its dependencies are minimal because the infrastructure it needs is already global:

- **PrismaModule** — already registered as `@Global()`, available everywhere. No import needed.
- **Auth guards** — `JwtAuthGuard` and `RolesGuard` are already registered as `APP_GUARD` in `AuthModule`, so every route in the store controller is automatically protected. No import needed.
- **ConfigModule** — already global. No import needed.

The module does three things:
1. Registers `StoreService` as a provider
2. Registers `StoreController` as the controller
3. Exports `StoreService` so future modules can use it (the Product module will need to verify a store exists and is ACTIVE before creating products, the Order module will need store data for fulfilment, etc.)

The module is NOT `@Global()` — unlike Prisma and Email which are infrastructure, the Store module is domain-specific. Other modules that need it will import `StoreModule` explicitly.

`StoreModule` must be added to the `imports` array in `AppModule` so NestJS includes it in the module tree.

#### store.controller.ts

The HTTP routing layer for store endpoints. Decorated with `@Controller('stores')`, which sets the base path — every route in this controller is under `/stores/...`.

The controller is thin. It receives requests, extracts the authenticated user via `@CurrentUser()`, extracts path parameters via `@Param()`, extracts the validated body via `@Body()`, passes everything to the service, and returns the response. No business logic lives here.

Since `JwtAuthGuard` is global, all routes are protected by default. The `@Public()` decorator would be used to opt out, but none of the store endpoints are public (even the public store profile requires authentication in the initial build).

For Steps 2–4, the controller has three methods:
- `POST /stores` → `create()`
- `PATCH /stores/:id` → `update()`
- `POST /stores/:id/submit` → `submit()`

#### store.service.ts

The service class where all store business logic lives. It injects `PrismaService` via the constructor. This is where ownership checks, status validations, uniqueness checks, slug generation, and database operations happen.

For Steps 2–4, the service has three methods:
- `create(userId, dto)` — create a new store in DRAFT status
- `update(userId, storeId, dto)` — update store details
- `submit(userId, storeId)` — submit for review

#### utils/slugify.ts

A pure utility function that converts a display name into a URL-safe slug. Extracted into its own file because:
- It's a pure function with no dependencies — easy to unit test in isolation
- It's used in both `create()` and `update()` (when display name changes)
- It might be reused by other modules in the future (product slugs, category slugs)

The function takes a string and returns a slug string. It has no side effects, no database calls, no async operations.

#### dto/create-store.dto.ts

Validation rules for the `POST /stores` request body. Uses `class-validator` decorators to validate input at the controller level before it reaches the service. Detailed in Step 2.

---

### Route Registration & Request Lifecycle

When NestJS starts, it scans the module tree. `AppModule` imports `StoreModule`, which registers `StoreController`. NestJS finds the `@Controller('stores')` decorator and the route methods, and registers them in the route table.

The request lifecycle for any store endpoint is:

```
HTTP request hits /stores/...
→ ThrottlerGuard (global rate limiting)
→ JwtAuthGuard (global, validates access token via JWT strategy)
→ JwtStrategy.validate() (DB lookup, checks user exists and accountStatus === ACTIVE)
→ RolesGuard (checks @Roles() metadata if present — skipped if no @Roles())
→ ValidationPipe (validates request body against DTO if present)
→ StoreController method (extracts @CurrentUser(), @Param(), @Body())
→ StoreService method (business logic, ownership checks, Prisma operations)
→ Response returned to client
```

This pipeline is already fully wired from the auth module setup. The Store module simply plugs into it. No additional guard or pipe configuration is needed.

---

## Step 2 — Create Store (Draft)

### What Step 2 Accomplishes

A logged-in BUYER hits `POST /stores` with their store's company name, display name, and optional details. The system validates the input, checks they don't already have a store, checks uniqueness of both names, generates a URL-safe slug from the display name, creates the Store record in DRAFT status, and returns it.

After this, the user has a store tied to their account that they can continue editing incrementally. No role change happens — the user remains a BUYER. No employees are created — the owner is identified by `Store.ownerId`.

---

### DTO: create-store.dto.ts

#### Required Fields

**`companyName`**
- Type: string
- Validation: required, trimmed, minimum 2 characters, maximum 150 characters
- Purpose: the registered legal entity name. Used for invoices, payouts, tax documents, compliance. Not displayed on the storefront to buyers.
- Must be unique across the platform.
- Example: "Khanyi Creative Ventures (Pty) Ltd"

**`displayName`**
- Type: string
- Validation: required, trimmed, minimum 2 characters, maximum 100 characters
- Purpose: the brand name that buyers see everywhere — storefront, search results, discovery feed, order confirmations. This is the public-facing identity of the brand.
- Must be unique across the platform.
- The slug is generated from this field.
- Example: "BOLD Streetwear"

#### Optional Fields

**`description`**
- Type: string
- Validation: optional, maximum 500 characters
- Purpose: a short summary of what the brand sells. Think of it as the Instagram bio — concise, informative. Shown in search results and store listings.
- Example: "Premium streetwear inspired by Johannesburg's urban culture"

**`story`**
- Type: string
- Validation: optional, maximum 2000 characters (approximately 300–400 words)
- Purpose: the brand's narrative — who they are, how they started, what they stand for. This is a core YIIVA feature for discovery and community. Displayed on the store's full profile page.
- Example: "We started in a garage in Soweto in 2019 with one sewing machine and a dream..."

**`contactEmail`**
- Type: string
- Validation: optional, valid email format if provided
- Purpose: the store's public or business contact email. May differ from the user's account email (business email vs personal email).
- Example: "hello@boldstreetwear.co.za"

**`contactPhone`**
- Type: string
- Validation: optional, string if provided
- Purpose: store contact number. SA phone numbers can be in various formats (+27, 0xx, etc.), so stored as a string with loose validation.
- Example: "+27 63 448 9940"

**`websiteUrl`**
- Type: string
- Validation: optional, valid URL format if provided
- Purpose: the brand's external website. Displayed on the public store profile so buyers can visit the brand's external site. Many SA creators sell exclusively through YIIVA and Instagram and don't have a separate website — this field stays optional through the entire lifecycle, including go-live.
- Example: "https://boldstreetwear.co.za"

#### Fields Not Accepted at Creation

These fields exist on the Store model but are NOT part of the create DTO. They are populated through other means:

- **`logoUrl` / `bannerUrl`** — these come from a file upload flow. The frontend uploads the image to cloud storage (S3, Cloudinary, etc.) and sends the resulting URL via the update endpoint (Step 3). Not accepted at creation because file upload is a separate interaction.

- **`bankName` / `bankAccountNo` / `bankBranchCode` / `bankAccountType`** — sensitive financial details for payouts. Accepted via the update endpoint (Step 3) rather than creation, because the user might not have these ready when they first start the application. The "I want to sell" moment should be frictionless.

- **`businessRegNo` / `vatNumber`** — CIPC registration and VAT numbers. Same reasoning — gathered during detailed setup, not the initial store creation.

- **`slug`** — generated by the backend from `displayName`. Never provided by the user.

- **`status`** — hardcoded to `DRAFT` at creation. Never user-controlled.

- **`ownerId`** — set from the authenticated user's ID. Never provided in the request body.

- **Store addresses** — added via a separate endpoint after the store exists.

- **Employees** — the owner is identified by `ownerId`, not by a `StoreEmployee` record. Employees are invited after the store is approved.

---

### Slug Generation

The slug is the URL-friendly identifier for the store — used in URLs like `yiiva.co.za/store/bold-streetwear`.

The slugify utility function (`utils/slugify.ts`) applies these transformations in order:

1. **Lowercase** the input
2. **Strip special characters** — remove any character that isn't a letter, number, or space
3. **Replace spaces with hyphens**
4. **Collapse consecutive hyphens** — "my--store" becomes "my-store"
5. **Remove leading and trailing hyphens**

No suffix logic is needed. Since `displayName` is unique across the platform (enforced by the database unique constraint and the explicit check in the service), the slug derived from it is inherently unique. If two different display names somehow produce the same slug (they'd have to differ only in special characters, like "BOLD!" and "BOLD?"), the unique constraint on `slug` catches it and the service returns a conflict error.

**Example transformations:**

| Display Name | Generated Slug |
|---|---|
| "BOLD Streetwear" | `bold-streetwear` |
| "Khanyi's Skincare" | `khanyis-skincare` |
| "THABO & Co." | `thabo-co` |
| "Lux  Essentials" | `lux-essentials` |
| "  BOLD  " | `bold` |
| "Café Culture" | `caf-culture` |

The function is a pure utility — no database calls, no async operations, no side effects. It takes a string in and returns a string out, making it trivial to unit test.

---

### Service Logic: create()

The `create` method in `StoreService` receives the authenticated user's ID (extracted from `@CurrentUser()` in the controller) and the validated DTO. It performs the following operations in order:

**1. Check for existing store.**

```
prisma.store.findUnique({ where: { ownerId: userId } })
```

If a store already exists for this user, throw `ConflictException` with "You already have a store."

The schema enforces this with a unique constraint on `ownerId`, but checking explicitly gives a clean, user-friendly error message rather than a raw Prisma `P2002` unique constraint violation.

This check applies regardless of the existing store's status. Whether the user's store is DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, or CLOSED, they cannot create a second one. If their store was rejected, the record still exists in DRAFT status — they need to update it (Step 3) and resubmit (Step 4), not create a new one.

**2. Check `companyName` uniqueness.**

```
prisma.store.findUnique({ where: { companyName: dto.companyName } })
```

If found, throw `ConflictException` with "A store with that company name already exists."

The database unique constraint would also catch this, but checking explicitly provides two benefits:
- The error message tells the user exactly which name is the problem (company name vs display name)
- The error is a clean HTTP response rather than an unhandled Prisma error

**3. Check `displayName` uniqueness.**

```
prisma.store.findUnique({ where: { displayName: dto.displayName } })
```

If found, throw `ConflictException` with "A store with that display name already exists."

We check company name and display name in separate queries rather than one combined query so the error message is specific. The user needs to know which name to change.

**4. Generate the slug.**

Call `slugify(dto.displayName)`. No database lookup needed for slug uniqueness — the display name uniqueness check in step 3 guarantees the slug will be unique.

**5. Create the store record.**

```
prisma.store.create({
  data: {
    ownerId: userId,
    companyName: dto.companyName,
    displayName: dto.displayName,
    slug: generatedSlug,
    description: dto.description,
    story: dto.story,
    contactEmail: dto.contactEmail,
    contactPhone: dto.contactPhone,
    status: 'DRAFT',
  }
})
```

Key points:
- `status` is hardcoded to `DRAFT`. Not passed from the DTO, not configurable. Every new store starts as a draft.
- The user's role is NOT changed. They remain a BUYER. The role upgrade to MERCHANT only happens when an admin approves the store (Step 6, separate document).
- No `StoreEmployee` record is created. The owner is identified by `Store.ownerId`, not by an employee record. Employee invitations are a post-approval feature.
- Optional fields that weren't provided in the DTO are stored as `null`.

**6. Return the created store.**

Return the full store object from the Prisma create call. The frontend uses this to:
- Confirm the store was created successfully
- Redirect the user into the store setup wizard
- Populate the form with whatever details they've already provided
- Display the store's current status (DRAFT)

---

### Controller

```typescript
@Post()
create(@CurrentUser() user, @Body() dto: CreateStoreDto) {
  return this.storeService.create(user.id, dto);
}
```

- No `@Roles()` decorator — any authenticated user can create a store. The guard pipeline ensures they're authenticated and their account is ACTIVE. The service handles the "one store per user" check.
- The response status is 201 (Created) — NestJS returns this by default for `@Post()` methods.
- `@CurrentUser()` extracts the authenticated user from `request.user` (attached by the JWT strategy).
- `@Body()` triggers the ValidationPipe to validate the request body against `CreateStoreDto`.

---

### Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| User already has a store | 409 Conflict | "You already have a store" |
| Company name taken by another store | 409 Conflict | "A store with that company name already exists" |
| Display name taken by another store | 409 Conflict | "A store with that display name already exists" |
| Missing required fields (name, displayName) | 400 Bad Request | Validation error from class-validator |
| Name too short (< 2 chars) | 400 Bad Request | Validation error |
| Name too long (> 150/100 chars) | 400 Bad Request | Validation error |
| Invalid contact email format | 400 Bad Request | Validation error |
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Account not active (suspended, etc.) | 401 Unauthorized | Handled by JWT strategy |

---

### What We Are NOT Doing in This Step

- **No file uploads.** Logo and banner are handled via the update endpoint after the frontend uploads to cloud storage.
- **No bank details.** Collected during detailed setup via the update endpoint.
- **No submission for review.** That's Step 4 — a separate deliberate action.
- **No role change.** The user stays a BUYER until admin approval.
- **No notification.** Nothing to notify about yet — the store is just a draft.
- **No employee records.** The owner is tracked by `ownerId`, employees come after approval.
- **No address records.** Physical locations are added separately.

---

### What the Frontend Does With This

**Mobile app (intent screen → "I want to sell"):**
1. Shows a simple form: "What's your brand called?" with fields for company name and display name
2. Optionally shows description
3. Hits `POST /stores`
4. On success, navigates to the store setup wizard where they can add more details incrementally across multiple sessions

**Web app (intent screen → "I want to sell"):**
1. Same flow but with more screen space — might show company name, display name, description, and story in one step
2. Hits `POST /stores`
3. On success, navigates to the store setup dashboard in DRAFT state

**Returning user with a DRAFT store:**
The frontend checks `GET /auth/me` → sees `store.status === 'DRAFT'` → routes to the store setup wizard. No need to create again — the store already exists.

---

## Step 3 — Update Store (Draft Stage)

### What Step 3 Accomplishes

The owner updates their store details while it's in DRAFT status. This covers the incremental setup flow — they might add a description today, upload bank details tomorrow, write their brand story next week. The store doesn't need to be completed in one sitting.

This endpoint also works for APPROVED stores (preparing for go-live) and ACTIVE stores (live merchants maintaining their branding), so merchants can update their details at any time outside of active review windows. The same endpoint handles all three editable states.

---

### DTO: update-store.dto.ts

Every field is optional because this is a partial update — the merchant sends only the fields they want to change. The `ValidationPipe` with `whitelist: true` strips any fields not defined in the DTO.

#### Updatable Fields

**Brand identity:**
- `companyName` — string, trimmed, 2–150 characters. If changed, uniqueness is rechecked against the database.
- `displayName` — string, trimmed, 2–100 characters. If changed, uniqueness is rechecked and the slug is regenerated.
- `description` — string, maximum 500 characters.
- `story` — string, maximum 2000 characters.

**Visual branding:**
- `logoUrl` — valid URL string. The frontend uploads the image to cloud storage (S3, Cloudinary, or similar) and sends the resulting URL here. The backend does not handle file uploads — it only stores the URL.
- `bannerUrl` — same as logoUrl. The store's banner/cover image.

**Contact:**
- `contactEmail` — valid email format if provided.
- `contactPhone` — string if provided.
- `websiteUrl` — valid URL format if provided. The brand's external website. Optional throughout the store lifecycle.

**Business registration:**
- `businessRegNo` — string. The CIPC registration number tied to the company name.
- `vatNumber` — string. The VAT registration number, if the business is VAT-registered. Optional even at go-live (small businesses below the VAT threshold are not required to register).

**Payout details:**
- `bankName` — string. The name of the bank (e.g. "FNB", "Standard Bank", "Capitec").
- `bankAccountNo` — string. The account number.
- `bankBranchCode` — string. The branch/universal code.
- `bankAccountType` — string. The type of account (e.g. "Cheque", "Savings").

#### Fields Not Updatable Through This Endpoint

These fields exist on the Store model but are NOT accepted by the update DTO:

- **`status`** — only changes through the submit endpoint (Step 4), admin review (Step 6), the request-go-live endpoint (Step 6a), and the go-live review endpoint (Step 6c). Never directly editable by the merchant through this endpoint.
- **`slug`** — regenerated automatically when `displayName` changes. Never set directly.
- **`ownerId`** — immutable, set at creation. Ownership cannot be transferred through an update.
- **`rejectionReason`** — only set by an admin during review. Cleared automatically by the service when the merchant edits their store after a rejection.
- **Denormalized metrics** (`totalSales`, `totalRevenue`, `averageRating`, `followerCount`) — updated by other modules when events occur (new order, new review, new follower). Never directly editable.

---

### Service Logic: update()

The `update` method in `StoreService` receives the authenticated user's ID, the store ID from the URL parameter, and the validated DTO. It performs the following operations in order:

**1. Find the store and verify ownership.**

Query the store by `id`. If not found, throw `NotFoundException` with "Store not found."

Check that `store.ownerId === userId`. If not, throw `ForbiddenException` with "You do not have permission to edit this store."

In a future step, when employees are implemented, this check will expand to also allow users with an active `StoreEmployee` record for this store. But for now, owner only.

**2. Verify the store status allows editing.**

The store must be in `DRAFT`, `APPROVED`, or `ACTIVE` status to be editable.

- `DRAFT` — the merchant is still setting up, editing is the primary activity
- `APPROVED` — the merchant has been approved for the platform and is preparing to go live (adding products, refining branding). They can still edit store details.
- `ACTIVE` — the store is live and the merchant may need to update branding, bank details, etc.
- `PENDING_REVIEW` — blocked. The merchant shouldn't edit while admins are reviewing the first review — it would be confusing to review a moving target.
- `PENDING_GO_LIVE` — blocked. Same reasoning — the second review is in progress.
- `SUSPENDED` — blocked. The store is suspended by an admin, no edits until the issue is resolved.
- `CLOSED` — blocked. The store is permanently closed.

If the status doesn't allow editing, throw `BadRequestException` with "Store cannot be edited in its current status."

**3. If `companyName` is being changed, check uniqueness.**

Only query the database if `dto.companyName` is provided AND it differs from the current `store.companyName`. No point checking uniqueness if the name isn't changing.

If another store already has that company name, throw `ConflictException` with "A store with that company name already exists."

**4. If `displayName` is being changed, check uniqueness and regenerate slug.**

Same uniqueness check as company name — only if the value is provided and different from current.

If uniqueness passes, regenerate the slug from the new display name using the `slugify()` utility. The new slug replaces the old one.

If the display name isn't changing, the slug stays unchanged.

**5. Build the update data.**

Construct the update payload from only the fields that were provided in the DTO. Prisma's `update` method ignores `undefined` values, so fields not present in the DTO won't be touched.

If `displayName` was changed, include the new `slug` in the update data.

**6. If the store is in DRAFT and has a `rejectionReason`, clear it.**

When a merchant edits their store after a rejection, the old rejection reason becomes stale — they're addressing the feedback. Set `rejectionReason: null` so it doesn't confuse them or the admin on the next review.

This only applies when the store is in DRAFT status (which is the status it returns to after rejection). ACTIVE stores shouldn't have a `rejectionReason` in the first place.

**7. Execute the update.**

Single `prisma.store.update()` call with the constructed data payload.

**8. Return the updated store.**

Return the full updated store object so the frontend can refresh its state.

---

### Controller

```typescript
@Patch(':id')
update(
  @CurrentUser() user,
  @Param('id') storeId: string,
  @Body() dto: UpdateStoreDto
) {
  return this.storeService.update(user.id, storeId, dto);
}
```

- `@Patch()` is used instead of `@Put()` because this is a partial update — only provided fields are changed. `PUT` semantically means "replace the entire resource", `PATCH` means "modify specific fields."
- No `@Roles()` — any authenticated owner can update. The service handles the ownership check.
- The `storeId` comes from the URL parameter, not the request body.

---

### Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Not the owner | 403 Forbidden | "You do not have permission to edit this store" |
| Store in PENDING_REVIEW status | 400 Bad Request | "Store cannot be edited in its current status" |
| Store in SUSPENDED status | 400 Bad Request | "Store cannot be edited in its current status" |
| Store in CLOSED status | 400 Bad Request | "Store cannot be edited in its current status" |
| New company name taken | 409 Conflict | "A store with that company name already exists" |
| New display name taken | 409 Conflict | "A store with that display name already exists" |
| Invalid input | 400 Bad Request | Validation error from class-validator |
| Not authenticated | 401 Unauthorized | "Authentication required" |

---

## Step 4 — Submit Store for Review

### What Step 4 Accomplishes

The owner has filled in their store details over one or more sessions and is ready for YIIVA's curation team to review their application. This is a deliberate action — not an automatic transition. The system validates that all required information is present before allowing submission, then moves the store from DRAFT to PENDING_REVIEW.

This endpoint does not accept a request body. The store already has all its data from Steps 2 and 3. This is just a status transition triggered by a POST.

---

### Required Fields Validation

Before a store can be submitted for review, specific fields must be populated. The service checks each one and returns a clear error listing ALL missing fields — not just the first one. This way the merchant can fix everything in one pass rather than submitting repeatedly to discover each missing field.

#### Brand Identity (Required)

- **`companyName`** — always present (required at creation), so this check always passes. Included for completeness.
- **`displayName`** — always present (required at creation), same as above.
- **`description`** — required for submission. Admins need to understand what the brand sells to evaluate the application. A store with no description isn't ready for a curated marketplace.
- **`logoUrl`** — required for submission. A store without a logo isn't ready to be presented to buyers. Visual identity is central to YIIVA's brand-focused marketplace.

#### Contact (Required)

- **`contactEmail`** — required. YIIVA needs a way to reach the merchant about their application and ongoing operational matters.
- **`contactPhone`** — required. Same reason, and useful for urgent operational communication.

#### Business Registration (Required)

- **`businessRegNo`** — required. The CIPC company registration number. This is a key legitimacy signal — YIIVA is a curated marketplace and CIPC registration confirms the merchant operates a legally registered SA business. This filters out fly-by-night sellers and protects buyers from fraud.

#### Payout (Required)

- **`bankName`** — required. Cannot process payouts without bank details.
- **`bankAccountNo`** — required.
- **`bankBranchCode`** — required.
- **`bankAccountType`** — required.

The payout details must be collected before submission, not after approval. If a store is approved without bank details, completed orders can't be paid out — creating a poor experience for both the merchant and buyers.

**Total: 11 required fields for submission** (companyName, displayName, description, logoUrl, contactEmail, contactPhone, businessRegNo, bankName, bankAccountNo, bankBranchCode, bankAccountType).

#### Not Required for Submission

These fields are nice to have but do not block submission:

- **`story`** — some brands might not have a narrative ready yet. They can add it later. Note: this becomes required at the go-live gate (Step 6a).
- **`bannerUrl`** — optional visual at submission. Note: this becomes required at the go-live gate (Step 6a).
- **`vatNumber`** — not all small businesses are VAT-registered (mandatory only for businesses above R1 million annual turnover in SA). Stays optional throughout the entire lifecycle.
- **`websiteUrl`** — many SA creators sell exclusively through YIIVA and Instagram and don't have a separate website. Stays optional throughout the entire lifecycle.
- **Store addresses** — physical locations are optional at submission. Note: at least one address becomes required at the go-live gate (Step 6a).

**Error response format:**

If any required field is missing, the service returns a `BadRequestException` with a message listing all missing fields:

```json
{
  "statusCode": 400,
  "message": "The following fields are required before submission: description, logoUrl, businessRegNo, bankName, bankAccountNo, bankBranchCode, bankAccountType"
}
```

This is significantly more helpful than returning "description is required", forcing the user to submit again only to find out "logoUrl is required", and so on.

---

### Service Logic: submit()

The `submit` method in `StoreService` receives the authenticated user's ID and the store ID from the URL parameter. It does not receive a request body — there's nothing to send.

**1. Find the store and verify ownership.**

Query the store by `id`. If not found, throw `NotFoundException` with "Store not found."

Check that `store.ownerId === userId`. If not, throw `ForbiddenException` with "You do not have permission to submit this store."

Only the owner can submit a store for review — this is not an action employees can perform.

**2. Verify the store is in DRAFT status.**

Only DRAFT stores can be submitted for review.

- If the store is `PENDING_REVIEW`, throw `BadRequestException` with "Store has already been submitted for review." The merchant needs to wait for the admin decision.
- If the store is `ACTIVE`, throw `BadRequestException` with "Store is already active." An approved store doesn't need to be submitted again.
- If the store is `SUSPENDED` or `CLOSED`, throw `BadRequestException` with "Store cannot be submitted in its current status."

**3. Validate required fields.**

Check every required field listed in the section above. Collect all missing fields into an array:

```typescript
const missingFields = [];
if (!store.description) missingFields.push('description');
if (!store.logoUrl) missingFields.push('logoUrl');
if (!store.contactEmail) missingFields.push('contactEmail');
if (!store.contactPhone) missingFields.push('contactPhone');
if (!store.businessRegNo) missingFields.push('businessRegNo');
if (!store.bankName) missingFields.push('bankName');
if (!store.bankAccountNo) missingFields.push('bankAccountNo');
if (!store.bankBranchCode) missingFields.push('bankBranchCode');
if (!store.bankAccountType) missingFields.push('bankAccountType');
```

If the array is not empty, throw `BadRequestException` with the formatted message listing all missing fields.

**4. Update status to PENDING_REVIEW.**

```
prisma.store.update({
  where: { id: storeId },
  data: {
    status: 'PENDING_REVIEW',
    rejectionReason: null
  }
})
```

The `rejectionReason` is explicitly set to `null` here. This covers the resubmission case — if the store was previously rejected, the old reason is cleared so the next review starts fresh. For a first-time submission, it's already `null`, so setting it again is a harmless no-op.

**5. Notify admins (deferred).**

In the future, this would create a notification for admin users that a new store is waiting for review. For the initial build, admins will check the pending queue manually via the admin endpoint (Step 5, separate document).

When the Notification module is built, this is where it plugs in — a single method call like `notificationService.notifyAdmins('NEW_STORE_PENDING', { storeId, storeName })`.

**6. Return the updated store.**

Return the full store object with the updated status. The frontend uses this to navigate the merchant to a "your store is under review" screen.

---

### Controller

```typescript
@Post(':id/submit')
submit(@CurrentUser() user, @Param('id') storeId: string) {
  return this.storeService.submit(user.id, storeId);
}
```

- No `@Body()` parameter — this endpoint doesn't accept a request body.
- No `@Roles()` — any authenticated owner can submit. The service handles ownership and status checks.
- `@Post()` is used because this is an action (state transition), not a data retrieval.

---

### Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Not the owner | 403 Forbidden | "You do not have permission to submit this store" |
| Store not in DRAFT status | 400 Bad Request | Status-specific message (see step 2 above) |
| Missing required fields | 400 Bad Request | "The following fields are required before submission: [list]" |
| Not authenticated | 401 Unauthorized | "Authentication required" |

---

### The Resubmission Flow

When an admin rejects a store (Step 6, separate document), the store goes back to DRAFT with a `rejectionReason`. The merchant's journey from rejection to resubmission uses the same endpoints:

1. Merchant sees the rejection reason on their dashboard (the `rejectionReason` field on their store)
2. Merchant edits the store via `PATCH /stores/:id` (Step 3) to address the feedback
3. The edit automatically clears the `rejectionReason` (handled in Step 3's service logic)
4. Merchant submits again via `POST /stores/:id/submit` (this step)
5. Store status moves from DRAFT → PENDING_REVIEW
6. `rejectionReason` is cleared again in the submit logic (belt and suspenders — cleared in both places)
7. Admin reviews again

The same two endpoints (update and submit) handle both first-time applications and resubmissions. No special resubmission logic, no separate endpoints, no different flow. The system is the same — the only difference is that the store has more data and (hopefully) addresses the previous feedback.

---

## Testing

### Unit Tests

**Step 2 (Create Store):**

- Successful creation with all fields — store created with DRAFT status, slug matches display name, correct ownerId
- Successful creation with only required fields (companyName, displayName) — all optional fields are null
- User already has a store (any status) — ConflictException with "You already have a store"
- Company name taken by another store — ConflictException with specific message mentioning company name
- Display name taken by another store — ConflictException with specific message mentioning display name
- Slug generation from various display names — special characters stripped, spaces become hyphens, consecutive hyphens collapsed, leading/trailing hyphens removed
- User role is NOT changed after creation — still BUYER
- No StoreEmployee record is created

**Step 3 (Update Store):**

- Successful update of a single field — only that field changes, all others remain the same
- Successful update of multiple fields at once — all provided fields change
- Update display name — slug regenerates to match new name
- Update display name to same value — no uniqueness conflict, slug unchanged
- Update company name to same value — no uniqueness conflict
- Non-owner tries to update — ForbiddenException
- Store in PENDING_REVIEW status — BadRequestException
- Store in SUSPENDED status — BadRequestException
- Store in CLOSED status — BadRequestException
- Store in ACTIVE status — update succeeds (merchants can edit active stores)
- New company name conflicts with another store — ConflictException
- New display name conflicts with another store — ConflictException
- Update after rejection — rejectionReason is cleared to null
- DTO with no fields — no error, but no changes made (empty update)
- Fields not in DTO (status, ownerId, slug) — ignored, not changed

**Step 4 (Submit Store):**

- Successful submission with all required fields present — status becomes PENDING_REVIEW, rejectionReason cleared
- Missing one required field — BadRequestException listing that field
- Missing multiple required fields — BadRequestException listing ALL missing fields (not just the first)
- All required fields present except bankAccountType — BadRequestException
- Store not in DRAFT status (PENDING_REVIEW) — BadRequestException with "already submitted"
- Store not in DRAFT status (ACTIVE) — BadRequestException with "already active"
- Store not in DRAFT status (SUSPENDED) — BadRequestException
- Non-owner tries to submit — ForbiddenException
- Resubmission after rejection — status moves to PENDING_REVIEW, rejectionReason cleared

### Integration Tests

**Full creation flow:**
1. Register a user → verify email
2. `POST /stores` with valid data → 201 with store object → verify DRAFT status
3. `GET /auth/me` → verify response includes `store` with status DRAFT
4. Try creating a second store → 409

**Full setup and submission flow:**
1. Register → verify → create store (companyName + displayName only)
2. `PATCH /stores/:id` with description, story → verify fields updated
3. `PATCH /stores/:id` with logoUrl, contactEmail, contactPhone → verify fields updated
4. `PATCH /stores/:id` with bank details → verify fields updated
5. `POST /stores/:id/submit` → 200 with status PENDING_REVIEW
6. `GET /auth/me` → verify store status is PENDING_REVIEW
7. Try editing while PENDING_REVIEW → 400

**Submission validation flow:**
1. Create store → immediately try to submit (no details filled in) → 400 with list of all missing fields
2. Add some fields → try to submit → 400 with reduced list
3. Add remaining fields → submit → 200

**Uniqueness flows:**
1. Create store with displayName "BOLD Streetwear"
2. Register a different user → try creating a store with the same displayName → 409
3. Try creating with the same companyName → 409
4. Create with different names → succeeds

**Slug verification:**
1. Create a store with displayName "BOLD Streetwear"
2. Verify slug is "bold-streetwear"
3. Update displayName to "BOLD Athletics"
4. Verify slug changed to "bold-athletics"

### Manual Checks

- Create a store, inspect the database directly — verify `ownerId`, `status` (DRAFT), `slug`, `companyName`, `displayName` are all correct
- Update with bank details — verify they're stored correctly in the database
- Submit — verify status changed to PENDING_REVIEW in the database
- Try editing while PENDING_REVIEW — confirm 400 error response
- Check `GET /auth/me` response includes store data at each stage of the flow
- Create two stores with different users but similar display names (e.g. "BOLD" and "Bold!") — verify the slugs are different or a conflict is raised
- Verify no `StoreEmployee` records exist after store creation — check the `store_employees` table
- Verify the user's role is still BUYER after store creation — check the `users` table

---

## API Endpoints Summary (Steps 1–4)

| Method | Path | Auth | Description | Request Body |
|--------|------|------|-------------|--------------|
| POST | `/stores` | Any authenticated user | Create a new store in DRAFT status | `{ companyName, displayName, description?, story?, contactEmail?, contactPhone?, websiteUrl? }` |
| PATCH | `/stores/:id` | Store owner | Update store details | `{ companyName?, displayName?, description?, story?, contactEmail?, contactPhone?, websiteUrl?, logoUrl?, bannerUrl?, businessRegNo?, vatNumber?, bankName?, bankAccountNo?, bankBranchCode?, bankAccountType? }` |
| POST | `/stores/:id/submit` | Store owner | Submit store for admin review (1st review) | None |
