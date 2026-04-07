# YIIVA — Store Module: Go-Live Flow (Steps 6a–6c)

> Technical reference for the second review gate — the go-live flow that takes a store from APPROVED to ACTIVE and visible to buyers.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Context](#context)
- [The Two-Gate Review System](#the-two-gate-review-system)
- [Step 6a — Merchant: Request Go-Live](#step-6a--merchant-request-go-live)
  - [What This Step Accomplishes](#what-step-6a-accomplishes)
  - [Endpoint](#endpoint)
  - [Required Fields & Conditions](#required-fields--conditions)
  - [Service Logic: requestGoLive()](#service-logic-requestgolive)
  - [Controller](#controller)
  - [Error Cases](#step-6a-error-cases)
  - [Resubmission After Go-Live Rejection](#resubmission-after-go-live-rejection)
- [Step 6b — Admin: List Pending Go-Lives](#step-6b--admin-list-pending-go-lives)
  - [What This Step Accomplishes](#what-step-6b-accomplishes)
  - [Endpoint](#endpoint-1)
  - [Service Logic: listPendingGoLive()](#service-logic-listpendinggolive)
  - [Controller](#controller-1)
  - [Error Cases](#step-6b-error-cases)
- [Step 6c — Admin: Review Go-Live](#step-6c--admin-review-go-live)
  - [What This Step Accomplishes](#what-step-6c-accomplishes)
  - [Endpoint](#endpoint-2)
  - [DTO: review-go-live.dto.ts](#dto-review-go-livedtots)
  - [Service Logic: reviewGoLive()](#service-logic-reviewgolive)
    - [Approval Flow](#approval-flow)
    - [Rejection Flow](#rejection-flow-1)
  - [Controller](#controller-2)
  - [Error Cases](#step-6c-error-cases)
  - [What Happens After Go-Live Approval](#what-happens-after-go-live-approval)
  - [What Happens After Go-Live Rejection](#what-happens-after-go-live-rejection)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Manual Checks](#manual-checks)
- [API Endpoints Summary (Steps 6a–6c)](#api-endpoints-summary-steps-6a6c)

---

## Context

Steps 6a, 6b, and 6c form the second review gate in the Store module. After a store has been approved by an admin (Step 6) and the merchant has had time to add products, upload a banner, write their brand story, and add at least one physical address, they can request to go live. An admin reviews this request and either approves it (making the store ACTIVE and visible to buyers) or rejects it (sending it back to APPROVED with feedback).

This two-gate system was designed because curation quality and merchant readiness are different concerns:

- **First gate (Step 6)** — verifies the brand is legitimate. Real company, real bank details, real contact info. The admin is asking "is this a real business we want on the platform?"
- **Second gate (Steps 6a–6c)** — verifies the store is ready to be seen by buyers. Has products to sell, has visual content, has location info. The admin is asking "is this store ready to launch?"

Without the second gate, an approved merchant could go live with an empty store containing zero products, no banner, no story — creating a poor experience for buyers and damaging the platform's reputation as a curated marketplace.

---

## The Two-Gate Review System

Here's the full state machine for the Store module:

```
DRAFT
  ↓ submit (1st review request)
PENDING_REVIEW
  ↓ admin approves (legitimacy verified, role upgraded to MERCHANT)
APPROVED
  ↓ merchant requests go-live (2nd review request)
PENDING_GO_LIVE
  ↓ admin approves go-live (readiness verified, store visible to buyers)
ACTIVE
```

**Rejection paths:**
- Rejection from PENDING_REVIEW → back to DRAFT (with rejection reason)
- Rejection from PENDING_GO_LIVE → back to APPROVED (with rejection reason)

**Other status transitions** (handled in future work):
- ACTIVE → SUSPENDED (by admin, for policy violations)
- ACTIVE/APPROVED → CLOSED (by merchant or admin)
- SUSPENDED → ACTIVE (by admin, after issue resolved)

---

## Step 6a — Merchant: Request Go-Live

### What Step 6a Accomplishes

The merchant has been approved (Step 6) and has spent time setting up their store — adding products, uploading a banner, writing their brand story, adding their physical location. They're now ready to launch and want their store to appear in the buyer feed. This endpoint validates that all the launch criteria are met and moves the store from `APPROVED` to `PENDING_GO_LIVE`, putting it in the admin's go-live review queue.

This is a deliberate action triggered by the merchant — not an automatic transition. Even if the criteria are met, the store doesn't automatically go to PENDING_GO_LIVE. The merchant must explicitly request it. This gives them control over when their store enters the review queue (e.g. they might want to wait until they have more products, or coordinate the launch with a marketing push).

---

### Endpoint

```
POST /stores/:id/request-go-live
```

**Role:** MERCHANT (store owner only). The store must be in `APPROVED` status.

This endpoint accepts no request body. The store already has all its data — this is just a status transition triggered by a POST.

---

### Required Fields & Conditions

Before a store can request go-live, ALL of the following must be true. The service checks each one and returns a clear error listing every missing requirement, not just the first one.

#### Store Field Requirements

The store must have all 11 first-submission fields populated AND the additional go-live fields:

**From the 11 first-submission fields (must still be present — merchant might have edited and removed something):**

1. `companyName`
2. `displayName`
3. `description`
4. `logoUrl`
5. `contactEmail`
6. `contactPhone`
7. `businessRegNo`
8. `bankName`
9. `bankAccountNo`
10. `bankBranchCode`
11. `bankAccountType`

**Additional fields required for go-live:**

12. `bannerUrl` — the wide hero image displayed at the top of the store's public profile. Required at this stage because an empty banner would make the store look unfinished.
13. `story` — the brand narrative. Required at this stage because YIIVA is built around storytelling and brand discovery. A store without a story doesn't fit the platform's positioning.

#### Relation Requirements

14. **At least one `StoreAddress` record** — the store must have at least one physical location tag. Even if the brand operates exclusively online, they need to declare a city for discovery purposes (e.g. "brands in Johannesburg"). The address record provides this.

15. **At least 7 active products in the Products table** — the store must have at least 7 products with `status: 'ACTIVE'`. Products in `DRAFT`, `OUT_OF_STOCK`, or `ARCHIVED` status do not count. This prevents merchants from padding their inventory with placeholder drafts to satisfy the requirement.

#### Fields That Stay Optional Through Go-Live

These fields are nice to have but do NOT block go-live:

- **`vatNumber`** — VAT registration is only mandatory in SA for businesses with annual turnover above R1 million. Many small/early-stage SA brands aren't VAT-registered. Requiring it would block legitimate small brands from launching.
- **`websiteUrl`** — many SA creators sell exclusively through YIIVA and Instagram and don't have a separate website. Stays optional to avoid forcing brands to build a website just to satisfy a checklist.

#### The Total Checklist

To go live, a store needs:
- **13 required Store fields** (the 11 from submission + bannerUrl + story)
- **At least 1 StoreAddress record**
- **At least 7 active products**

That's a substantial bar — significantly higher than just submitting for the first review. This is intentional. The first review is fast and lightweight (admin verifies legitimacy, ~5 minutes per store). The second review is more thorough because the store is about to be seen by every buyer on the platform.

---

### Service Logic: requestGoLive()

The `requestGoLive` method in `StoreService` receives the authenticated user's ID and the store ID from the URL parameter. It performs the following operations in order:

**1. Find the store with relations.**

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  include: {
    addresses: true,
    _count: {
      select: {
        products: {
          where: { status: 'ACTIVE' }
        }
      }
    }
  }
});
```

We include `addresses` to count them and `_count.products` (filtered to active only) to get the active product count without loading all product records into memory.

If the store is not found, throw `NotFoundException` with "Store not found."

**2. Verify ownership.**

```typescript
if (store.ownerId !== userId) {
  throw new ForbiddenException('You do not have permission to request go-live for this store');
}
```

Only the store owner can request go-live. Employees (once that feature is built) cannot trigger this — it's a major decision point that should be the owner's call.

**3. Verify the store is in APPROVED status.**

```typescript
if (store.status !== 'APPROVED') {
  let message: string;
  switch (store.status) {
    case 'DRAFT':
      message = 'Your store must be approved before requesting to go live. Please submit it for review first.';
      break;
    case 'PENDING_REVIEW':
      message = 'Your store is currently under initial review. Please wait for the review to complete.';
      break;
    case 'PENDING_GO_LIVE':
      message = 'Your store is already in the go-live review queue.';
      break;
    case 'ACTIVE':
      message = 'Your store is already live.';
      break;
    case 'SUSPENDED':
      message = 'Your store is currently suspended and cannot request to go live.';
      break;
    case 'CLOSED':
      message = 'Your store is closed and cannot request to go live.';
      break;
  }
  throw new BadRequestException(message);
}
```

The error messages are status-specific and actionable. The merchant should always understand why the request was rejected and what they need to do next.

**4. Validate all required fields and conditions.**

Collect all missing requirements into an array:

```typescript
const missingRequirements: string[] = [];

// 11 first-submission fields
if (!store.description) missingRequirements.push('description');
if (!store.logoUrl) missingRequirements.push('logoUrl');
if (!store.contactEmail) missingRequirements.push('contactEmail');
if (!store.contactPhone) missingRequirements.push('contactPhone');
if (!store.businessRegNo) missingRequirements.push('businessRegNo');
if (!store.bankName) missingRequirements.push('bankName');
if (!store.bankAccountNo) missingRequirements.push('bankAccountNo');
if (!store.bankBranchCode) missingRequirements.push('bankBranchCode');
if (!store.bankAccountType) missingRequirements.push('bankAccountType');

// Additional go-live fields
if (!store.bannerUrl) missingRequirements.push('bannerUrl');
if (!store.story) missingRequirements.push('story');

// Relations
if (store.addresses.length === 0) {
  missingRequirements.push('at least one store address');
}

if (store._count.products < 7) {
  missingRequirements.push(
    `at least 7 active products (currently has ${store._count.products})`
  );
}

if (missingRequirements.length > 0) {
  throw new BadRequestException(
    `Cannot request go-live. Missing requirements: ${missingRequirements.join(', ')}`
  );
}
```

The error message lists every missing requirement so the merchant can fix everything in one pass rather than discovering issues one at a time.

The active product count check uses the related count from the include — `store._count.products` reflects only active products because we filtered the count in the include clause.

**5. Update the store status.**

```typescript
await this.prisma.store.update({
  where: { id: storeId },
  data: {
    status: 'PENDING_GO_LIVE',
    rejectionReason: null,
  },
});
```

The `rejectionReason` is cleared in case this is a resubmission after a previous go-live rejection. The merchant has addressed the feedback, the next review starts fresh.

No role change happens here. The merchant is already a MERCHANT (from the first approval). This is purely a status transition.

**6. Notify admins (deferred).**

Same pattern as the first submission — when the Notification module is built, this is where it would call `notificationService.notifyAdmins('NEW_GO_LIVE_REQUEST', { storeId, storeName })`. For the initial build, admins check the queue manually via Step 6b.

**7. Return the updated store.**

Return the full store object with the updated status. The frontend uses this to navigate the merchant to a "your store is in final review" screen.

---

### Controller

```typescript
@Post(':id/request-go-live')
@Roles(UserRole.MERCHANT)
requestGoLive(@CurrentUser() user, @Param('id') storeId: string) {
  return this.storeService.requestGoLive(user.id, storeId);
}
```

The `@Roles(UserRole.MERCHANT)` ensures only users with the MERCHANT role can call this endpoint. The service additionally verifies the user is the store owner.

---

### Step 6a Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Not the store owner | 403 Forbidden | "You do not have permission to request go-live for this store" |
| Store in DRAFT status | 400 Bad Request | "Your store must be approved before requesting to go live. Please submit it for review first." |
| Store in PENDING_REVIEW status | 400 Bad Request | "Your store is currently under initial review. Please wait for the review to complete." |
| Store in PENDING_GO_LIVE status | 400 Bad Request | "Your store is already in the go-live review queue." |
| Store in ACTIVE status | 400 Bad Request | "Your store is already live." |
| Store in SUSPENDED status | 400 Bad Request | "Your store is currently suspended and cannot request to go live." |
| Store in CLOSED status | 400 Bad Request | "Your store is closed and cannot request to go live." |
| Missing required fields/relations | 400 Bad Request | "Cannot request go-live. Missing requirements: [list]" |
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Authenticated but not MERCHANT | 403 Forbidden | "Forbidden resource" |

---

### Resubmission After Go-Live Rejection

If an admin rejects the go-live request (Step 6c), the store returns to `APPROVED` status with a `rejectionReason`. The merchant's resubmission flow uses the same endpoints:

1. Merchant sees the rejection reason on their dashboard (the `rejectionReason` field on their store)
2. Merchant edits their store via `PATCH /stores/:id` (Step 3) to address the feedback
3. The edit clears the `rejectionReason` automatically
4. Merchant requests go-live again via this endpoint
5. Status moves from APPROVED → PENDING_GO_LIVE
6. `rejectionReason` is cleared again in the request-go-live logic (belt and suspenders)
7. Admin reviews again

This is parallel to the first review's resubmission flow — same pattern, different gate.

---

## Step 6b — Admin: List Pending Go-Lives

### What Step 6b Accomplishes

Admins need a separate queue for stores awaiting the second review. This is the admin's go-live work queue — they open the admin panel, see a list of stores in `PENDING_GO_LIVE` status, and pick one to review for launch readiness. This is structurally identical to Step 5 (the first-review queue), just with a different status filter.

---

### Endpoint

```
GET /stores/admin/pending-go-live
```

**Role:** ADMIN only.

---

### Service Logic: listPendingGoLive()

The implementation mirrors Step 5's `listPending()` exactly, with two differences:

1. **Status filter** — `PENDING_GO_LIVE` instead of `PENDING_REVIEW`
2. **Includes more relations** — for go-live review, the admin needs to see the products and addresses to verify the store is launch-ready

**1. Fetch the paginated stores.**

```typescript
const stores = await this.prisma.store.findMany({
  where: { status: 'PENDING_GO_LIVE' },
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
    },
    addresses: true,
    _count: {
      select: {
        products: {
          where: { status: 'ACTIVE' }
        }
      }
    }
  }
});
```

Including `addresses` and the active product count gives the admin the data they need to validate launch readiness without making additional queries.

**2. Get the total count.**

```typescript
const total = await this.prisma.store.count({
  where: { status: 'PENDING_GO_LIVE' }
});
```

**3. Both queries in a single transaction for efficiency.**

**4. Return the paginated response.**

Same shape as Step 5, but each store object now includes the `addresses` array and `_count.products`:

```json
{
  "data": [
    {
      "id": "clx1abc123",
      "companyName": "Khanyi Creative Ventures (Pty) Ltd",
      "displayName": "BOLD Streetwear",
      "slug": "bold-streetwear",
      "description": "Premium streetwear...",
      "story": "We started in a garage in Soweto in 2019...",
      "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
      "bannerUrl": "https://cdn.yiiva.co.za/stores/bold/banner.jpg",
      "websiteUrl": "https://boldstreetwear.co.za",
      "contactEmail": "hello@boldstreetwear.co.za",
      "contactPhone": "+27 63 448 9940",
      "businessRegNo": "2024/123456/07",
      "vatNumber": "4123456789",
      "bankName": "FNB",
      "bankAccountNo": "62812345678",
      "bankBranchCode": "250655",
      "bankAccountType": "Cheque",
      "status": "PENDING_GO_LIVE",
      "createdAt": "2025-03-15T10:30:00.000Z",
      "updatedAt": "2025-03-25T14:22:00.000Z",
      "owner": {
        "id": "clx1user456",
        "email": "khanyi@gmail.com",
        "firstName": "Khanyi",
        "lastName": "Mthamo",
        "phone": "+27 63 448 9940"
      },
      "addresses": [
        {
          "id": "clx1addr789",
          "streetNumber": "42",
          "streetName": "Bree Street",
          "buildingName": "The Foundry",
          "city": "Johannesburg",
          "postalCode": "2001"
        }
      ],
      "_count": {
        "products": 12
      }
    }
  ],
  "meta": {
    "total": 8,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

The admin can see at a glance: 12 active products, 1 location in Johannesburg, all the required fields populated.

---

### Controller

```typescript
@Get('admin/pending-go-live')
@Roles(UserRole.ADMIN)
listPendingGoLive(@Query() query: ListPendingStoresDto) {
  return this.storeService.listPendingGoLive(query);
}
```

We can reuse the `ListPendingStoresDto` from Step 5 — the query parameters (page, limit, sortOrder) are identical.

**Route ordering reminder:** This route is `GET /stores/admin/pending-go-live`. Like `admin/pending`, it must be declared before any `/:slug` or `/:id` routes in the controller to avoid being swallowed by parameter matching.

---

### Step 6b Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Not an admin | 403 Forbidden | "Forbidden resource" |
| Invalid pagination parameters | 400 Bad Request | Validation error |
| No pending go-live requests | 200 OK | Returns empty data array, not an error |

---

## Step 6c — Admin: Review Go-Live

### What Step 6c Accomplishes

The admin reviews the go-live request and decides whether the store is ready to be visible to buyers. Approval moves the store from `PENDING_GO_LIVE` to `ACTIVE`, making it discoverable on the mobile app. Rejection sends the store back to `APPROVED` with feedback explaining what needs to be improved.

This is the second and final review gate. Once approved, the store is live — buyers can find it, follow it, browse its products, and place orders.

---

### Endpoint

```
POST /stores/:id/review-go-live
```

**Role:** ADMIN only.

---

### DTO: review-go-live.dto.ts

The DTO is identical to `review-store.dto.ts` from Step 6 — same shape, same validation rules. We could reuse the same DTO class, but having a separate one makes the intent explicit and allows future divergence if go-live reviews need different fields (e.g. a launch date).

**`decision`**
- Type: enum
- Validation: required, must be `APPROVE` or `REJECT`

```typescript
enum GoLiveDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}
```

**`reason`**
- Type: string
- Validation: required if decision is REJECT (minimum 10 characters), optional if decision is APPROVE

---

### Service Logic: reviewGoLive()

The `reviewGoLive` method receives the admin's user ID, the store ID, and the validated DTO. It branches based on `dto.decision`.

#### Approval Flow

**1. Find the store.**

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  include: { owner: true },
});
```

Include the owner for the notification email. If not found, throw `NotFoundException`.

**2. Verify the store is in PENDING_GO_LIVE status.**

```typescript
if (store.status !== 'PENDING_GO_LIVE') {
  throw new BadRequestException(
    'Only stores in PENDING_GO_LIVE status can be reviewed for go-live'
  );
}
```

**3. Update the store status.**

This is a simpler update than the first review — no role change happens here because the merchant is already a MERCHANT. Only the store status changes:

```typescript
await this.prisma.store.update({
  where: { id: storeId },
  data: {
    status: 'ACTIVE',
    rejectionReason: null,
  },
});
```

No transaction is strictly required because there's only one update operation. But you could still wrap it in a transaction if you want atomic semantics with the notification or any future side effects.

**4. Send a notification to the owner.**

```typescript
await this.emailService.sendStoreLiveEmail(
  store.owner.email,
  store.owner.firstName,
  store.displayName,
  store.slug,
);
```

This is a celebratory email — the merchant has been working toward this moment. The email content:
- Subject: "🎉 Your store is now live on YIIVA!"
- Body: addresses the owner by first name, congratulates them, mentions the store display name, provides the public store URL (e.g. `yiiva.co.za/store/bold-streetwear`), suggests next steps (share on social media, monitor orders, respond to reviews)

If the email fails, the approval still stands. The merchant will discover their store is live on next login.

**5. Return the updated store.**

```typescript
return this.prisma.store.findUnique({
  where: { id: storeId },
  include: {
    owner: { select: { id: true, email: true, firstName: true, lastName: true, role: true } }
  }
});
```

#### Rejection Flow

**1. Find the store** — same as approval.

**2. Verify the store is in PENDING_GO_LIVE status** — same check as approval.

**3. Validate that a reason was provided.**

```typescript
if (!dto.reason || dto.reason.trim().length < 10) {
  throw new BadRequestException(
    'A rejection reason is required and must be at least 10 characters'
  );
}
```

**4. Update the store.**

```typescript
await this.prisma.store.update({
  where: { id: storeId },
  data: {
    status: 'APPROVED',
    rejectionReason: dto.reason,
  },
});
```

The store goes back to `APPROVED` (not DRAFT). This is the key difference from the first review's rejection. The merchant doesn't lose their approved status — they retain dashboard access, MERCHANT role, and the ability to manage products. They just need to address the go-live feedback before requesting again.

The owner stays a MERCHANT. There's no role change on rejection at this stage.

**5. Send a notification to the owner.**

```typescript
await this.emailService.sendGoLiveRejectionEmail(
  store.owner.email,
  store.owner.firstName,
  store.displayName,
  dto.reason,
);
```

The email content:
- Subject: "Your store needs a few more touches before going live"
- Body: addresses the owner by first name, explains that the launch is on hold pending some improvements, includes the full rejection reason, encourages them to make the changes and request again
- Tone: constructive and forward-looking. The merchant is already approved and trusted on the platform — this is just about polishing for launch.

**6. Return the updated store.**

---

### Controller

```typescript
@Post(':id/review-go-live')
@Roles(UserRole.ADMIN)
reviewGoLive(
  @CurrentUser() admin,
  @Param('id') storeId: string,
  @Body() dto: ReviewGoLiveDto,
) {
  return this.storeService.reviewGoLive(admin.id, storeId, dto);
}
```

---

### Step 6c Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Store not in PENDING_GO_LIVE (DRAFT) | 400 Bad Request | "Only stores in PENDING_GO_LIVE status can be reviewed for go-live" |
| Store not in PENDING_GO_LIVE (PENDING_REVIEW) | 400 Bad Request | "Only stores in PENDING_GO_LIVE status can be reviewed for go-live" |
| Store not in PENDING_GO_LIVE (APPROVED) | 400 Bad Request | "Only stores in PENDING_GO_LIVE status can be reviewed for go-live" |
| Store not in PENDING_GO_LIVE (ACTIVE) | 400 Bad Request | "Only stores in PENDING_GO_LIVE status can be reviewed for go-live" |
| Store not in PENDING_GO_LIVE (SUSPENDED) | 400 Bad Request | "Only stores in PENDING_GO_LIVE status can be reviewed for go-live" |
| Decision is REJECT but no reason provided | 400 Bad Request | "A rejection reason is required and must be at least 10 characters" |
| Decision is REJECT but reason too short | 400 Bad Request | Same as above |
| Invalid decision value | 400 Bad Request | Validation error |
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Not an admin | 403 Forbidden | "Forbidden resource" |

---

### What Happens After Go-Live Approval

The moment the store status updates, several things become true:

**For the store owner:**
- Their store `status` is now `ACTIVE`
- Their next `GET /auth/me` response will include `store: { status: 'ACTIVE', ... }`
- They receive a celebratory email with the public store URL
- They can share their store URL on social media, marketing materials, etc.
- Their `role` is unchanged (still MERCHANT) — no role transition happens here

**For buyers:**
- The store is now visible. `GET /stores/:slug` returns 200 with the public profile.
- The store appears in browse, search, and discovery (when those features are built)
- Buyers can follow the store (Step 9)
- Buyers can browse the store's products (when the Product module is built)
- Buyers can place orders from the store (when the Order module is built)

**For the admin:**
- The store disappears from the go-live pending queue (Step 6b's endpoint no longer returns it)
- The store appears in the active stores list (a future admin endpoint, not built yet)

This is the moment the store truly launches on YIIVA. Everything before this was preparation.

---

### What Happens After Go-Live Rejection

**For the store owner:**
- Their store `status` is back to `APPROVED`
- `store.rejectionReason` contains the admin's feedback
- Their `role` stays `MERCHANT`
- They retain dashboard access and can continue managing products and store details
- They receive an email with the rejection reason and guidance
- On their next visit, the frontend shows the rejection reason prominently with a "Fix issues and request go-live again" prompt
- They can edit (Step 3) and request go-live again (Step 6a)

**For buyers:**
- Nothing changes. The store was never visible before, and it's still not visible now.

**For the admin:**
- The store disappears from the go-live pending queue
- The store will reappear in the queue if/when the merchant requests go-live again

The rejection doesn't downgrade the merchant or affect their dashboard access in any way. It's purely a "not yet" — the store needs more polish before it can launch.

---

## Testing

### Unit Tests

#### Step 6a (Request Go-Live)

**Successful request with all requirements met:**
Mock a store in APPROVED status with all 13 required fields, at least 1 address, and 7+ active products. Verify the status updates to PENDING_GO_LIVE and rejectionReason is cleared.

**Store not in APPROVED status:**
Test with each status:
- DRAFT → BadRequestException with status-specific message
- PENDING_REVIEW → BadRequestException
- PENDING_GO_LIVE → BadRequestException ("already in queue")
- ACTIVE → BadRequestException ("already live")
- SUSPENDED → BadRequestException
- CLOSED → BadRequestException

**Not the owner:**
Mock a store owned by a different user. Verify ForbiddenException.

**Missing required field — bannerUrl:**
Mock store without bannerUrl. Verify BadRequestException listing 'bannerUrl' in missing requirements.

**Missing required field — story:**
Mock store without story. Verify BadRequestException listing 'story'.

**Missing required field — businessRegNo:**
Mock store without businessRegNo. Verify the field appears in the missing list.

**Missing multiple required fields:**
Mock store missing bannerUrl, story, and contactPhone. Verify BadRequestException lists ALL three (not just the first).

**No store addresses:**
Mock store with `addresses: []`. Verify BadRequestException with "at least one store address" in the missing list.

**Insufficient active products — 0 products:**
Mock store with `_count.products: 0`. Verify error message includes "at least 7 active products (currently has 0)".

**Insufficient active products — 6 products:**
Mock store with `_count.products: 6`. Verify error message includes "currently has 6".

**Exactly 7 active products:**
Mock store with `_count.products: 7` and all other requirements met. Verify request succeeds.

**Active product count excludes drafts:**
This is more of an integration test, but the unit test verifies the service uses the correct query — `_count.products` filtered to `status: 'ACTIVE'`.

**Resubmission after rejection:**
Mock store in APPROVED with `rejectionReason` set (from a previous go-live rejection). Verify successful request clears the rejectionReason.

**Notifications:**
For now (until Notification module is built), no notification assertions. When implemented, verify admin notification is triggered.

#### Step 6b (List Pending Go-Lives)

**Returns only PENDING_GO_LIVE stores:**
Mock stores in various statuses. Verify only PENDING_GO_LIVE stores are returned.

**Includes addresses and product count:**
Mock a store in PENDING_GO_LIVE. Verify the response includes `addresses` array and `_count.products`.

**Pagination works identically to Step 5:**
Mock 25 PENDING_GO_LIVE stores. Test page navigation, limits, sorting.

**Empty queue:**
Mock no stores in PENDING_GO_LIVE. Verify empty data array, total: 0.

**Authorization:**
- BUYER → 403
- MERCHANT → 403
- ADMIN → success

#### Step 6c (Review Go-Live — Approval)

**Successful approval:**
Mock a store in PENDING_GO_LIVE. Call `reviewGoLive()` with `decision: 'APPROVE'`. Verify:
- Store status is set to ACTIVE
- rejectionReason is set to null
- Owner role is unchanged (still MERCHANT)
- Email notification method is called

**Store not in PENDING_GO_LIVE:**
Test with each non-PENDING_GO_LIVE status. Verify the same error message for all.

**Email failure doesn't roll back:**
Mock the email service throwing. Verify the store status update committed and the error is logged.

#### Step 6c (Review Go-Live — Rejection)

**Successful rejection:**
Mock store in PENDING_GO_LIVE. Call with `decision: 'REJECT', reason: 'Banner image quality is low. Please upload a higher resolution banner.'`. Verify:
- Store status is set back to APPROVED (NOT DRAFT)
- rejectionReason is set to the provided reason
- Owner role stays MERCHANT (no role change)

**Reason validation:**
- No reason → BadRequestException
- Reason too short (< 10 chars) → BadRequestException
- Reason exactly 10 chars → succeeds

**Owner role unchanged:**
Verify `prisma.user.update` is NOT called during rejection. The merchant retains MERCHANT role.

#### Step 6c (Authorization)

- BUYER → 403
- MERCHANT → 403
- ADMIN → success

### Integration Tests

#### Full go-live flow

This is the most important integration test for the go-live feature. It validates the complete journey from approved store to live store:

1. Register user A → verify email → confirm role is BUYER
2. Create store, fill all 11 first-submission fields, submit for review
3. Register admin → log in
4. Admin approves first review → confirm user A is now MERCHANT, store is APPROVED
5. As user A, add a banner: `PATCH /stores/:id` with `bannerUrl`
6. Add a story: `PATCH /stores/:id` with `story`
7. Add an address: `POST /stores/:id/addresses` (Step 11 endpoint, when built) — for now, manually insert a StoreAddress in the database
8. Add 7 active products to the Products table — for now, manually insert in the database (when Product module is built, use the actual endpoint)
9. `POST /stores/:id/request-go-live` as user A → 200, status is PENDING_GO_LIVE
10. Try to access the store publicly → confirm 404 (still not visible to buyers)
11. `GET /stores/admin/pending-go-live` as admin → verify store appears in queue with addresses and product count
12. `POST /stores/:id/review-go-live` as admin with `{ decision: 'APPROVE' }` → 200
13. `GET /auth/me` as user A → confirm role is MERCHANT, store.status is ACTIVE
14. `GET /stores/:slug` as a different user → 200 with public profile (now visible!)
15. Verify the celebratory email was sent

#### Validation flow — request go-live with missing requirements

1. Register user → create store → submit → admin approves → store is APPROVED
2. Without adding a banner, story, address, or products, attempt `POST /stores/:id/request-go-live`
3. Verify 400 with error message listing all missing requirements:
   - bannerUrl, story, at least one store address, at least 7 active products (currently has 0)
4. Add a banner → request go-live again → verify error message no longer mentions bannerUrl
5. Add a story → request again → verify smaller error list
6. Add an address → request again → verify smaller list
7. Add 1 product → request again → verify error mentions "currently has 1"
8. Add 6 more products → request → verify success (status: PENDING_GO_LIVE)

#### Go-live rejection and resubmission

1. Complete the full setup → request go-live → status is PENDING_GO_LIVE
2. Admin rejects with reason: "Banner quality is too low. Please upload a banner with minimum resolution 1500x500 pixels."
3. Verify response shows store status APPROVED (not DRAFT) and rejectionReason present
4. `GET /auth/me` as merchant → verify:
   - role is still MERCHANT
   - store.status is APPROVED
   - store.rejectionReason matches the admin's feedback
5. `PATCH /stores/:id` with new bannerUrl → verify rejectionReason is cleared
6. `POST /stores/:id/request-go-live` again → status PENDING_GO_LIVE
7. Admin approves → status ACTIVE

#### Authorization

1. BUYER tries `POST /stores/:id/request-go-live` → 403
2. MERCHANT (not the owner) tries → 403
3. MERCHANT (the owner) → succeeds (if all conditions met)
4. BUYER tries `GET /stores/admin/pending-go-live` → 403
5. MERCHANT tries → 403
6. ADMIN → success
7. BUYER tries `POST /stores/:id/review-go-live` → 403
8. MERCHANT tries → 403
9. ADMIN → success

### Manual Checks

**Setup:**
- Create a store, fill the 11 first-submission fields, submit, approve via admin
- Manually verify in DB: store status is APPROVED, owner role is MERCHANT

**Test go-live request validation:**
- Try `POST /stores/:id/request-go-live` immediately → confirm 400 listing missing fields (banner, story, address, products)
- Add banner via PATCH → request again → confirm error list shrinks
- Repeat until all conditions are met
- Final request → confirm 200 and status PENDING_GO_LIVE

**Test admin go-live queue:**
- Log in as admin
- `GET /stores/admin/pending-go-live` → confirm the store appears with addresses and product count visible
- Inspect the response — verify all the data the admin needs is present

**Test go-live approval:**
- `POST /stores/:id/review-go-live` with `{ "decision": "APPROVE" }`
- Check database: status should now be ACTIVE
- Try `GET /stores/:slug` as a different user → confirm 200 (the store is finally visible)
- Check the merchant received the celebratory email

**Test go-live rejection:**
- Set up another store ready for go-live, request go-live
- Reject with `{ "decision": "REJECT", "reason": "Product photography needs to be more consistent. Please use a single background color across all products." }`
- Check database: status is APPROVED (not DRAFT), rejectionReason is set
- Check the merchant received the rejection email
- Log in as the merchant → verify dashboard still accessible, role still MERCHANT
- Verify the rejection feedback is displayed prominently
- Edit the store → verify rejectionReason is cleared
- Request go-live again → admin approves → store goes ACTIVE

**Edge cases:**
- Try requesting go-live with a store that has 7 DRAFT products → confirm error (drafts don't count)
- Try requesting go-live with 6 active + 5 draft products → confirm error mentions "currently has 6"
- Try requesting go-live as an employee (when StoreEmployee feature is built) → confirm 403 (only owner can)
- Try reviewing go-live as a non-admin → confirm 403

---

## API Endpoints Summary (Steps 6a–6c)

| Method | Path | Auth | Role | Description | Request Body |
|--------|------|------|------|-------------|--------------|
| POST | `/stores/:id/request-go-live` | Required | MERCHANT (owner) | Request second review for go-live | None |
| GET | `/stores/admin/pending-go-live` | Required | ADMIN | List stores awaiting go-live review (paginated) | None (query: page, limit, sortOrder) |
| POST | `/stores/:id/review-go-live` | Required | ADMIN | Approve or reject a go-live request | `{ decision: 'APPROVE' \| 'REJECT', reason?: string }` |
