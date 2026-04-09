# YIIVA — Store Module: Sub-Resources (Steps 11–12)

> Technical reference for managing store sub-resources — physical addresses and team member invitations.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Context](#context)
- [Step 11 — Store Addresses CRUD](#step-11--store-addresses-crud)
  - [What This Step Accomplishes](#what-step-11-accomplishes)
  - [Endpoints](#endpoints-step-11)
  - [Permission Model](#permission-model-step-11)
  - [DTO: create-address.dto.ts](#dto-create-addressdtots)
  - [DTO: update-address.dto.ts](#dto-update-addressdtots)
  - [Service Logic: addAddress()](#service-logic-addaddress)
  - [Service Logic: updateAddress()](#service-logic-updateaddress)
  - [Service Logic: deleteAddress()](#service-logic-deleteaddress)
  - [Controller](#controller-step-11)
  - [Error Cases](#step-11-error-cases)
- [Step 12 — Employee Invitations](#step-12--employee-invitations)
  - [What This Step Accomplishes](#what-step-12-accomplishes)
  - [The Invitation Flow Overview](#the-invitation-flow-overview)
  - [Schema Recap](#schema-recap)
  - [Endpoints](#endpoints-step-12)
  - [Permission Model](#permission-model-step-12)
  - [Sub-Step 12a — Send Invite](#sub-step-12a--send-invite)
    - [DTO: invite-employee.dto.ts](#dto-invite-employeedtots)
    - [Service Logic: inviteEmployee()](#service-logic-inviteemployee)
    - [The Invite Email](#the-invite-email)
  - [Sub-Step 12b — Validate Invite Token](#sub-step-12b--validate-invite-token)
    - [Service Logic: validateInvite()](#service-logic-validateinvite)
  - [Sub-Step 12c — Accept Invite](#sub-step-12c--accept-invite)
    - [Two Acceptance Paths](#two-acceptance-paths)
    - [DTO: accept-invite.dto.ts](#dto-accept-invitedtots)
    - [Service Logic: acceptInvite()](#service-logic-acceptinvite)
  - [Sub-Step 12d — List Store Employees](#sub-step-12d--list-store-employees)
    - [Service Logic: listEmployees()](#service-logic-listemployees)
  - [Sub-Step 12e — Deactivate Employee](#sub-step-12e--deactivate-employee)
    - [Service Logic: deactivateEmployee()](#service-logic-deactivateemployee)
  - [Sub-Step 12f — Reactivate Employee](#sub-step-12f--reactivate-employee)
    - [Service Logic: reactivateEmployee()](#service-logic-reactivateemployee)
  - [Sub-Step 12g — Remove Employee](#sub-step-12g--remove-employee)
    - [Service Logic: removeEmployee()](#service-logic-removeemployee)
  - [Sub-Step 12h — Resend Invite](#sub-step-12h--resend-invite)
    - [Service Logic: resendInvite()](#service-logic-resendinvite)
  - [Updated Permission Helpers](#updated-permission-helpers)
  - [Controller](#controller-step-12)
  - [Error Cases](#step-12-error-cases)
- [API Endpoints Summary (Steps 11–12)](#api-endpoints-summary-steps-1112)

---

## Context

Steps 11 and 12 add the two sub-resources we identified earlier in the planning phase:

**Step 11 — Store Addresses.** A store can have multiple physical locations (shops, studios, pop-ups). These appear on the public store profile as Instagram-style location tags. Up to this point, addresses have only been handled implicitly by the validation in Step 6a (the go-live request requires at least one address). Step 11 builds the actual CRUD endpoints for managing them.

**Step 12 — Employee Invitations.** A store can have multiple team members who help manage it. All employees have the same access level — they can edit the store profile, products, story, and content, but they cannot delete the store or manage other employees. Only the owner has those rights. This step builds the full invitation flow: sending invites by email, accepting invites (with or without an existing YIIVA account), and managing the team.

These two features are operationally separate from the core store lifecycle — they don't affect status transitions or admin reviews. They're "store management" rather than "store onboarding."

---

## Step 11 — Store Addresses CRUD

### What Step 11 Accomplishes

The store owner (or an active employee) can add, update, and delete physical store locations. These appear on the store's public profile as a list of cities/buildings, similar to how Instagram business accounts show their location tags.

This step is straightforward CRUD with three endpoints: create, update, delete. There is no separate "list" endpoint because addresses are already returned as part of `GET /stores/me` (Step 7) and the public profile (Step 8).

---

### Endpoints (Step 11)

```
POST   /stores/:storeId/addresses           — add a new address
PATCH  /stores/:storeId/addresses/:addressId — update an address
DELETE /stores/:storeId/addresses/:addressId — delete an address
```

**Why nested URLs?** Addresses belong to a specific store. Nesting under `/stores/:storeId/` makes the parent-child relationship explicit in the URL. It also makes ownership/permission checks unambiguous — the store ID is part of the route, so the service knows exactly which store to verify the user has access to.

We could use `/addresses/:id` (flat) instead, but that would require the service to look up the address first to determine which store it belongs to before checking permissions. Nested URLs are slightly more verbose but cleaner.

---

### Permission Model (Step 11)

Both the owner AND active employees can manage addresses. This is a deliberate decision — addresses are operational data that team members need to update (e.g. when the store moves locations). Restricting it to the owner only would create a bottleneck.

The permission check needs a small helper because we'll use it across multiple endpoints in this step and in Step 12:

```typescript
private async canManageStore(userId: string, storeId: string): Promise<boolean> {
  // Check if user is the owner
  const store = await this.prisma.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true },
  });

  if (!store) {
    return false;
  }

  if (store.ownerId === userId) {
    return true;
  }

  // Check if user is an active employee
  const employee = await this.prisma.storeEmployee.findUnique({
    where: {
      storeId_email: {
        storeId,
        email: '', // We need a different lookup — see note below
      }
    }
  });

  // Better approach: query by storeId and userId directly
  const activeEmployee = await this.prisma.storeEmployee.findFirst({
    where: {
      storeId,
      userId,
      isActive: true,
      acceptedAt: { not: null },
    }
  });

  return activeEmployee !== null;
}
```

The helper returns `true` if the user is the owner OR an active accepted employee. False otherwise. This becomes a reusable building block for any operation that needs "can this user manage this store?" semantics.

---

### DTO: create-address.dto.ts

The address fields, validated using `class-validator`:

**`streetNumber`**
- Type: string
- Validation: required, trimmed, maximum 20 characters
- Purpose: the number on the street, e.g. "42", "180", "12A"
- Example: "42"

**`streetName`**
- Type: string
- Validation: required, trimmed, minimum 2 characters, maximum 100 characters
- Purpose: the name of the street, e.g. "Bree Street", "Katherine Street"
- Example: "Bree Street"

**`buildingName`**
- Type: string
- Validation: optional, maximum 100 characters
- Purpose: the name of the building, complex, mall, or shopping centre. Optional because not every location is in a named building.
- Example: "The Foundry", "Sandton City", "Rosebank Mall"

**`city`**
- Type: string
- Validation: required, trimmed, minimum 2 characters, maximum 100 characters
- Purpose: the city or town
- Example: "Johannesburg"

**`postalCode`**
- Type: string
- Validation: required, trimmed, minimum 4 characters, maximum 10 characters
- Purpose: South African postal code (typically 4 digits)
- Example: "2001"

---

### DTO: update-address.dto.ts

Same fields as create, but all optional. This is a partial update — the user sends only the fields they want to change.

```typescript
export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  streetNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  streetName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  buildingName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(10)
  postalCode?: string;
}
```

---

### Service Logic: addAddress()

**1. Verify the user can manage this store.**

```typescript
const canManage = await this.canManageStore(userId, storeId);
if (!canManage) {
  throw new ForbiddenException('You do not have permission to manage this store');
}
```

This check covers both ownership (owner) and active employee status. If neither, throw 403.

**2. Verify the store exists and is in a valid status.**

The `canManageStore` helper already returns false if the store doesn't exist (returning 403 instead of 404). This is fine for security — we don't want to reveal store existence to unauthorized users.

For status validation, addresses can be added at any status except `CLOSED`:

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  select: { status: true },
});

if (store.status === 'CLOSED') {
  throw new BadRequestException('Cannot add addresses to a closed store');
}
```

We allow adding addresses in DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE, and even SUSPENDED. The merchant might be addressing issues that caused the suspension.

**3. Create the address.**

```typescript
const address = await this.prisma.storeAddress.create({
  data: {
    storeId,
    streetNumber: dto.streetNumber,
    streetName: dto.streetName,
    buildingName: dto.buildingName,
    city: dto.city,
    postalCode: dto.postalCode,
  },
});
```

**4. Return the created address.**

The frontend uses this to update its local state without re-fetching the entire store.

---

### Service Logic: updateAddress()

**1. Verify the user can manage this store.**

Same `canManageStore` check.

**2. Find the address and verify it belongs to this store.**

```typescript
const address = await this.prisma.storeAddress.findUnique({
  where: { id: addressId },
});

if (!address) {
  throw new NotFoundException('Address not found');
}

if (address.storeId !== storeId) {
  throw new NotFoundException('Address not found');
}
```

The double check (existence + storeId match) prevents URL manipulation. If a user knows an address ID from another store and tries to update it via their own store's URL, they get a 404. The same response for "doesn't exist" and "exists but wrong store" prevents enumeration.

**3. Update the address.**

```typescript
const updated = await this.prisma.storeAddress.update({
  where: { id: addressId },
  data: dto, // Only fields present in the DTO are updated
});
```

Prisma's `update` ignores `undefined` values, so passing the DTO directly is safe — only fields the user explicitly sent get changed.

**4. Return the updated address.**

---

### Service Logic: deleteAddress()

**1. Verify the user can manage this store.**

Same `canManageStore` check.

**2. Find the address and verify it belongs to this store.**

Same lookup pattern as update.

**3. Check the go-live requirement.**

If the store is in `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE` status, the merchant cannot delete their last remaining address. The go-live requirement is "at least one address," and a store that's already past the first review needs to maintain that requirement.

```typescript
if (['APPROVED', 'PENDING_GO_LIVE', 'ACTIVE'].includes(store.status)) {
  const addressCount = await this.prisma.storeAddress.count({
    where: { storeId },
  });

  if (addressCount === 1) {
    throw new BadRequestException(
      'Cannot delete the last address. Approved stores must have at least one location.'
    );
  }
}
```

This prevents an active store from regressing to a state where it can't satisfy the go-live requirements. If the merchant wants to delete their only address, they'd need to add a new one first.

In DRAFT or PENDING_REVIEW status, the merchant can delete any address — they haven't yet been approved, so the go-live requirements don't apply.

**4. Delete the address.**

```typescript
await this.prisma.storeAddress.delete({
  where: { id: addressId },
});
```

**5. Return a success response.**

```json
{ "message": "Address deleted" }
```

---

### Controller (Step 11)

```typescript
@Post(':storeId/addresses')
addAddress(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Body() dto: CreateAddressDto,
) {
  return this.storeService.addAddress(user.id, storeId, dto);
}

@Patch(':storeId/addresses/:addressId')
updateAddress(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('addressId') addressId: string,
  @Body() dto: UpdateAddressDto,
) {
  return this.storeService.updateAddress(user.id, storeId, addressId, dto);
}

@Delete(':storeId/addresses/:addressId')
deleteAddress(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('addressId') addressId: string,
) {
  return this.storeService.deleteAddress(user.id, storeId, addressId);
}
```

These routes use `:storeId` not `:id` to be explicit about what the parameter represents (the parent store, not the address). This makes the controller easier to read at a glance.

---

### Step 11 Error Cases

**addAddress:**

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 | "Authentication required" |
| Not the owner or an active employee | 403 | "You do not have permission to manage this store" |
| Store is CLOSED | 400 | "Cannot add addresses to a closed store" |
| Invalid input (missing fields, too short, too long) | 400 | Validation error |

**updateAddress:**

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 | "Authentication required" |
| Not the owner or an active employee | 403 | "You do not have permission to manage this store" |
| Address not found | 404 | "Address not found" |
| Address exists but belongs to a different store | 404 | "Address not found" |
| Invalid input | 400 | Validation error |

**deleteAddress:**

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 | "Authentication required" |
| Not the owner or an active employee | 403 | "You do not have permission to manage this store" |
| Address not found | 404 | "Address not found" |
| Trying to delete the last address of an APPROVED/PENDING_GO_LIVE/ACTIVE store | 400 | "Cannot delete the last address. Approved stores must have at least one location." |

---

## Step 12 — Employee Invitations

### What Step 12 Accomplishes

The store owner can invite people to help manage their store. The invited person receives an email with a link, clicks the link, and either signs up (if they don't have a YIIVA account) or logs in (if they already have one). Once they accept, they become an active employee and can access the merchant dashboard for that specific store.

Only the store owner can send invites and remove employees. Active employees themselves can manage store data (products, addresses, content) but cannot manage the team — that's reserved for the owner.

This is the most complex step in the Store module because it involves a multi-stage flow with two acceptance paths (existing user vs new user), token security, email integration, and intersects with the auth module.

---

### The Invitation Flow Overview

```
Owner sends invite
  ↓ (email sent with raw token)
Recipient clicks link in email
  ↓
Frontend extracts token from URL
  ↓
Frontend calls validate-invite endpoint
  ↓
Token is valid → frontend shows accept screen
  ↓
Recipient is presented with two paths:
  ├─ Path A: Already has a YIIVA account → log in
  └─ Path B: Doesn't have an account → sign up
  ↓ (auth completes)
Frontend calls accept-invite endpoint with the token
  ↓
StoreEmployee record is updated:
  - userId is set to the authenticated user
  - acceptedAt is stamped
  - inviteToken and inviteExpiry are cleared
  ↓
The employee can now access the store dashboard
```

The complexity comes from the two acceptance paths — the recipient might or might not already have a YIIVA account. We need to support both without forcing them to create a duplicate account or get confused about which email to use.

---

### Schema Recap

The `StoreEmployee` model from Step 1:

```prisma
model StoreEmployee {
  id             String    @id @default(cuid())
  storeId        String
  userId         String?   // null until accepted
  email          String    // email the invite was sent to
  employeeNumber String?   // optional, provided by employee at acceptance
  inviteToken    String?   // SHA256 hash of the raw token
  inviteExpiry   DateTime? // when the invite expires
  acceptedAt     DateTime? // null until accepted
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

Key fields:
- `userId` is nullable because we don't know who the user is until they accept
- `email` is always present (the email the invite was sent to)
- `inviteToken` is the SHA256 hash of the raw token (raw token only exists in the email)
- `acceptedAt` distinguishes pending invites from accepted employees
- `isActive` allows the owner to deactivate without deleting (audit trail)
- `@@unique([storeId, email])` prevents inviting the same email twice to the same store

---

### Endpoints (Step 12)

This is the largest set of endpoints in the entire Store module. There are 8 sub-steps, but they group cleanly:

**Owner-only endpoints (managing the team):**
```
POST   /stores/:storeId/employees                        — send invite
GET    /stores/:storeId/employees                        — list employees
POST   /stores/:storeId/employees/:employeeId/resend     — resend invite
POST   /stores/:storeId/employees/:employeeId/deactivate — deactivate
POST   /stores/:storeId/employees/:employeeId/reactivate — reactivate
DELETE /stores/:storeId/employees/:employeeId            — remove (delete record)
```

**Recipient-facing endpoints (accepting an invite):**
```
GET  /employees/invites/validate?token=xxx — validate invite token
POST /employees/invites/accept             — accept the invite
```

The recipient-facing endpoints are NOT nested under `/stores/:storeId/` because the recipient doesn't know the store ID at the point of validation — they only have the token from the email link. The token itself contains all the information needed to identify which store and which invite.

---

### Permission Model (Step 12)

Different operations have different permission requirements:

| Operation | Who can do it |
|---|---|
| Send invite | Store owner only |
| List employees | Owner OR active employee |
| Resend invite | Store owner only |
| Deactivate employee | Store owner only |
| Reactivate employee | Store owner only |
| Remove employee | Store owner only |
| Validate invite token | Anyone (the token IS the auth) |
| Accept invite | Authenticated user (the token determines which invite) |

The owner has exclusive control over team management. Employees can see who else is on the team (so they know who they're working with) but can't add, remove, or change anyone.

We need a stricter helper than `canManageStore` for owner-only operations:

```typescript
private async isStoreOwner(userId: string, storeId: string): Promise<boolean> {
  const store = await this.prisma.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true },
  });

  return store?.ownerId === userId;
}
```

---

### Sub-Step 12a — Send Invite

#### DTO: invite-employee.dto.ts

**`email`**
- Type: string
- Validation: required, valid email format, lowercased, trimmed
- Purpose: the email address to send the invite to. This is what links the invite to the recipient — when they accept, the system matches them by email.
- Example: "thabo@gmail.com"

That's the only field. The owner doesn't provide a name, role, or any other info. The recipient provides their own name during sign-up (if new) or it's pulled from their existing user record (if they already have an account).

#### Service Logic: inviteEmployee()

**1. Verify the user is the store owner.**

```typescript
const isOwner = await this.isStoreOwner(userId, storeId);
if (!isOwner) {
  throw new ForbiddenException('Only the store owner can invite employees');
}
```

Active employees cannot invite other employees. This is enforced by using `isStoreOwner` instead of `canManageStore`.

**2. Verify the store exists and is in a valid status.**

Inviting employees only makes sense for stores that are at least approved. A merchant in DRAFT or PENDING_REVIEW shouldn't be building a team yet — they don't even know if they'll be approved.

```typescript
const store = await this.prisma.store.findUnique({
  where: { id: storeId },
  select: { status: true, displayName: true },
});

if (!['APPROVED', 'PENDING_GO_LIVE', 'ACTIVE'].includes(store.status)) {
  throw new BadRequestException(
    'You can only invite employees once your store has been approved'
  );
}
```

This prevents premature team building. A merchant in DRAFT shouldn't be sending invites that promise dashboard access to a store that might never be approved.

**3. Check for existing invite/employee with the same email.**

```typescript
const existing = await this.prisma.storeEmployee.findUnique({
  where: {
    storeId_email: { storeId, email: dto.email },
  },
});

if (existing) {
  if (existing.acceptedAt) {
    throw new ConflictException('This person is already an employee of your store');
  } else {
    throw new ConflictException(
      'An invite has already been sent to this email. Use the resend endpoint if needed.'
    );
  }
}
```

Two different conflict messages for clarity:
- If `acceptedAt` is set, the person is already an active or inactive employee
- If `acceptedAt` is null, there's a pending invite that hasn't been accepted yet

**4. Generate the invite token.**

Same pattern as the auth module's verification and reset tokens:

```typescript
const rawToken = crypto.randomBytes(32).toString('hex'); // 64-char hex
const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
```

The raw token only exists in memory and the email — it's never stored in the database. The hash is what gets stored. When the recipient comes back with the raw token, we hash it and compare.

A 7-day expiry gives the recipient enough time to receive, read, and act on the invite without staying valid forever.

**5. Create the StoreEmployee record.**

```typescript
const employee = await this.prisma.storeEmployee.create({
  data: {
    storeId,
    email: dto.email,
    inviteToken: hashedToken,
    inviteExpiry,
    isActive: true,
    // userId, acceptedAt, employeeNumber stay null
  },
});
```

The record is created in a "pending" state — has an email and a token, but no user or acceptance timestamp.

**6. Send the invite email.**

```typescript
await this.emailService.sendStoreInviteEmail(
  dto.email,
  store.displayName,
  rawToken,
);
```

This is a new method on the Email service. The email content is detailed in the next subsection.

If the email fails to send, we still keep the StoreEmployee record (the token is in the database). The owner can use the resend endpoint to try again. We don't roll back the create — that would be more annoying than helpful.

**7. Return the created employee record.**

```json
{
  "id": "clx1emp001",
  "email": "thabo@gmail.com",
  "isActive": true,
  "acceptedAt": null,
  "createdAt": "2025-04-08T10:00:00.000Z"
}
```

We don't return the token (it's in the email, not the API response). We don't return the `inviteToken` or `inviteExpiry` fields either — those are internal.

#### The Invite Email

The email is the recipient's introduction to the platform. It needs to:
- Identify what they're being invited to (which store)
- Explain what becoming an employee means (dashboard access for managing this store)
- Provide a clear call to action (the invite link)
- Note the expiry (7 days)

**Subject:** "You've been invited to manage [Store Display Name] on YIIVA"

**Body content:**
- Greeting (no first name available — we don't know who they are yet)
- Brief explanation: "[Store owner name] has invited you to help manage [Store Display Name] on YIIVA, the marketplace for South African creative brands."
- What it means: "As a team member, you'll be able to manage products, edit the store profile, and respond to orders."
- Call-to-action button: "Accept Invitation" linking to `${FRONTEND_URL}/employees/invite?token=${rawToken}`
- Plain-text URL fallback below the button
- Expiry note: "This invitation expires in 7 days."
- If you don't recognize this invitation, you can safely ignore this email.

The frontend's invite acceptance page handles the rest — it calls the validate endpoint, shows the store name, and presents the sign-up or login flow.

---

### Sub-Step 12b — Validate Invite Token

This endpoint is called by the frontend when the recipient clicks the invite link. It validates the token and returns information about the invite (which store, what email) so the frontend can show a meaningful "Accept invite to BOLD Streetwear" screen before the recipient even authenticates.

This is a public endpoint — no authentication required. The token IS the authentication.

```
GET /employees/invites/validate?token=xxx
```

#### Service Logic: validateInvite()

**1. Hash the incoming token.**

```typescript
const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
```

**2. Find the invite by hashed token.**

```typescript
const invite = await this.prisma.storeEmployee.findFirst({
  where: {
    inviteToken: hashedToken,
    inviteExpiry: { gt: new Date() },
    acceptedAt: null,
  },
  include: {
    store: {
      select: {
        id: true,
        displayName: true,
        slug: true,
        logoUrl: true,
      }
    }
  }
});

if (!invite) {
  throw new BadRequestException('Invalid or expired invitation');
}
```

Three conditions in one query:
- Token must match
- Must not be expired
- Must not already be accepted

If any of these fail, the same generic error is returned. We don't leak which condition failed.

**3. Return the invite details.**

```json
{
  "email": "thabo@gmail.com",
  "store": {
    "id": "clx1abc123",
    "displayName": "BOLD Streetwear",
    "slug": "bold-streetwear",
    "logoUrl": "https://cdn.yiiva.co.za/stores/bold/logo.png"
  }
}
```

The frontend uses this to display the invite acceptance screen with the store's branding. The recipient sees "You've been invited to manage BOLD Streetwear" with the logo, instead of a generic "Accept invitation" prompt.

The email is included so the frontend can pre-fill the sign-up form (if the recipient doesn't have an account yet).

---

### Sub-Step 12c — Accept Invite

This is where the recipient becomes an actual employee. By this point, they've validated the token and they're authenticated (either by signing up or logging in). The accept endpoint links their user account to the StoreEmployee record.

```
POST /employees/invites/accept
```

#### Two Acceptance Paths

**Path A: Recipient already has a YIIVA account.**

1. Recipient clicks the invite link in their email
2. Frontend calls `GET /employees/invites/validate?token=xxx` → shows store info and "Log in to accept"
3. Recipient logs in via the standard auth flow (`POST /auth/login`)
4. Frontend now has an access token for the recipient
5. Frontend calls `POST /employees/invites/accept` with the original invite token in the body, using the new access token in the Authorization header
6. Backend matches the authenticated user to the invite via the token
7. The StoreEmployee record's `userId` and `acceptedAt` are set
8. Recipient is now an active employee

**Path B: Recipient does NOT have a YIIVA account.**

1. Recipient clicks the invite link
2. Frontend calls validate → shows store info and "Sign up to accept"
3. Recipient registers via the standard auth flow (`POST /auth/register`) — first name, last name, password, the email is pre-filled from the invite validation response
4. Recipient verifies their email (`POST /auth/verify-email`)
5. Frontend now has an access token for the new user
6. Frontend calls `POST /employees/invites/accept` with the original invite token
7. Backend matches the new user to the invite
8. Recipient is now an active employee

The key insight: from the backend's perspective, both paths look identical at the accept-invite step. The user is authenticated (either freshly registered or logging in), the token is provided, and the backend just needs to link them.

#### DTO: accept-invite.dto.ts

**`token`**
- Type: string
- Validation: required, string
- Purpose: the raw invite token from the email URL

**`employeeNumber`**
- Type: string
- Validation: optional, maximum 50 characters
- Purpose: an optional identifier the recipient can provide. Some businesses track employees by employee numbers. Not generated by the system, not required.

#### Service Logic: acceptInvite()

**1. Hash the incoming token.**

```typescript
const hashedToken = crypto.createHash('sha256').update(dto.token).digest('hex');
```

**2. Find the pending invite.**

```typescript
const invite = await this.prisma.storeEmployee.findFirst({
  where: {
    inviteToken: hashedToken,
    inviteExpiry: { gt: new Date() },
    acceptedAt: null,
  },
});

if (!invite) {
  throw new BadRequestException('Invalid or expired invitation');
}
```

Same query as validate, but without the `include` (we don't need to return store details — the frontend already has them from the validate call).

**3. Verify the authenticated user's email matches the invite email.**

```typescript
const user = await this.prisma.user.findUnique({
  where: { id: userId },
  select: { email: true },
});

if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
  throw new BadRequestException(
    'This invitation was sent to a different email address. Please log in with the correct account.'
  );
}
```

This is a critical security check. Without it, anyone with the invite token could accept the invite and gain access to the store, regardless of who the invite was actually for. The email match ensures the person accepting is the person the invite was meant for.

We compare lowercased to handle case differences (the recipient might log in as `Thabo@Gmail.com` but the invite was sent to `thabo@gmail.com`).

**4. Update the StoreEmployee record.**

```typescript
const updated = await this.prisma.storeEmployee.update({
  where: { id: invite.id },
  data: {
    userId,
    employeeNumber: dto.employeeNumber, // optional
    acceptedAt: new Date(),
    inviteToken: null, // clear the token (one-time use)
    inviteExpiry: null,
  },
  include: {
    store: {
      select: {
        id: true,
        displayName: true,
        slug: true,
      }
    }
  }
});
```

The token is cleared after acceptance — it can never be used again. The `acceptedAt` timestamp marks when the acceptance happened. The user is now linked.

**5. Return the accepted employee record.**

```json
{
  "id": "clx1emp001",
  "email": "thabo@gmail.com",
  "employeeNumber": "EMP001",
  "isActive": true,
  "acceptedAt": "2025-04-08T11:30:00.000Z",
  "store": {
    "id": "clx1abc123",
    "displayName": "BOLD Streetwear",
    "slug": "bold-streetwear"
  }
}
```

The frontend uses this to navigate the new employee into the merchant dashboard for that store.

---

### Sub-Step 12d — List Store Employees

The owner and existing employees can see who's on the team.

```
GET /stores/:storeId/employees
```

#### Service Logic: listEmployees()

**1. Verify the user can manage this store.**

Use `canManageStore` (not `isStoreOwner`) — both owners and active employees can see the team list.

**2. Query employees for the store.**

```typescript
const employees = await this.prisma.storeEmployee.findMany({
  where: { storeId },
  orderBy: { createdAt: 'asc' },
  include: {
    user: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
      }
    }
  }
});
```

We include the user info for accepted employees so the dashboard can show names and avatars. For pending invites (no userId yet), the `user` field will be null.

**3. Format the response.**

We don't need to filter — the response includes both pending invites and accepted employees. The frontend can distinguish based on `acceptedAt` (null = pending, set = accepted) and `isActive` (true = active, false = deactivated).

```json
{
  "data": [
    {
      "id": "clx1emp001",
      "email": "thabo@gmail.com",
      "employeeNumber": "EMP001",
      "isActive": true,
      "acceptedAt": "2025-03-20T11:00:00.000Z",
      "createdAt": "2025-03-19T09:00:00.000Z",
      "user": {
        "id": "clx1user789",
        "firstName": "Thabo",
        "lastName": "Mthembu",
        "avatarUrl": "https://cdn.yiiva.co.za/avatars/thabo.jpg"
      }
    },
    {
      "id": "clx1emp002",
      "email": "lerato@gmail.com",
      "employeeNumber": null,
      "isActive": true,
      "acceptedAt": null,
      "createdAt": "2025-04-05T14:00:00.000Z",
      "user": null
    }
  ]
}
```

The first record is an accepted, active employee. The second is a pending invite that hasn't been accepted yet.

We do NOT return the `inviteToken` or `inviteExpiry` fields — those are internal and even the owner shouldn't see the hashed token (it has no value to them and shouldn't leak).

---

### Sub-Step 12e — Deactivate Employee

The owner can revoke an employee's access without deleting the record (audit trail).

```
POST /stores/:storeId/employees/:employeeId/deactivate
```

#### Service Logic: deactivateEmployee()

**1. Verify the user is the store owner.**

```typescript
const isOwner = await this.isStoreOwner(userId, storeId);
if (!isOwner) {
  throw new ForbiddenException('Only the store owner can deactivate employees');
}
```

**2. Find the employee and verify it belongs to this store.**

```typescript
const employee = await this.prisma.storeEmployee.findUnique({
  where: { id: employeeId },
});

if (!employee || employee.storeId !== storeId) {
  throw new NotFoundException('Employee not found');
}
```

**3. Verify the employee is currently active.**

```typescript
if (!employee.isActive) {
  throw new BadRequestException('Employee is already deactivated');
}
```

**4. Deactivate the employee.**

```typescript
const updated = await this.prisma.storeEmployee.update({
  where: { id: employeeId },
  data: { isActive: false },
});
```

The record is preserved. The user can no longer access the store dashboard (the `canManageStore` helper filters by `isActive: true` and `acceptedAt: not null`).

**5. Return the updated employee record.**

---

### Sub-Step 12f — Reactivate Employee

The opposite of deactivate — restore access to a previously deactivated employee.

```
POST /stores/:storeId/employees/:employeeId/reactivate
```

#### Service Logic: reactivateEmployee()

Mirror of deactivate:

1. Verify owner
2. Find employee, verify it belongs to this store
3. Verify the employee is currently inactive (`isActive: false`)
4. If not inactive, throw `BadRequestException` "Employee is already active"
5. Update `isActive: true`
6. Return updated employee

This allows the owner to restore access without re-sending an invite. The `userId` and `acceptedAt` are still set from the original acceptance, so the employee just regains their access.

---

### Sub-Step 12g — Remove Employee

Permanently delete the employee record.

```
DELETE /stores/:storeId/employees/:employeeId
```

#### Service Logic: removeEmployee()

**1. Verify the user is the store owner.**

**2. Find the employee, verify it belongs to this store.**

**3. Delete the record.**

```typescript
await this.prisma.storeEmployee.delete({
  where: { id: employeeId },
});
```

This is a hard delete. The audit trail is gone. For most operations, deactivate is better than remove — but remove is the appropriate action when:
- The invite was sent to the wrong email (mistake) and hasn't been accepted yet
- The employee left the company permanently
- The owner wants to clean up their team list

**4. Return success.**

```json
{ "message": "Employee removed" }
```

---

### Sub-Step 12h — Resend Invite

If the original invite email was lost, expired, or the recipient never received it, the owner can resend.

```
POST /stores/:storeId/employees/:employeeId/resend
```

#### Service Logic: resendInvite()

**1. Verify the user is the store owner.**

**2. Find the employee.**

**3. Verify the invite has not been accepted yet.**

```typescript
if (employee.acceptedAt) {
  throw new BadRequestException('This invitation has already been accepted');
}
```

You can't resend an invite that's already been accepted — that doesn't make sense. The person is already an employee.

**4. Generate a new token.**

```typescript
const rawToken = crypto.randomBytes(32).toString('hex');
const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
```

We generate a fresh token rather than reusing the old one. This invalidates any link from the previous email — only the latest invite is valid.

**5. Update the employee record with the new token.**

```typescript
await this.prisma.storeEmployee.update({
  where: { id: employeeId },
  data: {
    inviteToken: hashedToken,
    inviteExpiry,
  },
});
```

**6. Send the invite email again.**

```typescript
await this.emailService.sendStoreInviteEmail(
  employee.email,
  store.displayName,
  rawToken,
);
```

**7. Return success.**

```json
{ "message": "Invitation resent" }
```

---

### Updated Permission Helpers

Now that we have employees, the `canManageStore` helper from Step 11 needs to actually use the StoreEmployee table. The full helper:

```typescript
private async canManageStore(userId: string, storeId: string): Promise<boolean> {
  const store = await this.prisma.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true },
  });

  if (!store) {
    return false;
  }

  // Owner can always manage
  if (store.ownerId === userId) {
    return true;
  }

  // Active accepted employee can manage
  const employee = await this.prisma.storeEmployee.findFirst({
    where: {
      storeId,
      userId,
      isActive: true,
      acceptedAt: { not: null },
    },
    select: { id: true },
  });

  return employee !== null;
}
```

The query filters for:
- The right store
- The right user
- Active (`isActive: true`)
- Accepted (`acceptedAt` is not null — pending invites don't grant access)

This helper is now used by:
- Step 3 (update store) — once we expand the ownership check to include employees
- Step 11 (address CRUD)
- Step 12 (list employees)
- Future Product module (when employees can manage products)

The owner-only operations use `isStoreOwner` instead.

---

### Updating Step 3 to Use canManageStore

This is a small but important change. In Step 3 (update store), the ownership check currently looks like:

```typescript
if (store.ownerId !== userId) {
  throw new ForbiddenException('You do not have permission to edit this store');
}
```

After Step 12 is built, this should be updated to use the helper:

```typescript
const canManage = await this.canManageStore(userId, storeId);
if (!canManage) {
  throw new ForbiddenException('You do not have permission to edit this store');
}
```

This allows active employees to update store details (description, logos, contact info, bank details, etc.). The owner-only operations (submit, request go-live, manage employees) keep their stricter `isStoreOwner` checks.

---

### Controller (Step 12)

Owner-only and employee-accessible endpoints for managing the team:

```typescript
@Post(':storeId/employees')
inviteEmployee(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Body() dto: InviteEmployeeDto,
) {
  return this.storeService.inviteEmployee(user.id, storeId, dto);
}

@Get(':storeId/employees')
listEmployees(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
) {
  return this.storeService.listEmployees(user.id, storeId);
}

@Post(':storeId/employees/:employeeId/resend')
resendInvite(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('employeeId') employeeId: string,
) {
  return this.storeService.resendInvite(user.id, storeId, employeeId);
}

@Post(':storeId/employees/:employeeId/deactivate')
deactivateEmployee(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('employeeId') employeeId: string,
) {
  return this.storeService.deactivateEmployee(user.id, storeId, employeeId);
}

@Post(':storeId/employees/:employeeId/reactivate')
reactivateEmployee(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('employeeId') employeeId: string,
) {
  return this.storeService.reactivateEmployee(user.id, storeId, employeeId);
}

@Delete(':storeId/employees/:employeeId')
removeEmployee(
  @CurrentUser() user,
  @Param('storeId') storeId: string,
  @Param('employeeId') employeeId: string,
) {
  return this.storeService.removeEmployee(user.id, storeId, employeeId);
}
```

The recipient-facing endpoints are NOT under the store controller. They go in a separate controller because they're not nested under a store:

```typescript
@Controller('employees/invites')
export class EmployeeInviteController {
  constructor(private readonly storeService: StoreService) {}

  @Public() // No auth required for validation
  @Get('validate')
  validateInvite(@Query('token') token: string) {
    return this.storeService.validateInvite(token);
  }

  @Post('accept')
  acceptInvite(
    @CurrentUser() user,
    @Body() dto: AcceptInviteDto,
  ) {
    return this.storeService.acceptInvite(user.id, dto);
  }
}
```

The validate endpoint uses `@Public()` to opt out of the global JWT guard. The recipient hasn't authenticated yet at this point — they need to know what the invite is for before deciding to log in or sign up.

The accept endpoint requires authentication. By the time the recipient hits accept, they've completed the auth flow.

---

### Step 12 Error Cases

**inviteEmployee:**

| Scenario | Status Code | Message |
|---|---|---|
| Not the store owner | 403 | "Only the store owner can invite employees" |
| Store not in APPROVED/PENDING_GO_LIVE/ACTIVE | 400 | "You can only invite employees once your store has been approved" |
| Email already an active employee | 409 | "This person is already an employee of your store" |
| Email already has a pending invite | 409 | "An invite has already been sent to this email. Use the resend endpoint if needed." |
| Invalid email format | 400 | Validation error |
| Email send failure | 500 (logged) | Record is still created, owner can resend |

**validateInvite:**

| Scenario | Status Code | Message |
|---|---|---|
| Invalid token | 400 | "Invalid or expired invitation" |
| Expired token | 400 | "Invalid or expired invitation" |
| Already accepted | 400 | "Invalid or expired invitation" |

**acceptInvite:**

| Scenario | Status Code | Message |
|---|---|---|
| Invalid/expired/used token | 400 | "Invalid or expired invitation" |
| Not authenticated | 401 | "Authentication required" |
| Authenticated user's email doesn't match invite email | 400 | "This invitation was sent to a different email address. Please log in with the correct account." |

**listEmployees:**

| Scenario | Status Code | Message |
|---|---|---|
| Not authenticated | 401 | "Authentication required" |
| Not the owner or an active employee | 403 | "You do not have permission to manage this store" |

**deactivateEmployee / reactivateEmployee / removeEmployee / resendInvite:**

| Scenario | Status Code | Message |
|---|---|---|
| Not the store owner | 403 | "Only the store owner can [action] employees" |
| Employee not found | 404 | "Employee not found" |
| Employee belongs to a different store | 404 | "Employee not found" |
| Trying to deactivate an already-deactivated employee | 400 | "Employee is already deactivated" |
| Trying to reactivate an already-active employee | 400 | "Employee is already active" |
| Trying to resend an already-accepted invite | 400 | "This invitation has already been accepted" |

---

## API Endpoints Summary (Steps 11–12)

### Step 11 — Store Addresses

| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| POST | `/stores/:storeId/addresses` | Required | Owner or active employee | Add a new physical address |
| PATCH | `/stores/:storeId/addresses/:addressId` | Required | Owner or active employee | Update an address |
| DELETE | `/stores/:storeId/addresses/:addressId` | Required | Owner or active employee | Delete an address (with last-address protection for approved stores) |

### Step 12 — Employee Invitations

| Method | Path | Auth | Permission | Description |
|--------|------|------|------------|-------------|
| POST | `/stores/:storeId/employees` | Required | Owner only | Send an invite to an email |
| GET | `/stores/:storeId/employees` | Required | Owner or active employee | List all employees and pending invites |
| POST | `/stores/:storeId/employees/:employeeId/resend` | Required | Owner only | Resend invite (generates new token) |
| POST | `/stores/:storeId/employees/:employeeId/deactivate` | Required | Owner only | Revoke access without deleting |
| POST | `/stores/:storeId/employees/:employeeId/reactivate` | Required | Owner only | Restore access to a deactivated employee |
| DELETE | `/stores/:storeId/employees/:employeeId` | Required | Owner only | Permanently delete the employee record |
| GET | `/employees/invites/validate?token=xxx` | Public | None | Validate an invite token and return store info |
| POST | `/employees/invites/accept` | Required | Authenticated user | Accept an invite (links user to store) |
