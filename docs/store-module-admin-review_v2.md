# YIIVA — Store Module: Admin Review Flow (Steps 5–6)

> Technical reference for the admin store review process — listing pending stores and approving or rejecting store applications.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Context](#context)
- [Step 5 — Admin: List Pending Stores](#step-5--admin-list-pending-stores)
  - [What This Step Accomplishes](#what-step-5-accomplishes)
  - [Endpoint](#endpoint)
  - [Query Parameters (Pagination & Filtering)](#query-parameters-pagination--filtering)
  - [DTO: list-pending-stores.dto.ts](#dto-list-pending-storesdtots)
  - [Service Logic: listPending()](#service-logic-listpending)
  - [Response Shape](#response-shape)
  - [Controller](#controller)
  - [Error Cases](#step-5-error-cases)
  - [What the Admin Sees](#what-the-admin-sees)
- [Step 6 — Admin: Review Store (Approve or Reject)](#step-6--admin-review-store-approve-or-reject)
  - [What This Step Accomplishes](#what-step-6-accomplishes)
  - [Endpoint](#endpoint-1)
  - [DTO: review-store.dto.ts](#dto-review-storedtots)
  - [Service Logic: review()](#service-logic-review)
    - [Approval Flow](#approval-flow)
    - [Rejection Flow](#rejection-flow)
  - [Controller](#controller-1)
  - [Error Cases](#step-6-error-cases)
  - [What Happens After Approval](#what-happens-after-approval)
  - [JWT Role Timing Consideration](#jwt-role-timing-consideration)
  - [What Happens After Rejection](#what-happens-after-rejection)
  - [Audit Considerations](#audit-considerations)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Manual Checks](#manual-checks)
- [API Endpoints Summary (Steps 5–6)](#api-endpoints-summary-steps-56)

---

## Context

Steps 5 and 6 are the admin side of the store application process. After a BUYER creates a store (Step 2), fills in details (Step 3), and submits for review (Step 4), the store enters PENDING_REVIEW status. An admin then needs to review the application and either approve it (activating the store and upgrading the owner to MERCHANT) or reject it (sending the store back to DRAFT with feedback).

This is the most critical flow in the Store module because it:
- Controls quality curation — the core differentiator that makes YIIVA a curated marketplace rather than a free-for-all
- Triggers the BUYER → MERCHANT role upgrade — the atomic transaction that unlocks the merchant dashboard
- Sets the feedback loop for rejected applications — merchants know what to fix and can resubmit

Both endpoints are ADMIN-only — these are the first endpoints in the store module that use the `@Roles()` decorator.

---

## Step 5 — Admin: List Pending Stores

### What Step 5 Accomplishes

An admin needs to see which stores are waiting for review. This is the admin's work queue — they open the admin panel, see a list of stores in PENDING_REVIEW status, and pick one to review. Without this endpoint, admins would have no way to know which stores need attention.

---

### Endpoint

```
GET /stores/admin/pending
```

**Role:** ADMIN only. Buyers and merchants should never see other people's store applications. This is enforced by the `@Roles(UserRole.ADMIN)` decorator, which causes the RolesGuard to return 403 Forbidden for any non-admin user.

---

### Query Parameters (Pagination & Filtering)

The pending queue could grow as YIIVA scales, so pagination is built in from the start. The endpoint accepts the following query parameters:

**`page`** — which page of results to return. Defaults to `1`. Must be a positive integer. Example: `?page=2` returns the second page.

**`limit`** — how many stores per page. Defaults to `20`. Maximum `50` to prevent large queries that could impact performance. Must be a positive integer. Example: `?limit=10` returns 10 stores per page.

**`sortBy`** — how to order results. Defaults to `createdAt`. Only option for the initial build is `createdAt`, but the parameter is structured so additional sort fields (like `displayName` or `companyName`) can be added later without changing the API contract.

**`sortOrder`** — `asc` or `desc`. Defaults to `asc` (oldest first). This creates a FIFO queue so the stores that have been waiting the longest get reviewed first. Admins can switch to `desc` if they want to see the newest applications first.

No search or text filter parameters for the initial build. The queue is simple — everything in PENDING_REVIEW status, paginated and sorted.

---

### DTO: list-pending-stores.dto.ts

This is a query DTO validated from `@Query()`, not a body DTO validated from `@Body()`:

**`page`**
- Type: number (transformed from string)
- Validation: optional, integer, minimum 1
- Default: 1
- Notes: Query parameters arrive as strings from the URL. The DTO needs a `@Transform()` decorator to convert `"1"` to `1`. Example: `@Transform(({ value }) => parseInt(value))` followed by `@IsInt()` and `@Min(1)`.

**`limit`**
- Type: number (transformed from string)
- Validation: optional, integer, minimum 1, maximum 50
- Default: 20
- Notes: Same string-to-number transformation as `page`. The maximum of 50 prevents clients from requesting unreasonably large pages that would load the database.

**`sortOrder`**
- Type: string
- Validation: optional, must be `asc` or `desc`
- Default: `asc`
- Notes: Can be validated with `@IsIn(['asc', 'desc'])`.

---

### Service Logic: listPending()

The `listPending` method in `StoreService` receives the validated query parameters and performs two database operations:

**1. Fetch the paginated stores.**

```typescript
const stores = await this.prisma.store.findMany({
  where: { status: 'PENDING_REVIEW' },
  orderBy: { createdAt: query.sortOrder },
  skip: (query.page - 1) * query.limit,
  take: query.limit,
  include: {
    owner: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      }
    }
  }
});
```

Key details:
- The `where` clause filters to only PENDING_REVIEW stores. No other statuses are included.
- `skip` and `take` handle pagination. `skip` calculates how many records to skip based on the current page and page size. `take` limits the result count.
- The `include` brings in the store owner's basic information so the admin knows who applied. We use `select` on the owner relation to explicitly choose which fields are returned — this prevents exposing sensitive fields like `passwordHash`, `verificationToken`, `resetToken`, or any other data the admin doesn't need and shouldn't see.

**2. Get the total count.**

```typescript
const total = await this.prisma.store.count({
  where: { status: 'PENDING_REVIEW' }
});
```

This tells us the total number of pending stores across all pages, which the frontend needs for pagination controls.

Both queries can be batched in a single `prisma.$transaction()` for efficiency — they execute as a single database round-trip rather than two sequential queries:

```typescript
const [stores, total] = await this.prisma.$transaction([
  this.prisma.store.findMany({ ... }),
  this.prisma.store.count({ ... }),
]);
```

**3. Compute pagination metadata.**

```typescript
const totalPages = Math.ceil(total / query.limit);
```

**4. Return the structured response.**

Return both the data array and the pagination metadata in a consistent shape that the frontend can rely on.

---

### Response Shape

```json
{
  "data": [
    {
      "id": "clx1abc123",
      "companyName": "Khanyi Creative Ventures (Pty) Ltd",
      "displayName": "BOLD Streetwear",
      "slug": "bold-streetwear",
      "description": "Premium streetwear inspired by Johannesburg's urban culture",
      "story": "We started in a garage in Soweto...",
      "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
      "bannerUrl": "https://cdn.yiiva.co.za/stores/bold/banner.jpg",
      "contactEmail": "hello@boldstreetwear.co.za",
      "contactPhone": "+27 63 448 9940",
      "businessRegNo": "2024/123456/07",
      "vatNumber": null,
      "bankName": "FNB",
      "bankAccountNo": "62812345678",
      "bankBranchCode": "250655",
      "bankAccountType": "Cheque",
      "status": "PENDING_REVIEW",
      "createdAt": "2025-03-15T10:30:00.000Z",
      "updatedAt": "2025-03-16T14:22:00.000Z",
      "owner": {
        "id": "clx1user456",
        "email": "khanyi@gmail.com",
        "firstName": "Khanyi",
        "lastName": "Mthamo",
        "phone": "+27 63 448 9940"
      }
    }
  ],
  "meta": {
    "total": 47,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

The `data` array contains the store objects with all their details — the admin needs to see everything to make an informed decision. The bank details, business registration, contact info, brand story, and visuals are all relevant to the review.

The `meta` object provides everything the frontend needs for pagination controls:
- `total` — total number of pending stores across all pages
- `page` — the current page being viewed
- `limit` — how many stores per page
- `totalPages` — computed total number of pages

---

### Controller

```typescript
@Get('admin/pending')
@Roles(UserRole.ADMIN)
listPending(@Query() query: ListPendingStoresDto) {
  return this.storeService.listPending(query);
}
```

**Route ordering is critical.** This route is `GET /stores/admin/pending`. If you also have `GET /stores/:slug` (Step 8), NestJS evaluates routes in the order they are declared in the controller. If the `/:slug` route is declared before `admin/pending`, a request to `/stores/admin/pending` would match `/:slug` with `slug = "admin"` instead of hitting the intended route.

The fix is simple: declare all specific routes (`admin/pending`, `me`) before any parameterised routes (`/:id`, `/:slug`) in the controller class. NestJS matches top-down and uses the first match.

---

### Step 5 Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Not an admin (BUYER or MERCHANT) | 403 Forbidden | "Forbidden resource" |
| Invalid page value (0, negative, non-numeric) | 400 Bad Request | Validation error |
| Invalid limit value (0, negative, > 50, non-numeric) | 400 Bad Request | Validation error |
| Invalid sortOrder (not "asc" or "desc") | 400 Bad Request | Validation error |
| No pending stores | 200 OK | Returns `{ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }` — not an error |

---

### What the Admin Sees

The admin panel displays this endpoint's data as a table or card list:

- Store display name and company name
- Logo thumbnail (from `logoUrl`)
- Owner name and email (from the included `owner` object)
- When they applied (from `createdAt`, formatted as relative time like "3 days ago" or absolute date)
- A "Review" button that navigates to the individual store review screen

If the queue is empty (`data` array is empty), the admin sees a clean "No stores pending review" message. If there are many pending stores, pagination controls at the bottom let them navigate between pages.

The admin reviews each store by looking at the submitted information and then calling Step 6 (approve or reject).

---

## Step 6 — Admin: Review Store (Approve or Reject)

### What Step 6 Accomplishes

This is the first review gate in the Store module. An admin makes a decision on a pending store application — approve it or reject it.

**Approval** triggers the atomic role upgrade: the store status changes from `PENDING_REVIEW` to `APPROVED`, and the owner's role changes from `BUYER` to `MERCHANT` in a single database transaction. From this point, the owner can access the merchant dashboard, start adding products, and prepare for launch. **However, the store is not yet visible to buyers.** It must pass a second review gate (the go-live review, Step 6c) to become `ACTIVE` and appear in the buyer feed.

**Rejection** sends the store back to `DRAFT` with feedback explaining what needs to change. The owner remains a `BUYER` and can edit and resubmit.

> **Note on the two-gate review system:** YIIVA uses two separate admin reviews to balance curation quality with merchant readiness. The first review (this step) verifies that the brand is legitimate — real company, real bank details, real contact info. Once approved, the merchant gains dashboard access and can start building out their store. The second review (Step 6c) verifies the store is ready for buyers — full content, banner image, at least one physical location, and at least 7 active products. Only after the second approval does the store become visible to buyers on the mobile app.

---

### Endpoint

```
POST /stores/:id/review
```

**Role:** ADMIN only. Enforced by `@Roles(UserRole.ADMIN)`.

The `:id` parameter is the store's ID, not the owner's user ID. The admin navigates from the pending list (Step 5) where each store has its ID.

---

### DTO: review-store.dto.ts

**`decision`**
- Type: enum
- Validation: required, must be `APPROVE` or `REJECT`
- Purpose: explicitly states what the admin is doing. No ambiguity.

The enum is defined in TypeScript (not as a Prisma enum — it's not stored in the database):

```typescript
enum ReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}
```

Validated with `@IsEnum(ReviewDecision)`.

**`reason`**
- Type: string
- Validation: **required if decision is REJECT**, optional if decision is APPROVE. When required, minimum 10 characters.
- Purpose: for rejections, the admin must explain why so the merchant knows what to fix. A minimum of 10 characters forces meaningful feedback — not just "no" or "bad". For approvals, an optional reason allows the admin to leave a welcoming note (e.g. "Great brand, welcome to YIIVA!") but doesn't require it.

The conditional validation (required only on rejection) can be handled in two ways:

**Option A — Custom class-validator decorator.** Create a `@ValidateIf()` rule:
```typescript
@ValidateIf((o) => o.decision === ReviewDecision.REJECT)
@IsNotEmpty({ message: 'A rejection reason is required' })
@MinLength(10, { message: 'Rejection reason must be at least 10 characters' })
reason?: string;
```

**Option B — Validate in the service.** Accept `reason` as optional in the DTO and check in the service:
```typescript
if (dto.decision === 'REJECT' && (!dto.reason || dto.reason.length < 10)) {
  throw new BadRequestException('A rejection reason is required and must be at least 10 characters');
}
```

Either approach works. Option A keeps validation in the DTO layer (where it belongs), Option B is simpler to implement. The service-level check should exist regardless as belt-and-suspenders.

---

### Service Logic: review()

The `review` method in `StoreService` receives the admin's user ID, the store ID from the URL parameter, and the validated DTO. It branches based on `dto.decision`.

#### Approval Flow

**1. Find the store.**

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  include: { owner: true },
});
```

Include the owner because we need the owner's ID for the role upgrade and their email/name for the notification. If not found, throw `NotFoundException` with "Store not found."

**2. Verify the store is in PENDING_REVIEW status.**

```typescript
if (store.status !== 'PENDING_REVIEW') {
  throw new BadRequestException('Only stores in PENDING_REVIEW status can be reviewed');
}
```

This prevents:
- Approving a DRAFT store that hasn't been submitted yet
- Re-approving an already APPROVED store
- Approving a store that has already been through the second review (PENDING_GO_LIVE or ACTIVE)
- Approving a SUSPENDED or CLOSED store

**3. Execute the atomic transaction.**

This is the most important database operation in the Store module. Two things must happen together — either both succeed or both fail:

```typescript
await this.prisma.$transaction([
  // Update store status to APPROVED (not ACTIVE — that's a separate gate)
  // and clear any previous rejection reason
  this.prisma.store.update({
    where: { id: storeId },
    data: {
      status: 'APPROVED',
      rejectionReason: null,
    },
  }),

  // Upgrade owner's role from BUYER to MERCHANT
  this.prisma.user.update({
    where: { id: store.ownerId },
    data: {
      role: 'MERCHANT',
    },
  }),
]);
```

**Why the role upgrade happens here, not at go-live:** The merchant needs MERCHANT role and dashboard access to add products, refine their branding, and prepare for launch. Without the role upgrade at this point, they couldn't fulfill the "add 7 active products" requirement for the second review. The role upgrade is the gate that says "you're approved to use the merchant dashboard," while the ACTIVE status is the separate gate that says "you're ready to be seen by buyers."

**Why a transaction is essential:** Without a transaction, if the store update succeeds but the user update fails (due to a database error, connection drop, etc.), you end up in an inconsistent state:
- An APPROVED store with a BUYER owner → the owner can't access the merchant dashboard despite having an approved store
- Or the reverse: a MERCHANT user with a DRAFT store → they have merchant permissions but no approved store

The Prisma `$transaction` wraps both operations in a single PostgreSQL transaction. If either fails, the entire transaction is rolled back. The database is never left in an inconsistent state.

**`rejectionReason` is set to `null`** in the update. This handles the edge case where a store was previously rejected, the merchant fixed and resubmitted, and the admin is now approving on the second attempt. The old rejection reason is no longer relevant and should be cleared.

**4. Send a notification to the owner.**

The merchant needs to know their store was approved without having to keep logging in to check. The Email service (already built for the auth module) handles delivery:

```typescript
await this.emailService.sendStoreApprovalEmail(
  store.owner.email,
  store.owner.firstName,
  store.displayName,
);
```

This method would need to be added to the Email service. The email content:
- Subject: "Your store has been approved! Time to add your products"
- Body: addresses the owner by first name, congratulates them, mentions the store display name, explains the next steps (add at least 7 active products, upload your banner image, write your brand story if you haven't already, then request to go live), provides a link to the merchant dashboard

The email should make clear that approval is the **first** of two gates, not the final step. The merchant should understand they need to take more action before their store appears to buyers.

If the email fails to send, the approval still stands — the transaction already committed. The email failure is logged but doesn't roll back the approval. The merchant will discover their approval on their next login when `/auth/me` shows `store.status: 'APPROVED'`.

**5. Return the updated store.**

Fetch and return the updated store with the owner included so the admin can confirm:
- Store status is now APPROVED
- Owner role is now MERCHANT

```typescript
return this.prisma.store.findUnique({
  where: { id: storeId },
  include: {
    owner: {
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      }
    }
  }
});
```

#### Rejection Flow

**1. Find the store.**

Same as approval — query by `id`, include the owner for notification purposes. If not found, throw `NotFoundException` with "Store not found."

**2. Verify the store is in PENDING_REVIEW status.**

Same check as approval. Only PENDING_REVIEW stores can be reviewed.

**3. Validate that a reason was provided.**

```typescript
if (!dto.reason || dto.reason.trim().length < 10) {
  throw new BadRequestException(
    'A rejection reason is required and must be at least 10 characters'
  );
}
```

This should already be caught by the DTO validation (if using Option A above), but a service-level check provides belt-and-suspenders safety. The admin must provide meaningful feedback.

**4. Update the store.**

```typescript
await this.prisma.store.update({
  where: { id: storeId },
  data: {
    status: 'DRAFT',
    rejectionReason: dto.reason,
  },
});
```

Key decisions:
- The store goes back to **DRAFT**, not to a dead-end "REJECTED" status. This keeps the flow simple — the merchant edits (Step 3) and resubmits (Step 4) using the same endpoints. No separate resubmission flow needed.
- The `rejectionReason` is stored so the merchant can see what needs fixing when they next visit their store setup.
- **No role change on rejection.** The owner stays a BUYER. They were never upgraded to MERCHANT, so there's nothing to revert.

**5. Send a notification to the owner.**

```typescript
await this.emailService.sendStoreRejectionEmail(
  store.owner.email,
  store.owner.firstName,
  store.displayName,
  dto.reason,
);
```

This method would need to be added to the Email service. The email content:
- Subject: "Your store application needs changes"
- Body: addresses the owner by first name, mentions the store display name, includes the full rejection reason, explains that they can make changes and resubmit, provides a link to the store setup page
- Tone: constructive and encouraging, not punitive. "We'd love to have you on YIIVA — here's what needs attention" rather than "Your application has been denied."

The rejection reason must be included in the email body. The merchant needs to see the feedback without having to log in and navigate to their store. This is important for conversion — making it easy to fix and resubmit increases the likelihood they'll follow through.

As with approval, if the email fails to send, the rejection still stands. The email failure is logged but doesn't affect the store status update.

**6. Return the updated store.**

Return the store with its updated status and rejection reason. The admin can confirm the rejection went through.

---

### Controller

```typescript
@Post(':id/review')
@Roles(UserRole.ADMIN)
review(
  @CurrentUser() admin,
  @Param('id') storeId: string,
  @Body() dto: ReviewStoreDto,
) {
  return this.storeService.review(admin.id, storeId, dto);
}
```

- `@Roles(UserRole.ADMIN)` ensures only admins can call this endpoint. The RolesGuard checks the authenticated user's role and returns 403 for anyone else.
- `admin.id` is passed to the service even though the current implementation doesn't use it directly. It's useful for audit logging — tracking which admin approved or rejected which store — which is a likely future addition.
- The store ID comes from the URL parameter (`/stores/abc123/review`).
- The request body is validated against `ReviewStoreDto` by the ValidationPipe.

---

### Step 6 Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Store not in PENDING_REVIEW (DRAFT) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Store not in PENDING_REVIEW (APPROVED) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Store not in PENDING_REVIEW (PENDING_GO_LIVE) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Store not in PENDING_REVIEW (ACTIVE) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Store not in PENDING_REVIEW (SUSPENDED) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Store not in PENDING_REVIEW (CLOSED) | 400 Bad Request | "Only stores in PENDING_REVIEW status can be reviewed" |
| Decision is REJECT but no reason provided | 400 Bad Request | "A rejection reason is required and must be at least 10 characters" |
| Decision is REJECT but reason too short (< 10 chars) | 400 Bad Request | "A rejection reason is required and must be at least 10 characters" |
| Invalid decision value (not APPROVE or REJECT) | 400 Bad Request | Validation error from class-validator |
| Empty request body | 400 Bad Request | Validation error (decision is required) |
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Authenticated but not ADMIN (BUYER) | 403 Forbidden | "Forbidden resource" |
| Authenticated but not ADMIN (MERCHANT) | 403 Forbidden | "Forbidden resource" |

---

### What Happens After Approval

The moment the transaction commits, several things become true simultaneously:

**For the store owner:**
- Their `role` in the database is now `MERCHANT`
- Their store `status` in the database is now `APPROVED` (NOT `ACTIVE` — that's a separate gate)
- Their next `GET /auth/me` response will include `role: 'MERCHANT'` and `store: { status: 'APPROVED', ... }`
- Their next token refresh will issue a new access token with `role: 'MERCHANT'` in the JWT payload
- They can now access the full merchant dashboard on both the web app and mobile app
- They can start adding products, managing addresses, refining their branding
- They receive an email notification about the approval and the next steps to go live
- They CANNOT yet be discovered by buyers — the store is invisible until it passes the second review and becomes ACTIVE

**For buyers:**
- **Nothing changes.** The store does NOT become visible. It's still invisible to buyers because it's in `APPROVED` status, not `ACTIVE`. The public store profile endpoint (Step 8) returns 404 for any non-ACTIVE store.
- The store will only become visible after the merchant adds at least 7 active products, fills in the remaining required fields (banner, story, address), requests go-live, and receives the second admin approval.

**For the admin:**
- The store disappears from the pending queue (Step 5's endpoint no longer returns it because it's no longer in `PENDING_REVIEW` status)
- The admin can see the approval reflected in the store's data if they query it directly
- The store will reappear in the admin's queue later — in the go-live pending queue (Step 6b) — once the merchant requests to go live

---

### JWT Role Timing Consideration

There is an important timing nuance with JWT-based authentication after a role upgrade.

**The problem:** When the admin approves a store, the owner's `role` changes to `MERCHANT` in the database immediately. However, the owner's current access token was signed when they last logged in or refreshed, and it contains `role: 'BUYER'` in its JWT payload. The JWT strategy validates the token's signature and expiry, but the `role` embedded in the token is now stale.

This means there's a window (up to 15 minutes, the access token's lifetime) where:
- The database says the user is a MERCHANT
- The JWT says the user is a BUYER
- If the `@Roles()` guard reads the role from the JWT, the user might be denied access to MERCHANT-only endpoints despite being a merchant in the database

**Two approaches to resolve this:**

**Option A — Wait for natural refresh.** The access token expires in ≤15 minutes. On the next refresh, the new access token is signed with the current database role (`MERCHANT`). The frontend could poll `/auth/me` periodically or on navigation to detect role changes and prompt a token refresh.

Pros: No changes to the existing auth infrastructure.
Cons: Up to 15 minutes of stale role. Slight UX delay — the merchant might try to access the dashboard immediately after receiving the approval email and get denied.

**Option B — Read role from database in the JWT strategy (recommended).** The JWT strategy already performs a database lookup on every request to check `accountStatus`. Modify it to also attach the database role (not the JWT role) to `request.user`. The `@Roles()` guard then checks the real-time database role instead of the stale JWT role.

```typescript
// In jwt.strategy.ts validate() method
async validate(payload: JwtPayload) {
  const user = await this.prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user || user.accountStatus !== 'ACTIVE') {
    throw new UnauthorizedException();
  }

  // Return the DATABASE role, not the JWT role
  return {
    id: user.id,
    email: user.email,
    role: user.role,           // From database, always current
    accountStatus: user.accountStatus,
  };
}
```

Pros: Role is always current. No stale window. Consistent with how we handle `accountStatus` (real-time from DB).
Cons: None meaningful — the database lookup is already happening on every request; we're just using a different field from the same record.

**Recommendation: Option B.** It's consistent with the existing pattern, has zero performance cost (no additional query), and eliminates the stale role window entirely. The JWT role becomes a hint/optimization, the database role is the source of truth.

---

### What Happens After Rejection

**For the store owner:**
- Their `role` stays `BUYER` — they were never upgraded
- Their `store.status` is back to `DRAFT`
- `store.rejectionReason` contains the admin's feedback
- They receive an email with the rejection reason and guidance on what to fix
- On their next visit to the store setup flow:
  - The frontend checks `/auth/me` → sees `store.status: 'DRAFT'` and `store.rejectionReason` is not null
  - The rejection reason is displayed prominently (e.g. a banner at the top of the setup wizard)
  - The merchant can edit their store details to address the feedback
- When they edit (Step 3), the `rejectionReason` is cleared automatically
- When they resubmit (Step 4), the store moves back to PENDING_REVIEW
- The resubmission appears in the admin's pending queue again

**For the admin:**
- The store disappears from the pending queue (it's no longer PENDING_REVIEW)
- If the merchant resubmits, the store reappears in the queue as a new entry

**The resubmission cycle:** A store can be rejected and resubmitted multiple times. There is no limit on resubmissions. Each cycle uses the same endpoints:
1. Merchant edits → `PATCH /stores/:id` (Step 3)
2. Merchant resubmits → `POST /stores/:id/submit` (Step 4)
3. Admin reviews → `POST /stores/:id/review` (this step)

The flow is identical each time. The only data that changes is the store's content and the admin's feedback.

---

### Audit Considerations

For the initial build, we don't implement a formal audit log. The current schema tracks the most recent state:
- `store.status` — current status
- `store.rejectionReason` — most recent rejection reason (null after approval or after the merchant starts editing)

This is sufficient for the initial launch but has a limitation: it doesn't track history. If a store is rejected twice before being approved, only the most recent rejection reason is preserved. The first rejection's feedback is overwritten.

**For a future enhancement**, a `StoreReview` model could track the complete review history:

```prisma
model StoreReview {
  id        String   @id @default(cuid())
  storeId   String
  adminId   String
  decision  String   // "APPROVE" or "REJECT"
  reason    String?
  createdAt DateTime @default(now())

  store     Store    @relation(fields: [storeId], references: [id])
  admin     User     @relation(fields: [adminId], references: [id])

  @@index([storeId])
  @@map("store_reviews")
}
```

Each submission + review cycle creates a new record. This would enable:
- Viewing the full review history for a store
- Tracking which admin reviewed which store and when
- Analytics on approval rates, average review time, common rejection reasons
- Accountability for admin decisions

This is not needed for launch but is worth noting as a planned enhancement.

---

## Testing

### Unit Tests

#### Step 5 (List Pending Stores)

**Returns only PENDING_REVIEW stores:**
Mock stores in various statuses (DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, CLOSED). Verify only PENDING_REVIEW stores are returned. Other statuses should not appear in the results regardless of pagination.

**Pagination — first page:**
Mock 25 pending stores. Request page 1 with limit 10. Verify:
- 10 stores returned in the data array
- Meta shows `total: 25`, `page: 1`, `limit: 10`, `totalPages: 3`

**Pagination — second page:**
Same 25 stores. Request page 2 with limit 10. Verify:
- 10 different stores returned (the next batch)
- Meta shows `total: 25`, `page: 2`, `limit: 10`, `totalPages: 3`

**Pagination — last page:**
Request page 3 with limit 10. Verify:
- 5 stores returned (the remaining ones)
- Meta shows `total: 25`, `page: 3`, `limit: 10`, `totalPages: 3`

**Empty queue:**
Mock no stores in PENDING_REVIEW status. Verify:
- Empty data array
- Meta shows `total: 0`, `page: 1`, `limit: 20`, `totalPages: 0`
- No error thrown — an empty queue is a valid state, not an error

**Includes owner info:**
Verify the response includes the owner's `id`, `email`, `firstName`, `lastName`, and `phone`. Verify it does NOT include `passwordHash`, `verificationToken`, `resetToken`, `verificationExpiry`, `resetExpiry`, or any other sensitive user fields.

**Default sort order:**
Mock stores with different `createdAt` timestamps. Verify the default order is ascending (oldest first — the store that's been waiting longest appears first).

**Descending sort order:**
Pass `sortOrder: 'desc'`. Verify the newest store appears first.

#### Step 6 (Review — Approval)

**Successful approval:**
Mock a store in PENDING_REVIEW with an owner who is a BUYER. Call `review()` with `decision: 'APPROVE'`. Verify:
- `prisma.$transaction` is called
- Store status is set to APPROVED (NOT ACTIVE)
- Owner role is set to MERCHANT
- `rejectionReason` is set to null
- Email notification method is called with correct arguments (owner email, name, store name)

**Store not in PENDING_REVIEW:**
Test with each non-PENDING_REVIEW status:
- DRAFT → BadRequestException
- APPROVED → BadRequestException
- PENDING_GO_LIVE → BadRequestException
- ACTIVE → BadRequestException
- SUSPENDED → BadRequestException
- CLOSED → BadRequestException
Verify the same error message for all: "Only stores in PENDING_REVIEW status can be reviewed."

**Store not found:**
Mock `prisma.store.findUnique` returning null. Verify NotFoundException with "Store not found."

**Transaction atomicity:**
Mock the transaction throwing an error (simulating a database failure mid-transaction). Verify:
- Neither the store status nor the user role changes
- The error is propagated (not swallowed)

**Previous rejection reason cleared:**
Mock a store that was previously rejected (has a `rejectionReason` value) and is now being approved on resubmission. Verify `rejectionReason` is set to null after approval.

**Email notification sent on approval:**
Verify the email service's approval method is called exactly once with the owner's email, first name, and store display name.

**Email failure doesn't roll back approval:**
Mock the email service throwing an error. Verify the transaction still committed (store is APPROVED, owner is MERCHANT) and the error is logged but not thrown to the admin.

#### Step 6 (Review — Rejection)

**Successful rejection:**
Mock a store in PENDING_REVIEW. Call `review()` with `decision: 'REJECT', reason: 'Logo quality needs improvement, please upload a higher resolution image'`. Verify:
- Store status is set to DRAFT
- `rejectionReason` is set to the provided reason
- Owner role stays BUYER (verify no `user.update` call)

**Rejection without reason:**
Call with `decision: 'REJECT'` and no `reason` field. Verify BadRequestException with "A rejection reason is required and must be at least 10 characters."

**Rejection with reason too short:**
Call with `decision: 'REJECT', reason: 'bad'` (3 characters). Verify BadRequestException with the same message.

**Rejection with reason exactly 10 characters:**
Call with `decision: 'REJECT', reason: '1234567890'`. Verify it succeeds — 10 characters is the minimum, not above minimum.

**Owner role unchanged on rejection:**
Verify that `prisma.user.update` is NOT called during a rejection. The owner stays a BUYER.

**Email notification sent on rejection:**
Verify the email service's rejection method is called with the owner's email, first name, store display name, and the rejection reason.

#### Step 6 (Authorization)

**BUYER tries to review:**
Set `request.user.role` to BUYER. Verify the RolesGuard returns 403 Forbidden before the service method is ever called.

**MERCHANT tries to review:**
Set `request.user.role` to MERCHANT. Verify 403 Forbidden.

**ADMIN succeeds:**
Set `request.user.role` to ADMIN. Verify the service method is called and returns successfully.

### Integration Tests

#### Full approval flow

This is the most important integration test for Step 6. It validates the journey from store creation to merchant activation (first gate). Note that the store is NOT yet visible to buyers after this flow — it must pass the second gate (Step 6c) to become ACTIVE.

1. Register user A → verify email → confirm role is BUYER
2. `POST /stores` — create store with companyName and displayName
3. `PATCH /stores/:id` — update with all 11 required fields (description, logoUrl, contactEmail, contactPhone, businessRegNo, bank details)
4. `POST /stores/:id/submit` — submit for review → confirm status is PENDING_REVIEW
5. Register an admin user (directly set role to ADMIN in the database via Prisma, since there's no admin registration endpoint)
6. `GET /stores/admin/pending` as admin → verify user A's store appears in the list with owner info
7. `POST /stores/:id/review` as admin with `{ decision: 'APPROVE' }` → 200
8. `GET /stores/admin/pending` as admin → verify the queue is now empty (the approved store is gone)
9. `GET /auth/me` as user A → verify:
   - `role` is `MERCHANT`
   - `store.status` is `APPROVED` (NOT `ACTIVE`)
   - `store.rejectionReason` is null
10. Verify the mock email service was called with approval email details
11. `GET /stores/:slug` as a different user → confirm 404 (store is not yet visible to buyers because it's APPROVED, not ACTIVE)

#### Full rejection and resubmission flow

1. Register user → verify → create store → fill in all 11 required details → submit
2. Register admin → log in as admin
3. `POST /stores/:id/review` as admin with `{ decision: 'REJECT', reason: 'Logo quality needs improvement. Please upload a higher resolution image with minimum 500x500px dimensions.' }`
4. Verify response shows store status DRAFT and rejectionReason present
5. `GET /auth/me` as user → verify:
   - `role` is still `BUYER`
   - `store.status` is `DRAFT`
   - `store.rejectionReason` matches the admin's feedback
6. `PATCH /stores/:id` as user with `{ logoUrl: 'https://cdn.yiiva.co.za/new-logo.png' }` → verify rejectionReason is cleared
7. `POST /stores/:id/submit` → verify status is PENDING_REVIEW again
8. `GET /stores/admin/pending` as admin → verify store reappears in the queue
9. `POST /stores/:id/review` as admin with `{ decision: 'APPROVE' }` → 200
10. `GET /auth/me` as user → verify role is MERCHANT, store is APPROVED

#### Authorization tests

1. Register a regular user (BUYER) → log in
2. `GET /stores/admin/pending` as BUYER → 403 Forbidden
3. Create and submit a store → get approved (role becomes MERCHANT)
4. `GET /stores/admin/pending` as MERCHANT → 403 Forbidden
5. Log in as ADMIN → `GET /stores/admin/pending` → 200 (success)
6. Log in as BUYER → `POST /stores/:id/review` → 403 Forbidden
7. Log in as MERCHANT → `POST /stores/:id/review` → 403 Forbidden
8. Log in as ADMIN → `POST /stores/:id/review` → 200 (success)

#### Pagination test

1. Create and submit 25 stores from 25 different user accounts
2. Log in as admin
3. `GET /stores/admin/pending?page=1&limit=10` → verify 10 stores, meta shows total: 25, totalPages: 3
4. `GET /stores/admin/pending?page=2&limit=10` → verify 10 different stores, page: 2
5. `GET /stores/admin/pending?page=3&limit=10` → verify 5 stores, page: 3
6. Approve 5 stores
7. `GET /stores/admin/pending?page=1&limit=10` → verify total is now 20

### Manual Checks

**Setup:**
- Create 3 store applications from 3 different user accounts
- Fill in all required details for each and submit all 3

**Admin pending queue:**
- Log in as an admin user
- Hit `GET /stores/admin/pending` — verify all 3 appear
- Verify they're sorted by creation date (oldest first)
- Verify each store includes the owner's name and email
- Verify no sensitive data is exposed (passwordHash, tokens)

**Approval:**
- Approve the first store via `POST /stores/:id/review` with `{ "decision": "APPROVE" }`
- Check the database directly:
  ```sql
  SELECT status, "rejectionReason" FROM stores WHERE id = '<store-id>';
  -- Expected: status = 'APPROVED', rejectionReason = null
  
  SELECT role FROM users WHERE id = '<owner-id>';
  -- Expected: role = 'MERCHANT'
  ```
- Check that the approval email was received (if using real Resend)
- Log in as the approved merchant → verify `/auth/me` shows `role: 'MERCHANT'` and `store.status: 'APPROVED'`
- Verify the pending queue now shows 2 stores (the approved one is gone)
- Try accessing the public store profile `GET /stores/:slug` as a different user → confirm 404 (store is APPROVED but not yet ACTIVE)

**Rejection:**
- Reject the second store with a detailed reason
- Check the database:
  ```sql
  SELECT status, "rejectionReason" FROM stores WHERE id = '<store-id>';
  -- Expected: status = 'DRAFT', rejectionReason = '<the reason you provided>'
  
  SELECT role FROM users WHERE id = '<owner-id>';
  -- Expected: role = 'BUYER' (unchanged)
  ```
- Check that the rejection email was received with the reason included
- Log in as the rejected user → verify `/auth/me` shows `store.status: 'DRAFT'` and the rejection reason

**Resubmission after rejection:**
- Log in as the rejected user
- Edit the store via `PATCH /stores/:id` → verify `rejectionReason` is cleared
- Resubmit via `POST /stores/:id/submit`
- Log in as admin → verify the store reappears in the pending queue
- Approve it this time → verify the full MERCHANT upgrade and APPROVED status

**Authorization:**
- Try accessing `GET /stores/admin/pending` as a BUYER → confirm 403
- Try accessing it as a MERCHANT → confirm 403
- Try calling `POST /stores/:id/review` as a BUYER → confirm 403
- Only ADMIN users should get 200

**Edge case — reviewing a non-pending store:**
- Try approving a DRAFT store (hasn't been submitted) → confirm 400
- Try approving an already APPROVED store → confirm 400
- Try approving an ACTIVE store → confirm 400
- Try rejecting a DRAFT store → confirm 400

---

## API Endpoints Summary (Steps 5–6)

| Method | Path | Auth | Role | Description | Request Body |
|--------|------|------|------|-------------|--------------|
| GET | `/stores/admin/pending` | Required | ADMIN | List stores awaiting review (paginated) | None (query params: page, limit, sortOrder) |
| POST | `/stores/:id/review` | Required | ADMIN | Approve or reject a pending store | `{ decision: 'APPROVE' \| 'REJECT', reason?: string }` |
