# YIIVA — Store Module: Store Views & Auth Integration (Steps 7–10)

> Technical reference for store viewing endpoints (owner and public), the follow/unfollow feature, and the `/auth/me` integration that enables frontend routing.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Context](#context)
- [Step 7 — Get My Store](#step-7--get-my-store)
  - [What This Step Accomplishes](#what-step-7-accomplishes)
  - [Endpoint](#endpoint)
  - [Why /stores/me Instead of /stores/:id](#why-storesme-instead-of-storesid)
  - [Service Logic: getMyStore()](#service-logic-getmystore)
  - [Response Shape](#response-shape)
  - [Controller](#controller)
  - [Route Ordering Critical Note](#route-ordering-critical-note)
  - [Error Cases](#step-7-error-cases)
  - [What the Frontend Does With This](#what-the-frontend-does-with-this)
- [Step 8 — Get Store Public Profile](#step-8--get-store-public-profile)
  - [What This Step Accomplishes](#what-step-8-accomplishes)
  - [Endpoint](#endpoint-1)
  - [Why Slug Instead of ID](#why-slug-instead-of-id)
  - [Service Logic: getPublicStore()](#service-logic-getpublicstore)
  - [Public vs Private Field Separation](#public-vs-private-field-separation)
  - [Response Shape](#response-shape-1)
  - [Controller](#controller-1)
  - [Error Cases](#step-8-error-cases)
- [Step 9 — Follow / Unfollow Store](#step-9--follow--unfollow-store)
  - [What This Step Accomplishes](#what-step-9-accomplishes)
  - [Endpoints](#endpoints)
  - [Service Logic: followStore()](#service-logic-followstore)
  - [Service Logic: unfollowStore()](#service-logic-unfollowstore)
  - [Controller](#controller-2)
  - [Error Cases](#step-9-error-cases)
  - [Edge Cases](#edge-cases)
- [Step 10 — Update /auth/me to Include Store Data](#step-10--update-authme-to-include-store-data)
  - [What This Step Accomplishes](#what-step-10-accomplishes)
  - [What Changes](#what-changes)
  - [Updated Response Shape](#updated-response-shape)
  - [How the Frontend Uses This](#how-the-frontend-uses-this)
  - [Why rejectionReason Is Included](#why-rejectionreason-is-included)
  - [Fields Deliberately Excluded](#fields-deliberately-excluded)
  - [Implementation Note](#implementation-note)
  - [Error Cases](#step-10-error-cases)
- [Testing](#testing)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Manual Checks](#manual-checks)
- [API Endpoints Summary (Steps 7–10)](#api-endpoints-summary-steps-710)

---

## Context

Steps 7 through 10 are about visibility and integration. Up to this point in the Store module, we've built the lifecycle (create, update, submit, review, go-live), but there are no endpoints for actually viewing a store. Steps 7 and 8 fix that — Step 7 lets the owner view their own store with full private details, and Step 8 lets buyers view a store's public profile.

Step 9 adds the social layer — buyers can follow stores they like, building a personalised feed and giving merchants a metric for their reach.

Step 10 is the critical integration point with the auth module. The frontend needs to know on every app load whether the user has a store, what status it's in, and whether they can access merchant features. Right now, the `/auth/me` endpoint returns only user data. We need to add the store relation so the frontend has a single source of truth for routing decisions.

These four steps together unlock the full user experience for both owners and buyers, even though the underlying store data has existed since Step 2. They're the "views" layer that makes the store data visible and actionable.

---

## Step 7 — Get My Store

### What Step 7 Accomplishes

The store owner views their own store's full details. This is the data behind the merchant dashboard — the store settings page, the setup wizard during DRAFT, the "under review" status page during PENDING_REVIEW or PENDING_GO_LIVE, and the live store management view during ACTIVE.

This endpoint returns everything about the store including private data: bank details, business registration, rejection reasons, denormalized metrics, and related records (addresses, employees, counts). The owner has full visibility into their own store.

---

### Endpoint

```
GET /stores/me
```

**Role:** Any authenticated user. The endpoint scopes the query to the current user's `ownerId`. If they don't have a store, it returns `null`. No `@Roles()` decorator is needed — a BUYER who hasn't created a store gets `null` back, which the frontend uses to show the "Start selling" prompt.

This is intentional. We don't want to throw 403 for buyers because they're not "forbidden" from accessing this endpoint — they simply don't have a store yet. The endpoint is designed to gracefully handle every state.

---

### Why /stores/me Instead of /stores/:id

Using `/stores/me` instead of requiring the store ID in the URL has three benefits:

**1. The frontend doesn't need to know the store ID upfront.** On app load, the frontend calls `/auth/me` to get user data, then calls `/stores/me` to get full store details. No ID required, no extra round trip to look up the ID.

**2. Implicit ownership.** The endpoint always returns the current user's store. No ownership check is needed in the service — the query itself scopes to the authenticated user via `ownerId`.

**3. Route clarity.** It avoids confusion with `GET /stores/:id` (which could be an admin endpoint or a public endpoint). `/stores/me` is unambiguous — it's always the current user's store, never anyone else's.

This is the same pattern as `GET /auth/me` for user profile data. Both endpoints use "me" as a self-referencing identifier that resolves to the authenticated user.

---

### Service Logic: getMyStore()

The `getMyStore` method in `StoreService` receives the authenticated user's ID and returns their store (or `null` if they don't have one).

**1. Find the store by ownerId.**

```typescript
const store = await this.prisma.store.findUnique({
  where: { ownerId: userId },
  include: {
    addresses: true,
    employees: {
      where: { isActive: true },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          }
        }
      }
    },
    _count: {
      select: {
        products: true,
        orders: true,
        followers: true,
      }
    }
  }
});
```

We include several related records:

- **`addresses`** — all physical store locations for the store settings page
- **`employees`** — only active team members (filtered by `isActive: true`), with their user info included so the dashboard can show names and emails. This becomes relevant once Step 12 (employee invitations) is built.
- **`_count.products`** — total product count for the dashboard overview metric. Note: this counts ALL products, not just ACTIVE — it gives the merchant visibility into their drafts too.
- **`_count.orders`** — total order count
- **`_count.followers`** — total follower count

These counts use Prisma's `_count` feature which translates to a SQL `COUNT()` subquery — much more efficient than loading the full related records just to count them.

**2. If no store exists, return `null`.**

```typescript
if (!store) {
  return null;
}
return store;
```

Important: do NOT throw a 404 here. A user without a store is a normal state, not an error. Throwing 404 would force the frontend to catch errors for a flow that's part of the happy path. Returning `null` is cleaner.

**3. Return the full store object.**

This is the owner's private view. It includes everything:

- Brand identity (companyName, displayName, slug, description, story, logos, banner, websiteUrl)
- Contact details (contactEmail, contactPhone)
- Business registration (businessRegNo, vatNumber)
- Bank/payout details (bankName, bankAccountNo, bankBranchCode, bankAccountType)
- Status and rejection reason
- Denormalized metrics (totalSales, totalRevenue, averageRating, followerCount)
- Addresses
- Active employees with user info
- Counts (products, orders, followers)
- Timestamps (createdAt, updatedAt)

Nothing is hidden — the owner has full visibility into their own store data.

---

### Response Shape

For a user with a store:

```json
{
  "id": "clx1abc123",
  "ownerId": "clx1user456",
  "companyName": "Khanyi Creative Ventures (Pty) Ltd",
  "displayName": "BOLD Streetwear",
  "slug": "bold-streetwear",
  "description": "Premium streetwear inspired by Johannesburg's urban culture",
  "story": "We started in a garage in Soweto in 2019...",
  "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
  "bannerUrl": "https://cdn.yiiva.co.za/stores/bold/banner.jpg",
  "websiteUrl": "https://boldstreetwear.co.za",
  "status": "ACTIVE",
  "rejectionReason": null,
  "contactEmail": "hello@boldstreetwear.co.za",
  "contactPhone": "+27 63 448 9940",
  "businessRegNo": "2024/123456/07",
  "vatNumber": "4123456789",
  "bankName": "FNB",
  "bankAccountNo": "62812345678",
  "bankBranchCode": "250655",
  "bankAccountType": "Cheque",
  "totalSales": 47,
  "totalRevenue": "12450.00",
  "averageRating": 4.7,
  "followerCount": 342,
  "createdAt": "2025-01-15T08:00:00.000Z",
  "updatedAt": "2025-04-08T10:00:00.000Z",
  "addresses": [
    {
      "id": "clx1addr789",
      "streetNumber": "42",
      "streetName": "Bree Street",
      "buildingName": "The Foundry",
      "city": "Johannesburg",
      "postalCode": "2001",
      "createdAt": "2025-02-10T09:00:00.000Z",
      "updatedAt": "2025-02-10T09:00:00.000Z"
    }
  ],
  "employees": [
    {
      "id": "clx1emp001",
      "email": "thabo@gmail.com",
      "employeeNumber": "EMP001",
      "isActive": true,
      "acceptedAt": "2025-03-20T11:00:00.000Z",
      "user": {
        "id": "clx1user789",
        "email": "thabo@gmail.com",
        "firstName": "Thabo",
        "lastName": "Mthembu"
      }
    }
  ],
  "_count": {
    "products": 12,
    "orders": 47,
    "followers": 342
  }
}
```

For a user without a store:

```json
null
```

---

### Controller

```typescript
@Get('me')
getMyStore(@CurrentUser() user) {
  return this.storeService.getMyStore(user.id);
}
```

No `@Roles()`, no `@Param()`. Just the authenticated user via `@CurrentUser()`.

---

### Route Ordering Critical Note

The route `GET /stores/me` MUST be declared in the controller BEFORE any routes that use `:slug` or `:id` as a parameter. NestJS evaluates routes top-down and uses the first match.

If `GET /stores/:slug` (Step 8) is declared first, then a request to `/stores/me` would match `:slug` with `slug = "me"` and never reach the intended handler. This is one of the most common bugs in REST APIs with parameterized routes.

The recommended controller order is:

```typescript
@Controller('stores')
export class StoreController {
  // 1. Specific routes (no parameters)
  @Get('me') getMyStore() { ... }
  @Get('admin/pending') listPending() { ... }
  @Get('admin/pending-go-live') listPendingGoLive() { ... }

  // 2. Create
  @Post() create() { ... }

  // 3. Routes with :id parameter (specific actions)
  @Patch(':id') update() { ... }
  @Post(':id/submit') submit() { ... }
  @Post(':id/review') review() { ... }
  @Post(':id/request-go-live') requestGoLive() { ... }
  @Post(':id/review-go-live') reviewGoLive() { ... }
  @Post(':id/follow') followStore() { ... }
  @Delete(':id/follow') unfollowStore() { ... }

  // 4. Catch-all parameterized routes (LAST)
  @Get(':slug') getPublicStore() { ... }
}
```

The `@Get(':slug')` is the last GET route. Anything more specific would otherwise be swallowed.

---

### Step 7 Error Cases

| Scenario | Status Code | Response |
|---|---|---|
| User has no store | 200 OK | `null` |
| User has a store | 200 OK | Full store object |
| Not authenticated | 401 Unauthorized | "Authentication required" |
| Account not active | 401 Unauthorized | Handled by JWT strategy |

This endpoint essentially can't fail beyond authentication errors. It's deliberately permissive — every authenticated user gets a valid response, even if it's `null`.

---

### What the Frontend Does With This

The frontend calls `GET /stores/me` whenever it needs to render the merchant dashboard or store setup wizard. The flow:

1. App loads → `GET /auth/me` returns user data with minimal store info (status, slug, logo)
2. Frontend uses the minimal store data for routing decisions
3. If the user navigates to the merchant dashboard, the frontend calls `GET /stores/me` for the full store details
4. Dashboard renders with addresses, employees, counts, bank details, etc.

This split keeps `/auth/me` fast and lightweight (it's called frequently) while making the full store details available on demand.

---

## Step 8 — Get Store Public Profile

### What Step 8 Accomplishes

Buyers browse a store's public profile — the brand's page showing their story, logo, banner, locations, rating, and follower count. This is the storefront that appears when a buyer taps on a brand in the discovery feed, search results, or a product page.

The key difference from Step 7: this returns only public information. No bank details, no business registration, no rejection reasons, no employee data. Even `companyName` is hidden — buyers see `displayName` only. The store's legal entity is internal information.

---

### Endpoint

```
GET /stores/:slug
```

**Role:** Any authenticated user. The store must be in `ACTIVE` status to be visible. Stores in any other status (DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, SUSPENDED, CLOSED) return 404.

---

### Why Slug Instead of ID

We use the slug (not the ID) because this is a public-facing URL — `yiiva.co.za/store/bold-streetwear` is human-readable and SEO-friendly. The ID is an opaque CUID that means nothing to the user.

This is the same pattern as Twitter (`twitter.com/username`), Instagram (`instagram.com/username`), or any blog platform (`example.com/post-title-slug`). The slug becomes the public identity of the store.

The slug is guaranteed unique because `displayName` is unique (enforced at the database level), and the slug is derived from `displayName`. No collision handling is needed.

---

### Service Logic: getPublicStore()

The `getPublicStore` method receives the slug from the URL parameter and the optional authenticated user ID (for the `isFollowing` check).

**1. Find the store by slug, filtered to ACTIVE only.**

```typescript
const store = await this.prisma.store.findFirst({
  where: {
    slug: slug,
    status: 'ACTIVE',
  },
  select: {
    id: true,
    displayName: true,
    slug: true,
    description: true,
    story: true,
    logoUrl: true,
    bannerUrl: true,
    websiteUrl: true,
    averageRating: true,
    followerCount: true,
    totalSales: true,
    createdAt: true,
    addresses: {
      select: {
        id: true,
        city: true,
      }
    },
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

We use `select` instead of returning the full model. This is a security measure — even if new sensitive fields are added to the Store model later, they won't accidentally leak through this endpoint. The whitelist approach is safer than a blacklist.

The product count is filtered to active products only — we don't expose how many drafts the merchant has. Buyers should only see what they can actually buy.

**2. If not found, throw 404.**

```typescript
if (!store) {
  throw new NotFoundException('Store not found');
}
```

The 404 is intentional and consistent. It doesn't matter whether the store doesn't exist at all, exists but isn't ACTIVE, or has been deleted — the response is the same. This prevents information leakage about non-public stores.

For example, an attacker shouldn't be able to discover that a store exists by trying various slugs and getting different errors for "doesn't exist" vs "exists but not active." Both cases return identical 404 responses.

**3. Check if the current user follows this store.**

If `userId` is available (which it always is since this endpoint requires authentication), run an additional query:

```typescript
const follower = await this.prisma.storeFollower.findUnique({
  where: {
    userId_storeId: {
      userId,
      storeId: store.id,
    }
  }
});

const isFollowing = follower !== null;
```

We add `isFollowing: boolean` to the response. This lets the frontend render the follow/unfollow button in the correct state without needing a second API call.

**4. Transform the addresses into a simple location array.**

For the public profile, we don't expose full addresses (street numbers, building names) — that's too much detail. Instead, we deduplicate by city and return a simple array:

```typescript
const locations = [...new Set(store.addresses.map(addr => addr.city))];
```

This gives buyers the Instagram-style location tag — "Johannesburg, Cape Town" — without exposing exact addresses.

**5. Return the public store profile.**

The response combines the public fields, the locations array, the product count, and the `isFollowing` flag.

---

### Public vs Private Field Separation

This is the key security boundary in the Store module. Here's exactly which fields go where:

**Included in public profile (Step 8):**

| Field | Why |
|---|---|
| `id` | Needed for follow/unfollow API calls and product queries |
| `displayName` | The brand's public name |
| `slug` | For URL construction |
| `description` | Short bio/summary |
| `story` | Brand narrative |
| `logoUrl` | Visual identity |
| `bannerUrl` | Cover image |
| `websiteUrl` | External website link (optional) |
| `averageRating` | Social proof |
| `followerCount` | Social proof |
| `totalSales` | Social proof (number of orders fulfilled) |
| `createdAt` | "Member since" info |
| `locations` (derived from addresses) | City tags only, not full addresses |
| Active product count | How many products buyers can browse |

**Excluded from public profile:**

| Field | Why excluded |
|---|---|
| `companyName` | Legal entity is internal info, only `displayName` is public |
| `ownerId` | Privacy — buyers don't need to know the owner's user ID |
| `contactEmail` | Private — could enable spam if exposed |
| `contactPhone` | Private — same reason |
| `businessRegNo` | Internal verification data |
| `vatNumber` | Tax info, not public |
| `bankName`, `bankAccountNo`, `bankBranchCode`, `bankAccountType` | Payout details, never public |
| `rejectionReason` | Internal review feedback |
| `totalRevenue` | Financial data, only the merchant should see |
| `addresses` (full street details) | Only city is exposed, not exact addresses |
| `employees` | Team data is internal |
| `status` | Implicit — only ACTIVE stores are returned anyway |
| `updatedAt` | Internal timestamp |

The principle: any field that affects business operations, legal status, financial accounting, or personal identification stays private. Public fields are limited to what helps buyers discover and trust the brand.

---

### Response Shape

```json
{
  "id": "clx1abc123",
  "displayName": "BOLD Streetwear",
  "slug": "bold-streetwear",
  "description": "Premium streetwear inspired by Johannesburg's urban culture",
  "story": "We started in a garage in Soweto in 2019 with one sewing machine and a dream...",
  "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
  "bannerUrl": "https://cdn.yiiva.co.za/stores/bold/banner.jpg",
  "websiteUrl": "https://boldstreetwear.co.za",
  "averageRating": 4.7,
  "followerCount": 342,
  "totalSales": 1250,
  "createdAt": "2025-01-15T08:00:00.000Z",
  "locations": ["Johannesburg", "Cape Town"],
  "productCount": 48,
  "isFollowing": false
}
```

Compare this to the Step 7 response — significantly less data, no sensitive information, transformed for buyer consumption.

---

### Controller

```typescript
@Get(':slug')
getPublicStore(
  @Param('slug') slug: string,
  @CurrentUser() user,
) {
  return this.storeService.getPublicStore(slug, user.id);
}
```

**Route ordering reminder:** This route uses `/:slug` which matches any string. It MUST be declared AFTER `/me`, `/admin/pending`, `/admin/pending-go-live`, and any other specific routes in the controller, otherwise those routes would be swallowed by the slug parameter.

---

### Step 8 Error Cases

| Scenario | Status Code | Message |
|---|---|---|
| Store not found (bad slug) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (DRAFT) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (PENDING_REVIEW) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (APPROVED) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (PENDING_GO_LIVE) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (SUSPENDED) | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE (CLOSED) | 404 Not Found | "Store not found" |
| Not authenticated | 401 Unauthorized | "Authentication required" |

The same 404 message for all "not visible" cases is intentional — we don't reveal store status to the public.

---

## Step 9 — Follow / Unfollow Store

### What Step 9 Accomplishes

Buyers follow stores for discovery and notifications. Following a store means the buyer expresses interest in the brand and (when the Notification module is built) gets notified about new products, content posts, and promotions from that brand. The follower count is a denormalized field on the Store model used as a social proof metric on the public profile.

This is a simple two-endpoint feature: one to follow, one to unfollow. The data lives in the existing `StoreFollower` join table.

---

### Endpoints

```
POST   /stores/:id/follow      — follow a store
DELETE /stores/:id/follow      — unfollow a store
```

**Role:** Any authenticated user.

**Why ID instead of slug:** The frontend already has the store ID from the public profile response (Step 8). Using the ID is faster (no slug-to-ID lookup needed) and more conventional for action endpoints. Slug is for navigation (URLs), ID is for actions.

---

### Service Logic: followStore()

**1. Verify the store exists and is ACTIVE.**

```typescript
const store = await this.prisma.store.findFirst({
  where: {
    id: storeId,
    status: 'ACTIVE',
  },
  select: { id: true }
});

if (!store) {
  throw new NotFoundException('Store not found');
}
```

We only allow following ACTIVE stores. Buyers shouldn't be able to follow stores that aren't yet visible (APPROVED, PENDING_GO_LIVE) or are suspended/closed.

**2. Check if already following.**

```typescript
const existingFollow = await this.prisma.storeFollower.findUnique({
  where: {
    userId_storeId: { userId, storeId }
  }
});

if (existingFollow) {
  throw new ConflictException('You are already following this store');
}
```

The `@@unique([userId, storeId])` constraint on `StoreFollower` would also catch this, but checking explicitly gives a cleaner error message than a raw Prisma P2002 error.

**3. Create the follow record and increment the count atomically.**

```typescript
await this.prisma.$transaction([
  this.prisma.storeFollower.create({
    data: { userId, storeId }
  }),
  this.prisma.store.update({
    where: { id: storeId },
    data: {
      followerCount: { increment: 1 }
    }
  }),
]);
```

The transaction is essential to keep the denormalized `followerCount` accurate. If the create succeeds but the increment fails, the count would drift from reality. The transaction guarantees both happen together.

The `{ increment: 1 }` operation is atomic at the database level — Prisma translates this to `UPDATE stores SET follower_count = follower_count + 1`, which is safe even under concurrent requests. Two users following the same store at the exact same moment both correctly increment the counter without race conditions.

**4. Return success.**

```json
{
  "message": "Store followed",
  "isFollowing": true
}
```

Including the `isFollowing` flag in the response means the frontend doesn't need to re-fetch the store profile to update the button state.

---

### Service Logic: unfollowStore()

**1. Verify the store exists.**

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  select: { id: true }
});

if (!store) {
  throw new NotFoundException('Store not found');
}
```

Note: we don't filter by `status: 'ACTIVE'` here. A buyer should be able to unfollow a store even if it gets suspended or closed later. If a followed store becomes inactive, the buyer should still be able to remove it from their following list.

**2. Find the follow record.**

```typescript
const follow = await this.prisma.storeFollower.findUnique({
  where: {
    userId_storeId: { userId, storeId }
  }
});

if (!follow) {
  throw new NotFoundException('You are not following this store');
}
```

If the user wasn't following, return a 404 with a clear message.

**3. Delete the record and decrement the count atomically.**

```typescript
await this.prisma.$transaction([
  this.prisma.storeFollower.delete({
    where: { id: follow.id }
  }),
  this.prisma.store.update({
    where: { id: storeId },
    data: {
      followerCount: { decrement: 1 }
    }
  }),
]);
```

Same transaction pattern as follow. Both operations succeed or both fail.

**4. Return success.**

```json
{
  "message": "Store unfollowed",
  "isFollowing": false
}
```

---

### Controller

```typescript
@Post(':id/follow')
followStore(@CurrentUser() user, @Param('id') storeId: string) {
  return this.storeService.followStore(user.id, storeId);
}

@Delete(':id/follow')
unfollowStore(@CurrentUser() user, @Param('id') storeId: string) {
  return this.storeService.unfollowStore(user.id, storeId);
}
```

Two separate methods, two separate HTTP verbs. Using `POST` for follow and `DELETE` for unfollow is the RESTful convention — POST creates a relationship, DELETE removes it.

---

### Step 9 Error Cases

**Follow:**

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Store exists but not ACTIVE | 404 Not Found | "Store not found" |
| Already following | 409 Conflict | "You are already following this store" |
| Not authenticated | 401 Unauthorized | "Authentication required" |

**Unfollow:**

| Scenario | Status Code | Message |
|---|---|---|
| Store not found | 404 Not Found | "Store not found" |
| Not following the store | 404 Not Found | "You are not following this store" |
| Not authenticated | 401 Unauthorized | "Authentication required" |

---

### Edge Cases

**Following your own store.** This is allowed. There's no business reason to prevent it, and some merchants want to follow their own store for testing or to see how it appears in their feed. The owner is just like any other authenticated user when it comes to follow/unfollow.

**Follower count accuracy.** The denormalized `followerCount` is always updated inside the same transaction as the follow/unfollow record. This prevents drift. If you ever suspect the count is off (due to a database bug or manual data manipulation), you could add an admin utility to recalculate it:

```sql
UPDATE stores
SET follower_count = (
  SELECT COUNT(*) FROM store_followers WHERE store_id = stores.id
);
```

This would only be needed in exceptional circumstances. The transaction-based approach should keep the count accurate under normal operation.

**Concurrency.** The `{ increment: 1 }` and `{ decrement: 1 }` operations are atomic at the database level. PostgreSQL handles concurrent updates to the same row safely — there's no race condition where two simultaneous follows could result in the count incrementing by only 1 instead of 2.

**Following a deleted store.** If a store is deleted while the user is in the process of following it, the foreign key constraint (`onDelete: Cascade`) on `StoreFollower` would automatically clean up the follow record. The user wouldn't even notice — their follow simply doesn't exist anymore.

**Following from the public profile.** The typical user flow:
1. Browse the discovery feed → tap on a store
2. `GET /stores/:slug` → sees `isFollowing: false`
3. Tap the "Follow" button → frontend calls `POST /stores/:id/follow`
4. Response: `{ message: "Store followed", isFollowing: true }`
5. Frontend updates the button to "Following" without needing to re-fetch the store profile

---

## Step 10 — Update /auth/me to Include Store Data

### What Step 10 Accomplishes

The `GET /auth/me` endpoint currently returns the user's profile. We need to add the user's store data to the response so the frontend has a single source of truth for routing decisions on any platform, any device, any session.

This is the backend contract that the entire frontend routing depends on. Without it, the frontend can't distinguish between a BUYER with no store, a BUYER with a DRAFT store (rejected or fresh), a MERCHANT with an APPROVED store, a MERCHANT with a PENDING_GO_LIVE store, and a MERCHANT with an ACTIVE store. Each of these states needs a different screen on the frontend.

This step doesn't add a new endpoint — it modifies the existing `/auth/me` endpoint in the auth module to include the user's store relation.

---

### What Changes

The existing `getMe()` method in the auth service queries the user by ID and returns their profile. We modify this query to include the store relation.

**Current query (approximate):**

```typescript
const user = await this.prisma.user.findUnique({
  where: { id: userId },
});
```

**Updated query:**

```typescript
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  include: {
    store: {
      select: {
        id: true,
        displayName: true,
        slug: true,
        status: true,
        logoUrl: true,
        rejectionReason: true,
      }
    }
  }
});
```

We use `select` on the store relation to return only the fields the frontend needs for routing and basic display. The full store details (bank details, addresses, employees, metrics) are available via `GET /stores/me` (Step 7) — `/auth/me` just needs enough to make routing decisions and show a small store badge in the UI.

---

### Updated Response Shape

For a user without a store (BUYER who hasn't created one):

```json
{
  "id": "clx1user456",
  "email": "khanyi@gmail.com",
  "firstName": "Khanyi",
  "lastName": "Mthamo",
  "role": "BUYER",
  "avatarUrl": null,
  "accountStatus": "ACTIVE",
  "emailVerified": true,
  "createdAt": "2025-03-10T08:00:00.000Z",
  "store": null
}
```

For a user with a store in any status:

```json
{
  "id": "clx1user456",
  "email": "khanyi@gmail.com",
  "firstName": "Khanyi",
  "lastName": "Mthamo",
  "role": "MERCHANT",
  "avatarUrl": "https://cdn.yiiva.co.za/avatars/khanyi.jpg",
  "accountStatus": "ACTIVE",
  "emailVerified": true,
  "createdAt": "2025-03-10T08:00:00.000Z",
  "store": {
    "id": "clx1abc123",
    "displayName": "BOLD Streetwear",
    "slug": "bold-streetwear",
    "status": "ACTIVE",
    "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
    "rejectionReason": null
  }
}
```

For a merchant with a rejected store:

```json
{
  "id": "clx1user456",
  "email": "khanyi@gmail.com",
  "role": "BUYER",
  "store": {
    "id": "clx1abc123",
    "displayName": "BOLD Streetwear",
    "slug": "bold-streetwear",
    "status": "DRAFT",
    "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
    "rejectionReason": "Logo quality needs improvement. Please upload a higher resolution image."
  }
}
```

Note that this user is back to BUYER role because they were rejected at the first review (so the role upgrade never happened — they were always a BUYER).

For a merchant whose go-live was rejected:

```json
{
  "id": "clx1user456",
  "email": "khanyi@gmail.com",
  "role": "MERCHANT",
  "store": {
    "id": "clx1abc123",
    "displayName": "BOLD Streetwear",
    "slug": "bold-streetwear",
    "status": "APPROVED",
    "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png",
    "rejectionReason": "Banner quality is too low. Please upload a higher resolution banner."
  }
}
```

This user remains a MERCHANT because the role upgrade happened at the first approval. The go-live rejection doesn't affect role.

---

### How the Frontend Uses This

The frontend calls `GET /auth/me` on every app load (after token refresh, on navigation, etc.) and routes the user based on the combination of `role` and `store`:

| `role` | `store` | `store.status` | `rejectionReason` | Frontend Route |
|---|---|---|---|---|
| BUYER | `null` | — | — | Mobile: shopping feed / Web: "Start selling" prompt |
| BUYER | present | `DRAFT` | none | Store setup wizard |
| BUYER | present | `DRAFT` | present | Store setup wizard with rejection feedback banner |
| BUYER | present | `PENDING_REVIEW` | — | "Under first review" status page |
| MERCHANT | present | `APPROVED` | none | Merchant dashboard with "Add products & request go-live" prompt |
| MERCHANT | present | `APPROVED` | present | Merchant dashboard with "Address feedback and request go-live again" prompt |
| MERCHANT | present | `PENDING_GO_LIVE` | — | "Final review in progress" status page |
| MERCHANT | present | `ACTIVE` | — | Full merchant dashboard, store is live |
| MERCHANT | present | `SUSPENDED` | — | "Store suspended" notice |
| ADMIN | any | any | — | Admin panel |

This single endpoint eliminates the need for the frontend to make multiple API calls just to determine which screen to show. One call, full routing context.

The role and store status combinations that should NEVER occur (and indicate a bug if seen):
- `BUYER` with `store.status: APPROVED` (role should have been upgraded)
- `BUYER` with `store.status: ACTIVE` (same)
- `BUYER` with `store.status: PENDING_GO_LIVE` (same)
- `MERCHANT` with `store: null` (role was upgraded but store was deleted somehow)
- `MERCHANT` with `store.status: DRAFT` (role should have been downgraded on rejection — but we don't downgrade, we never upgrade in the first place)
- `MERCHANT` with `store.status: PENDING_REVIEW` (same reasoning — no upgrade yet)

---

### Why rejectionReason Is Included

The `rejectionReason` is included in the `/auth/me` store data (not just in `GET /stores/me`) because the frontend needs it for the routing decision. Specifically, when a BUYER has a DRAFT store with a `rejectionReason`, the frontend shows a different screen than a BUYER with a fresh DRAFT store — the rejected store gets a prominent feedback banner showing what to fix.

Without `rejectionReason` in `/auth/me`, the frontend would need a second API call to `GET /stores/me` just to check if there's a rejection reason. That's an extra round trip on every app load for every user with a store.

The same applies to APPROVED stores with a `rejectionReason` (rejected at the second gate — the merchant needs to see the feedback before requesting go-live again).

---

### Fields Deliberately Excluded

The store object in `/auth/me` is intentionally minimal. It does NOT include:

| Excluded Field | Why |
|---|---|
| `companyName` | Not needed for routing |
| `description`, `story` | Content fields, fetched via `GET /stores/me` when needed |
| `bannerUrl` | Not needed for routing (logoUrl is included for header/avatar display) |
| `websiteUrl` | Not needed for routing |
| `contactEmail`, `contactPhone` | Private, fetched via `GET /stores/me` |
| Bank details | Private, fetched via `GET /stores/me` |
| `businessRegNo`, `vatNumber` | Private |
| Metrics | Not needed for routing, fetched via `GET /stores/me` |
| Addresses, employees | Separate concerns, fetched via `GET /stores/me` |
| Counts | Not needed for routing |

The principle: `/auth/me` answers "who am I and where should I go?" — not "tell me everything about my store." The full store details are one call away via `GET /stores/me`.

---

### Implementation Note

This change happens in the **auth module**, not the store module. Specifically:

1. The auth service's `getMe()` method (or whatever method handles `GET /auth/me`) gets the updated Prisma query.
2. No new endpoints are added.
3. No new controllers are added.
4. No new modules are created.
5. The store module doesn't need to export anything for this to work — the `include: { store: ... }` in the Prisma query uses the relation defined in the Prisma schema directly. Prisma handles the join automatically.

The change is just a query modification and a slightly richer response shape. It's the smallest of the four steps in this document but arguably the most important — it's the contract that everything else depends on.

---

### Step 10 Error Cases

No new error cases are introduced. The endpoint's behavior is unchanged — it either returns the user profile (now with store data included) or throws 401 if not authenticated. The `store` field is simply `null` for users without a store, never an error.

---

## Testing

### Unit Tests

#### Step 7 (Get My Store)

**Owner has a store:**
Mock `prisma.store.findUnique` returning a full store with addresses, employees, and counts. Verify the response includes all fields including private ones (bank details, rejection reason, business registration).

**User has no store:**
Mock `prisma.store.findUnique` returning `null`. Verify the service returns `null` (not throwing 404).

**Includes related records:**
Verify the Prisma query uses `include` with `addresses`, `employees` (filtered to active), and `_count` (products, orders, followers).

**Sensitive fields are present:**
This is the owner's view — explicitly verify that `bankName`, `bankAccountNo`, `businessRegNo`, `rejectionReason`, and `totalRevenue` are all in the response. (Compare with Step 8 tests where these are excluded.)

#### Step 8 (Get Public Store)

**Valid slug, ACTIVE store:**
Mock a store in ACTIVE status. Verify the response contains only public fields and includes `isFollowing`, `locations`, and `productCount`.

**Valid slug, DRAFT store:**
Mock the query returning null (because `where` includes `status: 'ACTIVE'` filter). Verify NotFoundException with "Store not found".

**Valid slug, PENDING_REVIEW:**
Same as DRAFT — query returns null, NotFoundException.

**Valid slug, APPROVED:**
Same — APPROVED stores are not yet visible to buyers.

**Valid slug, PENDING_GO_LIVE:**
Same — still not visible.

**Valid slug, SUSPENDED:**
Same.

**Valid slug, CLOSED:**
Same.

**Invalid slug (no matching store):**
Mock query returning null. Verify NotFoundException with the same message — "Store not found". This is the security-critical test: the same error message for "doesn't exist" and "exists but not visible" prevents enumeration.

**Public fields whitelist:**
Verify the response contains: `id`, `displayName`, `slug`, `description`, `story`, `logoUrl`, `bannerUrl`, `websiteUrl`, `averageRating`, `followerCount`, `totalSales`, `createdAt`, `locations`, `productCount`, `isFollowing`.

**Private fields excluded:**
Verify the response does NOT contain: `companyName`, `ownerId`, `contactEmail`, `contactPhone`, `businessRegNo`, `vatNumber`, `bankName`, `bankAccountNo`, `bankBranchCode`, `bankAccountType`, `rejectionReason`, `totalRevenue`, `status`, `updatedAt`.

**isFollowing is true when user follows:**
Mock `prisma.storeFollower.findUnique` returning a follow record. Verify response includes `isFollowing: true`.

**isFollowing is false when user does not follow:**
Mock `prisma.storeFollower.findUnique` returning `null`. Verify response includes `isFollowing: false`.

**Locations array is derived from addresses:**
Mock a store with addresses in two cities. Verify the response includes `locations: ["Johannesburg", "Cape Town"]` (or whatever the cities are), deduplicated and as a simple string array.

**Locations array deduplicates:**
Mock a store with two addresses in the same city. Verify the city appears only once in the locations array.

**Product count is filtered to active:**
Verify the Prisma query for `_count.products` includes `where: { status: 'ACTIVE' }`. Mock should reflect this filter.

#### Step 9 (Follow / Unfollow)

**Follow — store not found:**
Mock `prisma.store.findFirst` returning null. Verify NotFoundException.

**Follow — store not ACTIVE:**
Same as above — the query filters to ACTIVE only.

**Follow — already following:**
Mock `prisma.storeFollower.findUnique` returning an existing follow. Verify ConflictException.

**Follow — successful:**
Mock store found, no existing follow. Verify:
- `prisma.$transaction` is called
- A new `storeFollower` record is created
- The store's `followerCount` is incremented
- Response includes `isFollowing: true`

**Follow — own store:**
User follows their own store. Verify it succeeds (no special error for following yourself).

**Unfollow — store not found:**
Mock `prisma.store.findUnique` returning null. Verify NotFoundException.

**Unfollow — not following:**
Mock store found but `prisma.storeFollower.findUnique` returns null. Verify NotFoundException with "You are not following this store".

**Unfollow — successful:**
Mock store found and follow exists. Verify:
- `prisma.$transaction` is called
- The follow record is deleted
- The store's `followerCount` is decremented
- Response includes `isFollowing: false`

**Transaction atomicity:**
Mock the transaction throwing an error. Verify neither the follower record nor the count change.

#### Step 10 (Auth/me with Store)

**User with no store:**
Mock `prisma.user.findUnique` with `include: { store: ... }` returning a user with `store: null`. Verify the response includes `store: null`.

**User with DRAFT store, no rejection:**
Mock user with store in DRAFT status and `rejectionReason: null`. Verify the response includes the store with all 6 fields (id, displayName, slug, status, logoUrl, rejectionReason).

**User with DRAFT store after rejection:**
Mock user with store in DRAFT status and `rejectionReason: "Logo too small"`. Verify the response includes the rejection reason.

**User with APPROVED store:**
Mock user (now MERCHANT) with store in APPROVED status. Verify the response.

**User with PENDING_GO_LIVE store:**
Same pattern.

**User with ACTIVE store:**
Same pattern.

**User with APPROVED store after go-live rejection:**
Mock store in APPROVED with `rejectionReason: "Banner quality issue"`. Verify both fields are in the response.

**Sensitive store fields are NOT in the response:**
Explicitly verify that `bankName`, `bankAccountNo`, `companyName`, `contactEmail`, `businessRegNo`, etc. are NOT in the `store` object on the auth/me response. Only the 6 minimal fields should be present.

### Integration Tests

#### Full store visibility flow

This validates Steps 7 and 8 working together with the full store lifecycle:

1. Register user A → verify email → confirm role is BUYER
2. `GET /stores/me` as user A → verify returns `null`
3. Create store with all fields, submit, admin approves → user A is now MERCHANT, store is APPROVED
4. `GET /stores/me` as user A → verify full store object with bank details, businessRegNo, etc.
5. Add bannerUrl, story, address, 7 active products, request go-live → status PENDING_GO_LIVE
6. Admin approves go-live → status ACTIVE
7. Register user B → verify
8. `GET /stores/bold-streetwear` as user B → verify public profile with public fields only
9. Verify the response does NOT include companyName, bank details, contactEmail, rejectionReason
10. Verify the response includes `isFollowing: false`

#### Follow/unfollow flow

1. Continuing from above (user B is authenticated, store is ACTIVE)
2. `POST /stores/{store-id}/follow` as user B → 200 with `isFollowing: true`
3. `GET /stores/bold-streetwear` as user B → `isFollowing: true`
4. `GET /stores/me` as user A → `_count.followers: 1`, `followerCount: 1`
5. Try following again → 409 Conflict
6. `DELETE /stores/{store-id}/follow` as user B → 200 with `isFollowing: false`
7. `GET /stores/bold-streetwear` as user B → `isFollowing: false`
8. `GET /stores/me` as user A → `_count.followers: 0`, `followerCount: 0`
9. Try unfollowing again → 404 Not Found

#### Auth/me routing flow

This validates the routing contract through the entire store lifecycle:

1. Register user → `GET /auth/me` → `role: BUYER`, `store: null`
2. Create store → `GET /auth/me` → `store.status: 'DRAFT'`, `rejectionReason: null`
3. Update store with details → `GET /auth/me` → store object reflects updates
4. Submit → `GET /auth/me` → `store.status: 'PENDING_REVIEW'`
5. Admin rejects with reason → `GET /auth/me` → `store.status: 'DRAFT'`, `rejectionReason: 'Logo needs work'`
6. Edit store → `GET /auth/me` → `rejectionReason: null` (cleared on edit)
7. Resubmit → admin approves → `GET /auth/me` → `role: 'MERCHANT'`, `store.status: 'APPROVED'`
8. Add banner, story, address, 7 products, request go-live → `GET /auth/me` → `store.status: 'PENDING_GO_LIVE'`
9. Admin rejects go-live → `GET /auth/me` → `store.status: 'APPROVED'`, `rejectionReason: 'Banner quality issue'`
10. Edit store, fix banner → `GET /auth/me` → `rejectionReason: null`
11. Request go-live again → admin approves → `GET /auth/me` → `store.status: 'ACTIVE'`

#### Public profile visibility through lifecycle

1. Create store (DRAFT) → `GET /stores/:slug` → 404
2. Submit (PENDING_REVIEW) → `GET /stores/:slug` → 404
3. Admin approves (APPROVED) → `GET /stores/:slug` → 404 (still not visible!)
4. Add fields, request go-live (PENDING_GO_LIVE) → `GET /stores/:slug` → 404
5. Admin approves go-live (ACTIVE) → `GET /stores/:slug` → 200 (now visible!)

This is the most important test for the two-gate system — confirming that the store is invisible to buyers until it reaches ACTIVE status.

#### Authorization

1. Unauthenticated request to `/stores/me` → 401
2. Unauthenticated request to `/stores/:slug` → 401
3. Unauthenticated request to `/stores/:id/follow` → 401
4. All authenticated users (BUYER, MERCHANT, ADMIN) can access `/stores/me`, `/stores/:slug`, and follow/unfollow

### Manual Checks

**Step 7 — Get My Store:**
- Create and get approved → hit `GET /stores/me` → verify ALL fields including bank details, businessRegNo, rejectionReason are present
- Verify `_count` includes products, orders, followers
- Verify addresses array is populated (if any addresses exist)
- Verify employees array shows only active employees

**Step 8 — Public Profile:**
- Hit `GET /stores/:slug` as a different user (not the owner)
- Verify bank details, companyName, contactEmail, contactPhone, businessRegNo, vatNumber, totalRevenue are NOT in response
- Verify isFollowing is false initially
- Verify locations array shows just city names, not full addresses
- Verify productCount reflects only active products

**Step 9 — Follow/Unfollow:**
- Follow a store → check the `store_followers` table in the database → verify record exists
- Check the store's `followerCount` field → verify it incremented
- Try to follow again → confirm 409 Conflict
- Unfollow → verify record deleted from database
- Verify `followerCount` decremented
- Try to unfollow again → confirm 404
- Try following a SUSPENDED store → confirm 404

**Step 10 — Auth/me with Store:**
- Check `GET /auth/me` at every stage of the store lifecycle:
  - No store → store is null
  - DRAFT (fresh) → store with null rejectionReason
  - DRAFT (after rejection) → store with rejection reason populated
  - PENDING_REVIEW → store with PENDING_REVIEW status
  - APPROVED (just approved) → role is now MERCHANT, store with APPROVED status
  - APPROVED (after go-live rejection) → store with APPROVED status and rejection reason
  - PENDING_GO_LIVE → store with PENDING_GO_LIVE status
  - ACTIVE → store with ACTIVE status
- Verify the store object in /auth/me only contains the 6 minimal fields (id, displayName, slug, status, logoUrl, rejectionReason)
- Verify private fields (bankName, etc.) are NOT in the /auth/me store object

**Route ordering:**
- Verify `GET /stores/me` works (not intercepted by `/:slug`)
- Verify `GET /stores/admin/pending` works (not intercepted by `/:slug`)
- Verify `GET /stores/admin/pending-go-live` works
- Verify `GET /stores/some-actual-slug` works (the catch-all)

---

## API Endpoints Summary (Steps 7–10)

| Method | Path | Auth | Role | Description | Request Body | Response |
|--------|------|------|------|-------------|--------------|----------|
| GET | `/stores/me` | Required | Any | Get the current user's store (or null) | None | Full store object or `null` |
| GET | `/stores/:slug` | Required | Any | Get public store profile by slug | None | Public store object (excludes private fields) |
| POST | `/stores/:id/follow` | Required | Any | Follow a store | None | `{ message, isFollowing: true }` |
| DELETE | `/stores/:id/follow` | Required | Any | Unfollow a store | None | `{ message, isFollowing: false }` |
| GET | `/auth/me` (modified) | Required | Any | Get current user with minimal store info | None | User object with `store` field (or `store: null`) |
