# YIIVA — Store Module: Consolidated Testing Plan (Step 13)

> Comprehensive three-layer testing plan covering the entire Store module — every endpoint, every edge case, every state transition.
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
  - [Step 2 — Create Store](#step-2--create-store)
  - [Step 3 — Update Store](#step-3--update-store)
  - [Step 4 — Submit Store](#step-4--submit-store)
  - [Step 5 — List Pending Stores](#step-5--list-pending-stores)
  - [Step 6 — Review Store (First Gate)](#step-6--review-store-first-gate)
  - [Step 6a — Request Go-Live](#step-6a--request-go-live)
  - [Step 6b — List Pending Go-Lives](#step-6b--list-pending-go-lives)
  - [Step 6c — Review Go-Live](#step-6c--review-go-live)
  - [Step 7 — Get My Store](#step-7--get-my-store)
  - [Step 8 — Get Public Store](#step-8--get-public-store)
  - [Step 9 — Follow / Unfollow](#step-9--follow--unfollow)
  - [Step 10 — Auth/me with Store](#step-10--authme-with-store)
  - [Step 11 — Address CRUD](#step-11--address-crud)
  - [Step 12 — Employee Invitations](#step-12--employee-invitations)
  - [Permission Helpers](#permission-helpers)
- [Layer 2 — Integration Tests](#layer-2--integration-tests)
  - [What Integration Tests Cover](#what-integration-tests-cover)
  - [The Master Happy Path](#the-master-happy-path)
  - [Rejection and Recovery Flows](#rejection-and-recovery-flows)
  - [Public Visibility Tests](#public-visibility-tests)
  - [Sub-Resource Flows](#sub-resource-flows)
  - [Authorization Matrix](#authorization-matrix)
  - [Edge Cases and Error Paths](#edge-cases-and-error-paths)
- [Layer 3 — Manual End-to-End Validation](#layer-3--manual-end-to-end-validation)
  - [Setup](#setup)
  - [The Full Manual Test Suite](#the-full-manual-test-suite)
- [Definition of Done](#definition-of-done)

---

## Context

This document is the consolidated testing plan for the entire Store module. While each step's documentation includes its own testing notes, this file brings everything together into a single reference that the implementation team can work through systematically.

The Store module is the largest module in YIIVA (after the Product module, which doesn't exist yet). It has:

- **13+ endpoints** across the main store flow, admin reviews, public profile, addresses, and employees
- **2 review gates** (PENDING_REVIEW and PENDING_GO_LIVE) with different validation rules
- **3 distinct user roles** (BUYER, MERCHANT, ADMIN) with different permissions
- **Multiple sub-resources** (addresses, employees) with their own CRUD lifecycles
- **Cross-module integration** with the auth module (for `/auth/me`) and email service (for notifications)

Testing this thoroughly is essential because the Store module is the gateway to merchant functionality. Bugs here block merchants from selling, which blocks the entire platform.

---

## Testing Philosophy

Same three-layer approach as the auth module:

**Layer 1 — Unit tests.** Mock everything (Prisma, email, JWT). Test business logic in isolation. Verify the service makes the right decisions given specific inputs and database states. Fast, deterministic, run frequently during development.

**Layer 2 — Integration tests (e2e).** Spin up the actual NestJS app with a real PostgreSQL test database. Mock only the email service. Send real HTTP requests through the full stack — controllers, validation pipes, guards, services, Prisma. Slower than unit tests but verify the whole system works together.

**Layer 3 — Manual testing.** Human walks through flows against a running instance with real database and real Resend emails. Catches things automated tests miss — actual email delivery, real user experience, network timing.

All three layers are necessary. Unit tests prove logic correctness. Integration tests prove the system is wired together correctly. Manual tests prove the experience works for actual humans.

---

## Test Setup

### Test Database

Use a separate PostgreSQL database for tests, separate from your dev database:

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
  store_employees,
  store_addresses,
  store_followers,
  stores,
  refresh_tokens,
  users
CASCADE;
```

The `CASCADE` ensures rows in dependent tables are also cleared. Run this in a `beforeEach` hook.

### Mock Configuration

In integration tests, override the Email service with a mock:

```typescript
const mockEmailService = {
  sendVerificationEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendStoreApprovalEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendStoreRejectionEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendStoreLiveEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendGoLiveRejectionEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
  sendStoreInviteEmail: jest.fn().mockResolvedValue({ id: 'mock' }),
};

const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(EmailService)
  .useValue(mockEmailService)
  .compile();
```

This gives us spy methods to verify what would have been sent without actually sending real emails.

For tests that need to extract tokens from "sent" emails (like accepting an invite), pull them from the mock:

```typescript
const inviteCall = mockEmailService.sendStoreInviteEmail.mock.calls[0];
const rawToken = inviteCall[2]; // third argument is the token
```

Disable the throttler in tests unless you're specifically testing rate limiting. Otherwise rapid sequential test requests will hit rate limits and fail.

### Test Utilities

Create shared helpers in `test/integration/store/test-utils.ts`:

```typescript
// Clean database
export async function cleanDatabase(prisma: PrismaService) {
  await prisma.$executeRaw`TRUNCATE store_employees, store_addresses, store_followers, stores, refresh_tokens, users CASCADE`;
}

// Create a verified test user
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

// Create an admin user
export async function createTestAdmin(prisma: PrismaService) {
  return createTestUser(prisma, {
    email: 'admin@test.com',
    role: 'ADMIN',
  });
}

// Get an access token for a user (calls login)
export async function getAccessToken(app: INestApplication, email: string, password = 'TestPass123') {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  return response.body.accessToken;
}

// Create a store with all required fields populated
export async function createCompleteStore(prisma: PrismaService, ownerId: string, overrides = {}) {
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

// Create a complete store ready for go-live
export async function createGoLiveReadyStore(prisma: PrismaService, ownerId: string) {
  const store = await createCompleteStore(prisma, ownerId, {
    status: 'APPROVED',
    bannerUrl: 'https://example.com/banner.png',
    story: 'Our story starts in 2019...',
  });

  // Add an address
  await prisma.storeAddress.create({
    data: {
      storeId: store.id,
      streetNumber: '42',
      streetName: 'Bree Street',
      city: 'Johannesburg',
      postalCode: '2001',
    },
  });

  // Note: 7 active products would normally be added here, but the Product model
  // doesn't exist yet. For tests, mock the product count check or use a stub.

  return store;
}
```

These utilities reduce boilerplate across tests and ensure consistency.

---

## Layer 1 — Unit Tests

### What Unit Tests Cover

Every service method gets unit tests covering:
- The happy path (valid input → expected output)
- Each error case (invalid input → expected exception)
- Edge cases (empty inputs, boundary values, unusual states)
- Side effects (database calls, email sends, transactions)

Unit tests do NOT cover:
- HTTP layer (controllers, guards, validation pipes)
- Database queries actually working (covered by integration tests)
- Real email delivery (covered by manual tests)

### Step 2 — Create Store

**Successful creation with all fields:**
- Mock `prisma.store.findUnique` returning null (no existing store)
- Mock `findUnique` for company name uniqueness (returns null)
- Mock `findUnique` for display name uniqueness (returns null)
- Mock `prisma.store.create` returning the created store
- Verify: store created with DRAFT status, ownerId from authenticated user, slug derived from displayName, optional fields preserved

**Successful creation with only required fields:**
- Same mocks but DTO has only companyName and displayName
- Verify: optional fields are null in the create call

**User already has a store (any status):**
- Mock `findUnique({ where: { ownerId } })` returning an existing store
- Verify: ConflictException with "You already have a store"
- Test with each status: DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE, SUSPENDED, CLOSED

**Company name taken:**
- Mock the company name query returning an existing store
- Verify: ConflictException with "A store with that company name already exists"

**Display name taken:**
- Mock the display name query returning an existing store
- Verify: ConflictException with "A store with that display name already exists"

**Slug generation:**
- Pass displayName "BOLD Streetwear" → verify slug is "bold-streetwear"
- Pass "Khanyi's Skincare" → verify slug is "khanyis-skincare"
- Pass "THABO & Co." → verify slug is "thabo-co"
- Pass "Lux  Essentials" (double space) → verify "lux-essentials"
- Pass "  BOLD  " (whitespace) → verify "bold"

**User role NOT changed:**
- Verify `prisma.user.update` is never called during creation
- The user remains a BUYER

**No StoreEmployee record created:**
- Verify `prisma.storeEmployee.create` is never called
- The owner is identified by ownerId, not by an employee record

### Step 3 — Update Store

**Successful single-field update:**
- Mock store found, owner matches, status is DRAFT
- Pass DTO with only `description` updated
- Verify: only `description` is changed in the update call

**Successful multi-field update:**
- Pass DTO with multiple fields
- Verify all fields are present in the update call

**Update display name regenerates slug:**
- Pass DTO with new displayName
- Verify uniqueness check is called
- Verify slug is regenerated from new display name
- Verify update includes both displayName and the new slug

**Update display name to same value:**
- Pass DTO where displayName matches current value
- Verify uniqueness check is NOT called (no need)
- Verify slug stays unchanged

**Non-owner tries to update:**
- Mock store found but ownerId doesn't match userId
- Verify ForbiddenException
- (After Step 12 is built, this should also test that an active employee CAN update)

**Store in PENDING_REVIEW:**
- Mock store found in PENDING_REVIEW status
- Verify BadRequestException (cannot edit during review)

**Store in PENDING_GO_LIVE:**
- Same as above — cannot edit during second review

**Store in SUSPENDED:**
- Verify BadRequestException

**Store in CLOSED:**
- Verify BadRequestException

**Store in DRAFT, APPROVED, or ACTIVE:**
- Each should succeed

**New company name conflicts with another store:**
- Mock company name uniqueness check returning a different store
- Verify ConflictException

**New display name conflicts:**
- Same pattern with display name

**Update after rejection clears rejectionReason:**
- Mock store in DRAFT with rejectionReason set
- Pass any update DTO
- Verify the update sets rejectionReason to null

**Empty DTO (no fields):**
- Pass empty DTO
- Verify no error, but no changes made (Prisma's update with empty data is a no-op for the data fields)

### Step 4 — Submit Store

**Successful submission:**
- Mock store with all 11 required fields populated, status DRAFT
- Verify: status updated to PENDING_REVIEW, rejectionReason cleared

**Missing one required field — description:**
- Mock store missing description
- Verify BadRequestException with "description" in the missing fields list

**Missing one required field — businessRegNo:**
- Mock store missing businessRegNo
- Verify BadRequestException with "businessRegNo" in the list

**Missing multiple required fields:**
- Mock store missing description, logoUrl, and bankName
- Verify BadRequestException listing ALL three (not just the first)

**All 11 fields present except bankAccountType:**
- Verify error message specifically mentions bankAccountType

**Non-owner tries to submit:**
- Verify ForbiddenException

**Store in PENDING_REVIEW (already submitted):**
- Verify BadRequestException with "already submitted" message

**Store in APPROVED:**
- Verify BadRequestException

**Store in ACTIVE:**
- Verify BadRequestException

**Resubmission after rejection:**
- Mock store in DRAFT with all fields and existing rejectionReason
- Verify successful submission and rejectionReason is cleared

### Step 5 — List Pending Stores

**Returns only PENDING_REVIEW stores:**
- Mock stores in DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE statuses
- Verify only PENDING_REVIEW stores are in the response

**Pagination — first page:**
- Mock 25 pending stores
- Request page 1, limit 10
- Verify 10 stores returned, meta shows total: 25, totalPages: 3

**Pagination — second page:**
- Same setup, page 2
- Verify next 10 stores

**Pagination — last page:**
- Same setup, page 3
- Verify 5 stores

**Empty queue:**
- Mock no PENDING_REVIEW stores
- Verify empty data array, total: 0, no error

**Includes owner info:**
- Verify the response includes owner's id, email, firstName, lastName, phone
- Verify NO sensitive fields (passwordHash, verificationToken, resetToken, etc.)

**Default sort order is ascending (oldest first):**
- Mock stores with different createdAt timestamps
- Verify oldest is first

**Descending sort order:**
- Pass sortOrder='desc'
- Verify newest is first

### Step 6 — Review Store (First Gate)

**Successful approval:**
- Mock store in PENDING_REVIEW with BUYER owner
- Call review with `decision: 'APPROVE'`
- Verify $transaction called
- Verify store status set to APPROVED (NOT ACTIVE)
- Verify owner role set to MERCHANT
- Verify rejectionReason set to null
- Verify approval email method called

**Store not in PENDING_REVIEW (test each status):**
- DRAFT → BadRequestException
- APPROVED → BadRequestException
- PENDING_GO_LIVE → BadRequestException
- ACTIVE → BadRequestException
- SUSPENDED → BadRequestException
- CLOSED → BadRequestException

**Store not found:**
- Verify NotFoundException

**Transaction atomicity:**
- Mock $transaction throwing
- Verify error propagated, no partial state

**Previous rejection reason cleared on approval:**
- Mock store with rejectionReason set
- Verify it's cleared after approval

**Email failure doesn't roll back:**
- Mock email service throwing
- Verify transaction still committed
- Verify error logged but not propagated

**Successful rejection:**
- Call with `decision: 'REJECT', reason: 'Logo quality needs improvement and a higher resolution image is required'`
- Verify status set to DRAFT
- Verify rejectionReason set to provided reason
- Verify owner role unchanged (still BUYER)

**Rejection without reason:**
- Verify BadRequestException

**Rejection with reason too short (< 10 chars):**
- Verify BadRequestException

**Rejection email sent:**
- Verify rejection email method called with the reason

**Authorization (BUYER, MERCHANT):**
- Both should be blocked by RolesGuard before service is called
- Test this at the integration level since RolesGuard is HTTP layer

### Step 6a — Request Go-Live

**Successful request with all requirements met:**
- Mock store in APPROVED with all 13 fields, 1 address, 7+ active products
- Verify status updated to PENDING_GO_LIVE, rejectionReason cleared

**Store not in APPROVED (test each status):**
- DRAFT, PENDING_REVIEW, PENDING_GO_LIVE, ACTIVE, SUSPENDED, CLOSED → all BadRequestException
- Verify status-specific error messages

**Not the owner:**
- Verify ForbiddenException

**Missing bannerUrl:**
- Verify BadRequestException listing bannerUrl

**Missing story:**
- Verify BadRequestException listing story

**Missing businessRegNo (was removed somehow):**
- Verify error includes businessRegNo

**Missing multiple fields:**
- Verify ALL missing fields in the error message

**No addresses:**
- Mock store with `addresses: []`
- Verify error includes "at least one store address"

**Insufficient products — 0:**
- Verify error includes "at least 7 active products (currently has 0)"

**Insufficient products — 6:**
- Verify error includes "currently has 6"

**Exactly 7 products:**
- Verify success

**Active product count excludes drafts:**
- Mock store with 5 active + 5 draft products
- Verify error mentions "currently has 5"

**Resubmission after go-live rejection:**
- Mock store in APPROVED with rejectionReason set
- Verify successful request and rejectionReason cleared

### Step 6b — List Pending Go-Lives

**Returns only PENDING_GO_LIVE stores:**
- Mock stores in various statuses
- Verify only PENDING_GO_LIVE returned

**Includes addresses and product count:**
- Verify the response includes addresses array and `_count.products`

**Pagination works:**
- Same pattern as Step 5

**Authorization (admin only):**
- Tested at integration level

### Step 6c — Review Go-Live

**Successful approval:**
- Mock store in PENDING_GO_LIVE
- Call with `decision: 'APPROVE'`
- Verify status set to ACTIVE
- Verify rejectionReason cleared
- Verify owner role unchanged (still MERCHANT)
- Verify celebratory email sent

**Store not in PENDING_GO_LIVE (test each status):**
- All return BadRequestException

**Successful rejection:**
- Call with `decision: 'REJECT', reason: 'Banner image quality is too low'`
- Verify status set back to APPROVED (NOT DRAFT)
- Verify rejectionReason set
- Verify owner role unchanged (still MERCHANT)

**Reason validation:**
- No reason → 400
- Reason < 10 chars → 400
- Reason exactly 10 chars → success

### Step 7 — Get My Store

**Owner has a store:**
- Mock findUnique returning a full store with addresses, employees, _count
- Verify all fields present including private ones (bank details, rejectionReason)

**User has no store:**
- Mock returning null
- Verify return value is null (not throwing 404)

**Includes related records:**
- Verify the Prisma query uses include with addresses, employees (filtered to active), and _count

**Sensitive fields are present:**
- Explicitly verify bankName, bankAccountNo, businessRegNo, totalRevenue are in the response

### Step 8 — Get Public Store

**Valid slug, ACTIVE store:**
- Mock returning ACTIVE store
- Verify response contains only public fields
- Verify isFollowing, locations, productCount are present

**Valid slug, DRAFT/PENDING_REVIEW/APPROVED/PENDING_GO_LIVE/SUSPENDED/CLOSED:**
- Each returns null from findFirst (because of the `status: 'ACTIVE'` filter)
- Verify NotFoundException with "Store not found"

**Invalid slug:**
- Same — NotFoundException with the same message
- Critical: same error message for "doesn't exist" and "exists but not visible"

**Public fields whitelist:**
- Verify response contains: id, displayName, slug, description, story, logoUrl, bannerUrl, websiteUrl, averageRating, followerCount, totalSales, createdAt, locations, productCount, isFollowing

**Private fields excluded:**
- Verify response does NOT contain: companyName, ownerId, contactEmail, contactPhone, businessRegNo, vatNumber, bankName, bankAccountNo, bankBranchCode, bankAccountType, rejectionReason, totalRevenue, status, updatedAt

**isFollowing true when user follows:**
- Mock storeFollower findUnique returning a record
- Verify isFollowing: true

**isFollowing false when not following:**
- Mock returning null
- Verify isFollowing: false

**Locations array derived from addresses:**
- Mock store with addresses in two cities
- Verify locations is `["Johannesburg", "Cape Town"]`

**Locations deduplicates:**
- Mock store with two addresses in same city
- Verify city appears only once

**Product count filtered to active:**
- Verify the Prisma query uses `where: { status: 'ACTIVE' }` for products

### Step 9 — Follow / Unfollow

**Follow — store not found:**
- Mock findFirst returning null
- Verify NotFoundException

**Follow — store not ACTIVE:**
- Same (the query filters to ACTIVE)

**Follow — already following:**
- Mock storeFollower findUnique returning existing record
- Verify ConflictException

**Follow — successful:**
- Verify $transaction called
- Verify storeFollower create
- Verify store update with `followerCount: { increment: 1 }`
- Verify response: `{ message, isFollowing: true }`

**Follow — own store:**
- Verify it succeeds (no special handling)

**Unfollow — store not found:**
- Verify NotFoundException

**Unfollow — not following:**
- Mock store found but no follow record
- Verify NotFoundException

**Unfollow — successful:**
- Verify $transaction called
- Verify storeFollower delete
- Verify store update with `followerCount: { decrement: 1 }`

**Transaction atomicity:**
- Mock transaction throwing → verify no partial state

### Step 10 — Auth/me with Store

**User with no store:**
- Mock prisma.user.findUnique with `include: { store: ... }` returning user with `store: null`
- Verify response includes `store: null`

**User with each store status:**
- Test DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE, SUSPENDED
- Verify response includes the 6 minimal fields each time

**Sensitive store fields excluded:**
- Verify bankName, bankAccountNo, companyName, contactEmail, etc. are NOT in the response
- Only id, displayName, slug, status, logoUrl, rejectionReason should be present

### Step 11 — Address CRUD

**addAddress:**
- Owner success
- Active employee success
- BUYER (not owner, not employee) → ForbiddenException
- Store CLOSED → BadRequestException
- Invalid input → handled by validation pipe

**updateAddress:**
- Owner success
- Active employee success
- Address not found → NotFoundException
- Address belongs to different store → NotFoundException (same message)
- Non-permitted user → ForbiddenException

**deleteAddress:**
- Owner success
- Active employee success
- Last address of APPROVED store → BadRequestException
- Last address of PENDING_GO_LIVE store → BadRequestException
- Last address of ACTIVE store → BadRequestException
- Last address of DRAFT store → success (no go-live constraint)
- Address not found → NotFoundException

### Step 12 — Employee Invitations

**inviteEmployee:**
- Owner success
- Non-owner (active employee) → ForbiddenException ("only the owner")
- Store in DRAFT → BadRequestException ("must be approved")
- Store in PENDING_REVIEW → BadRequestException
- Email already an active employee → ConflictException
- Email already has pending invite → ConflictException with different message
- Successful create → verify token generated, email sent, record created with hashed token

**validateInvite:**
- Valid token → returns store info and email
- Invalid token → BadRequestException
- Expired token → BadRequestException (same message)
- Already accepted → BadRequestException (same message)

**acceptInvite:**
- Valid token, matching email → success, userId set, acceptedAt stamped, token cleared
- Invalid token → BadRequestException
- Authenticated user's email doesn't match invite email → BadRequestException with specific message
- Already accepted token → BadRequestException

**listEmployees:**
- Owner sees all employees and pending invites
- Active employee sees the same
- Non-permitted user → ForbiddenException
- Pending invites have user: null
- Accepted employees have user info
- inviteToken and inviteExpiry NOT in the response (internal fields)

**deactivateEmployee:**
- Owner success → isActive set to false
- Non-owner → ForbiddenException
- Already deactivated → BadRequestException
- Employee not found → NotFoundException
- Employee belongs to different store → NotFoundException

**reactivateEmployee:**
- Owner success → isActive set to true
- Already active → BadRequestException

**removeEmployee:**
- Owner success → record deleted
- Non-owner → ForbiddenException
- Employee not found → NotFoundException

**resendInvite:**
- Owner success → new token generated, email sent
- Already accepted → BadRequestException
- Non-owner → ForbiddenException

### Permission Helpers

**canManageStore:**
- Store doesn't exist → false
- User is owner → true
- User is active accepted employee → true
- User is inactive employee (isActive: false) → false
- User has pending invite (acceptedAt: null) → false
- Random user → false

**isStoreOwner:**
- User is owner → true
- User is employee (active or not) → false
- User is random → false
- Store doesn't exist → false

---

## Layer 2 — Integration Tests

### What Integration Tests Cover

Integration tests run real HTTP requests through the full NestJS stack against a test PostgreSQL database. They verify:

- Routes are correctly registered
- Validation pipes catch bad input
- Guards correctly block/allow access
- Services correctly query the database
- Prisma queries actually return the expected shapes
- Transactions work as expected
- Cross-module integration works (auth + store)

These tests are slower than unit tests (each takes a few seconds) but catch issues that unit tests can miss.

### The Master Happy Path

This is the single most important integration test for the Store module. It walks through the entire store lifecycle from registration to going live. If this passes, the core flow works.

```typescript
describe('Store Module — Master Happy Path', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockEmail: any;

  beforeEach(async () => {
    // Set up app, mock email service, clean database
    // ...
  });

  it('completes the full BUYER → MERCHANT → LIVE flow', async () => {
    // 1. Register the merchant user
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'merchant@test.com',
        password: 'TestPass123',
        firstName: 'Khanyi',
        lastName: 'Mthamo',
      })
      .expect(201);

    // 2. Extract verification token from mock email
    const verifyToken = mockEmail.sendVerificationEmail.mock.calls[0][2];

    // 3. Verify email
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: verifyToken })
      .expect(200);

    let merchantToken = verifyRes.body.accessToken;

    // 4. Confirm BUYER role and no store
    let me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.role).toBe('BUYER');
    expect(me.body.store).toBeNull();

    // 5. Create store
    const createRes = await request(app.getHttpServer())
      .post('/stores')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        companyName: 'Khanyi Creative Ventures (Pty) Ltd',
        displayName: 'BOLD Streetwear',
      })
      .expect(201);

    const storeId = createRes.body.id;

    // 6. Confirm store status is DRAFT
    me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.store.status).toBe('DRAFT');

    // 7. Update with all 11 first-submission fields
    await request(app.getHttpServer())
      .patch(`/stores/${storeId}`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        description: 'Premium streetwear from Joburg',
        logoUrl: 'https://example.com/logo.png',
        contactEmail: 'hello@bold.co.za',
        contactPhone: '+27 63 448 9940',
        businessRegNo: '2024/123456/07',
        bankName: 'FNB',
        bankAccountNo: '12345678',
        bankBranchCode: '250655',
        bankAccountType: 'Cheque',
      })
      .expect(200);

    // 8. Submit for first review
    await request(app.getHttpServer())
      .post(`/stores/${storeId}/submit`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);

    // 9. Confirm status is PENDING_REVIEW
    me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.store.status).toBe('PENDING_REVIEW');

    // 10. Create admin user (manually, no admin registration endpoint)
    await prisma.user.create({
      data: {
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('AdminPass123', 12),
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        emailVerified: true,
      },
    });

    // 11. Log in as admin
    const adminLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@test.com', password: 'AdminPass123' })
      .expect(200);
    const adminToken = adminLoginRes.body.accessToken;

    // 12. Admin lists pending stores
    const pendingRes = await request(app.getHttpServer())
      .get('/stores/admin/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(pendingRes.body.data).toHaveLength(1);
    expect(pendingRes.body.data[0].id).toBe(storeId);

    // 13. Admin approves first review
    await request(app.getHttpServer())
      .post(`/stores/${storeId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    // 14. Confirm merchant role and APPROVED status
    me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.role).toBe('MERCHANT');
    expect(me.body.store.status).toBe('APPROVED');

    // 15. Verify store is NOT yet visible to buyers
    const buyerLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'merchant@test.com', password: 'TestPass123' });
    // Use a different user — register and verify another one for this
    // ... (omitting for brevity, but the test should use a separate buyer account)

    // For now, attempt with the merchant's own token (still authenticated)
    await request(app.getHttpServer())
      .get('/stores/bold-streetwear')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(404); // APPROVED stores are not yet visible

    // 16. Add banner and story
    await request(app.getHttpServer())
      .patch(`/stores/${storeId}`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        bannerUrl: 'https://example.com/banner.png',
        story: 'Our story starts in 2019 in a garage in Soweto...',
      })
      .expect(200);

    // 17. Add an address
    await request(app.getHttpServer())
      .post(`/stores/${storeId}/addresses`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        streetNumber: '42',
        streetName: 'Bree Street',
        city: 'Johannesburg',
        postalCode: '2001',
      })
      .expect(201);

    // 18. Add 7 active products (manually, since Product module doesn't exist yet)
    for (let i = 0; i < 7; i++) {
      // Skip — would normally create products via API
      // For now, this test would fail at the request-go-live step
      // until the Product module is built.
    }

    // 19. Request go-live
    await request(app.getHttpServer())
      .post(`/stores/${storeId}/request-go-live`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);

    // 20. Confirm status is PENDING_GO_LIVE
    me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.store.status).toBe('PENDING_GO_LIVE');

    // 21. Admin reviews go-live
    await request(app.getHttpServer())
      .post(`/stores/${storeId}/review-go-live`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    // 22. Confirm status is ACTIVE
    me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(me.body.store.status).toBe('ACTIVE');

    // 23. Verify store is now visible to buyers
    const publicRes = await request(app.getHttpServer())
      .get('/stores/bold-streetwear')
      .set('Authorization', `Bearer ${merchantToken}`)
      .expect(200);
    expect(publicRes.body.displayName).toBe('BOLD Streetwear');
    expect(publicRes.body.companyName).toBeUndefined(); // private field excluded
    expect(publicRes.body.bankName).toBeUndefined(); // private field excluded
  });
});
```

This single test validates Steps 2, 3, 4, 5, 6, 6a, 6c, 7, 8, 10, and 11 working together. If it passes, the spine of the Store module is solid.

### Rejection and Recovery Flows

**First-review rejection:**
1. Register, create store, fill 11 fields, submit
2. Admin rejects with reason
3. Verify store status DRAFT, rejectionReason set
4. Verify role still BUYER
5. Update store (the edit clears rejectionReason)
6. Resubmit
7. Admin approves
8. Verify role MERCHANT, status APPROVED

**Go-live rejection:**
1. Get to APPROVED status (full first-review approval flow)
2. Add banner, story, address, 7 products, request go-live
3. Admin rejects go-live with reason
4. Verify store status APPROVED (back to APPROVED, not DRAFT)
5. Verify role still MERCHANT
6. Update store to address feedback
7. Request go-live again
8. Admin approves go-live
9. Verify status ACTIVE

### Public Visibility Tests

**Visibility through the lifecycle:**
1. Create store (DRAFT) → `GET /stores/:slug` → 404
2. Submit (PENDING_REVIEW) → 404
3. Admin approves (APPROVED) → 404 (still not visible!)
4. Add fields, request go-live (PENDING_GO_LIVE) → 404
5. Admin approves go-live (ACTIVE) → 200

**Suspended store becomes invisible:**
1. Get a store to ACTIVE
2. Manually set status to SUSPENDED in database
3. `GET /stores/:slug` → 404

**Public profile excludes private fields:**
1. Get a store to ACTIVE
2. Hit public endpoint
3. Verify response contains: id, displayName, slug, description, story, logoUrl, bannerUrl, websiteUrl, averageRating, followerCount, totalSales, createdAt, locations, productCount, isFollowing
4. Verify response excludes: companyName, ownerId, contactEmail, contactPhone, businessRegNo, vatNumber, bankName, bankAccountNo, bankBranchCode, bankAccountType, rejectionReason, totalRevenue, status, updatedAt

### Sub-Resource Flows

**Address CRUD flow:**
1. Get a store to APPROVED status
2. Add address → 201 with address data
3. Update address → 200 with updated data
4. Try to delete the only address → 400 (last-address protection)
5. Add a second address
6. Delete the first → 200
7. Get store via `/stores/me` → verify only 1 address remains

**Employee invitation flow (full):**
1. Get a store to APPROVED status
2. Owner sends invite to friend@test.com
3. Verify mock email service called
4. Extract token from mock email
5. Validate token → returns store info
6. Register a new user with friend@test.com → verify email
7. Authenticated as friend, accept invite
8. Verify employee record has userId set, acceptedAt stamped
9. List employees as owner → verify friend is in the list
10. Friend (now employee) updates store description → 200
11. Friend tries to invite another employee → 403 (only owner)
12. Owner deactivates friend
13. Friend tries to update store → 403 (no longer permitted)
14. Owner reactivates friend
15. Friend can update again

**Employee with existing account:**
1. Pre-register friend@test.com (separate test setup)
2. Owner sends invite to friend@test.com
3. Validate token
4. Friend logs in (already has account)
5. Accept invite (no signup needed)
6. Verify employee record linked to existing user

**Email mismatch:**
1. Owner sends invite to alice@test.com
2. Bob (different user) gets the token somehow
3. Bob is logged in as bob@test.com
4. Bob attempts accept-invite with the token
5. Verify 400: "This invitation was sent to a different email address"

### Authorization Matrix

Test every endpoint against every role to verify access control:

| Endpoint | BUYER (no store) | BUYER (own DRAFT) | BUYER (other store DRAFT) | MERCHANT (own) | MERCHANT (other) | ADMIN |
|---|---|---|---|---|---|---|
| POST /stores | ✓ | 409 | ✓ | 409 | ✓ | ✓ |
| PATCH /stores/:id | 404 | ✓ (own) | 403 | ✓ (own) | 403 | 403 (not owner) |
| POST /stores/:id/submit | 404 | ✓ | 403 | ✓ | 403 | 403 |
| POST /stores/:id/request-go-live | 404 | 400 (DRAFT) | 403 | ✓ if APPROVED | 403 | 403 |
| GET /stores/admin/pending | 403 | 403 | 403 | 403 | 403 | ✓ |
| POST /stores/:id/review | 403 | 403 | 403 | 403 | 403 | ✓ |
| GET /stores/admin/pending-go-live | 403 | 403 | 403 | 403 | 403 | ✓ |
| POST /stores/:id/review-go-live | 403 | 403 | 403 | 403 | 403 | ✓ |
| GET /stores/me | ✓ (returns null) | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET /stores/:slug (ACTIVE store) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST /stores/:id/follow | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POST /stores/:storeId/addresses | 403 | 403 (not owner) | 403 | ✓ | 403 | 403 |
| POST /stores/:storeId/employees | 403 | 403 | 403 | ✓ (owner) | 403 | 403 |

This matrix should be implemented as a parameterized test that runs through every combination.

### Edge Cases and Error Paths

**Concurrent follow requests:**
1. Two users follow the same store at the same time
2. Verify both succeed and the count is correctly 2 (not 1 due to race condition)

**Slug collision after display name conflict:**
1. Create store with displayName "BOLD"
2. Try to create another store with displayName "B*O*L*D" (special chars that strip to "bold")
3. The displayName uniqueness check passes (different strings)
4. The slug generation produces the same slug
5. Verify the create fails with a conflict (database unique constraint catches it)

**User deletion cascades:**
1. Create user, create store, get approved
2. Delete the user from the database directly
3. Verify the store is also deleted (cascade)
4. Verify any StoreEmployee records linked to that user have userId set to null (SetNull)

**Store deletion cascades:**
1. Create store with addresses, employees, followers
2. Delete the store
3. Verify all related records are also deleted

**Email change after invite sent:**
1. Owner invites alice@test.com
2. Alice changes her account email to newalice@test.com
3. Alice clicks the invite link, validates the token
4. Alice attempts accept-invite while logged in
5. Verify the email mismatch check catches it (her current email doesn't match the invite email)

---

## Layer 3 — Manual End-to-End Validation

### Setup

Before running manual tests, you need:

1. **PostgreSQL** running locally with a `yiiva_dev` database
2. **Migrations applied:** `npx prisma migrate dev`
3. **Real `.env`** with a real `RESEND_API_KEY` (or use `onboarding@resend.dev` for development)
4. **App running** in dev mode: `npm run start:dev`
5. **Postman/Insomnia** with collections set up
6. **Real email accounts** you can check (Gmail works fine)
7. **A database GUI** (TablePlus, pgAdmin, DBeaver) for inspecting state
8. **Notepad** for tracking IDs, tokens, and state across multi-step flows

### The Full Manual Test Suite

**Setup users:**
- Register 3 user accounts: merchant1@gmail.com, merchant2@gmail.com, friend@gmail.com
- Verify all 3 emails (click links, check responses)
- Log in to each, save access tokens
- Manually create an admin user via SQL: `UPDATE users SET role = 'ADMIN' WHERE email = 'admin@gmail.com';`

**Test 1 — Create store (Step 2):**
- POST /stores as merchant1 with companyName and displayName
- Verify 201, response includes the store with status DRAFT
- Check database: ownerId matches, slug is correct, role is still BUYER
- Try POST /stores again → 409
- Try POST /stores as merchant2 with same displayName → 409
- Try POST /stores as merchant2 with same companyName → 409

**Test 2 — Update store (Step 3):**
- PATCH /stores/:id with description, story, logoUrl
- Verify 200, fields updated
- Try editing without auth → 401
- Try editing merchant1's store as merchant2 → 403
- Try setting status via PATCH → status field is ignored (whitelisted out)

**Test 3 — Submit for review (Step 4):**
- Try submitting before all required fields → 400 with list of missing fields
- Add missing fields, submit again → 200
- Verify status is PENDING_REVIEW
- Try editing while PENDING_REVIEW → 400

**Test 4 — Admin pending queue (Step 5):**
- Log in as admin
- GET /stores/admin/pending → verify merchant1's store appears
- Try as merchant1 → 403

**Test 5 — Admin approves first review (Step 6):**
- POST /stores/:id/review with `{ decision: 'APPROVE' }` as admin
- Check database: store status is APPROVED, merchant1 role is MERCHANT
- Check email inbox: approval email received
- GET /auth/me as merchant1 → role is MERCHANT, store.status is APPROVED
- GET /stores/:slug → 404 (not yet visible)

**Test 6 — Add banner, story, address:**
- PATCH /stores/:id with bannerUrl and story
- POST /stores/:id/addresses with full address fields
- Verify all updates persist

**Test 7 — Try go-live without products:**
- POST /stores/:id/request-go-live → 400 with "currently has 0 active products"

**Test 8 — Admin go-live review (Step 6c):**
- (Skip the products requirement temporarily for testing — manually set the count check or stub it)
- Manually update status: `UPDATE stores SET status = 'PENDING_GO_LIVE' WHERE id = '<store-id>';`
- Log in as admin, GET /stores/admin/pending-go-live → verify store appears
- POST /stores/:id/review-go-live with APPROVE
- Check database: status is ACTIVE
- Check email: celebratory email received
- GET /stores/:slug as merchant2 → 200 with public profile (now visible!)
- Verify response excludes companyName, bank details, contactEmail

**Test 9 — Public profile (Step 8):**
- GET /stores/:slug as merchant2
- Verify isFollowing is false
- Verify locations array shows just the city ("Johannesburg")
- Verify productCount is 0 (or whatever the actual count is)

**Test 10 — Follow/unfollow (Step 9):**
- POST /stores/:id/follow as merchant2 → 200
- Check database: store_followers row exists, store followerCount is 1
- GET /stores/:slug as merchant2 → isFollowing: true
- Try following again → 409
- DELETE /stores/:id/follow → 200
- Check database: row deleted, count back to 0

**Test 11 — Get my store (Step 7):**
- GET /stores/me as merchant1 → full store with bank details, addresses
- GET /stores/me as merchant2 → null (no store)

**Test 12 — Auth/me with store (Step 10):**
- GET /auth/me as merchant1 → store object with the 6 minimal fields
- Verify bank details NOT in the response
- GET /auth/me as merchant2 → store: null

**Test 13 — Address CRUD (Step 11):**
- POST /stores/:storeId/addresses with new address → 201
- PATCH /stores/:storeId/addresses/:addressId with new street name → 200
- DELETE /stores/:storeId/addresses/:addressId → 400 if last address (when ACTIVE)
- Add a third address → DELETE first one → 200
- Try as merchant2 → 403

**Test 14 — Employee invitations (Step 12):**
- POST /stores/:storeId/employees with email friend@gmail.com as merchant1 → 201
- Check email inbox of friend@gmail.com → invite email received
- Click invite link → frontend should call validate endpoint
- GET /employees/invites/validate?token=xxx → returns store info
- POST /employees/invites/accept as friend (already logged in) with the token
- Verify employee record linked to friend's user
- GET /stores/:storeId/employees as merchant1 → friend appears in list
- PATCH /stores/:id with new description as friend → 200 (employee can edit)
- POST /stores/:storeId/employees as friend → 403 (only owner can invite)
- Owner deactivates friend → friend can't edit anymore
- Owner reactivates → friend can edit again
- Owner removes friend → record deleted

**Test 15 — Edge cases:**
- Try accepting an invite with the wrong account (different email) → 400
- Try accepting an expired invite → 400
- Try following a SUSPENDED store → 404
- Try editing a store while it's PENDING_REVIEW → 400
- Try requesting go-live for a store that's already PENDING_GO_LIVE → 400

---

## Definition of Done

The Store module is considered complete and ready for production when:

1. **All unit tests pass** with full coverage of happy paths and error cases
2. **The master happy path integration test passes** (Test 1 in Layer 2)
3. **All rejection and recovery flow integration tests pass**
4. **All authorization matrix tests pass** for every endpoint and role combination
5. **All edge case integration tests pass**
6. **Manual end-to-end testing has been completed** end-to-end for at least one full lifecycle (register → create → submit → approve → go-live)
7. **Real email delivery has been verified** with at least one approval email and one rejection email arriving in a real inbox
8. **No sensitive data leaks** in any endpoint response (bank details, tokens, passwords, etc.)
9. **The two-gate review system works correctly** — APPROVED stores are NOT visible to buyers, only ACTIVE stores are
10. **Documentation matches implementation** — API endpoints, error messages, and field requirements are consistent across the code and the markdown docs

When all of these are true, the Store module is ready for the next phase: building the Product module (which depends on the Store module being complete).
