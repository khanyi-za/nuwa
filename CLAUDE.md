# CLAUDE.md — YIIVA Nuwa API

You are working on **Nuwa**, the backend API for YIIVA — a South African commerce marketplace connecting local merchants (clothing, home, accessories) with buyers. NestJS 11 + Prisma 7 + PostgreSQL. TypeScript. Jest for tests.

## What this project does

YIIVA is a multi-merchant marketplace. Merchants create stores, list products, and fulfill orders. Buyers browse across stores, build multi-brand carts, and check out in a single transaction. YIIVA handles payments (PayFast), shipping (The Courier Guy), and takes a 5.5% commission on subtotals.

The API serves a Next.js frontend (separate repo). This is the backend only.

## Architecture

### Module dependency graph

```
AppModule
 ├── AuthModule        — JWT auth, registration, login, password reset, account claim
 ├── StoreModule       — Store CRUD, admin review, employee invites, store addresses
 ├── ProductModule     — Products, variants, images, collections, tags, categories
 ├── OrderModule       — Cart, checkout, orders (buyer + merchant views), addresses
 ├── PrismaModule      — Database singleton (global)
 ├── EmailModule       — Transactional email via Resend
 └── ConfigModule      — Environment variables (global)
```

**Key dependency rules:**
- OrderModule imports StoreModule + ProductModule directly.
- OrderModule consumes Payments and Shipping via **injection-token contracts** (`PAYMENT_SERVICE`, `SHIPPING_SERVICE`). Stubs are bound until those modules ship. Swap `useClass` in `order.module.ts` — zero consumer code changes.
- No circular dependencies. If Payments/Shipping later need Order, they import OrderService directly.
- PrismaModule is global — every module injects PrismaService without importing PrismaModule.

### Why it's structured this way

Each module owns its own controllers, services, DTOs, and specs. Sub-features within a module get their own subdirectory (e.g., `order/cart/`, `order/checkout/`, `order/merchant-orders/`). This keeps feature boundaries clear and allows parallel development.

The contract/stub pattern for Payments and Shipping lets the full checkout flow be coded and tested end-to-end without those modules existing. When they ship, only the module-level binding changes.

### Global middleware and guards

- **ValidationPipe** (global, `main.ts`): `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. DTOs use class-validator decorators.
- **JwtAuthGuard** (global APP_GUARD): Every route requires JWT unless decorated with `@Public()`. Handles `TokenExpiredError` vs `JsonWebTokenError` distinctly for frontend silent-refresh flow.
- **ThrottlerGuard** (global APP_GUARD): 100 requests per 60 seconds.

### Auth flow

JWT access tokens (15m) + refresh tokens (7d, httpOnly cookie, single-use rotation, stored hashed in DB). `@Public()` bypasses JWT guard. `@Roles(UserRole.MERCHANT)` for role-based access. `@CurrentUser()` injects `request.user`. `OptionalJwtAuthGuard` for endpoints that serve both authenticated and guest users (checkout).

## Conventions and patterns — follow these exactly

### File naming

```
feature.controller.ts      — route handlers
feature.service.ts         — business logic
feature.service.spec.ts    — unit tests (co-located with service)
feature.dto.ts             — input validation (in dto/ subdirectory)
feature.module.ts          — NestJS module declaration
```

### Error handling

- **404-not-403**: When a resource exists but the user doesn't own it, throw `NotFoundException`, not `ForbiddenException`. Prevents enumeration attacks. Used everywhere: addresses, orders, cart items.
- **ConflictException (409)**: Duplicate data, stock race, email collision.
- **BadRequestException (400)**: Validation failures, invalid state transitions.
- **ForbiddenException (403)**: Only for account-level issues (suspended, wrong role). Never for resource ownership.
- **InternalServerErrorException (500)**: Only for truly unexpected failures (PayFast timeout, order number collision exhaustion).

### Testing patterns

Every service gets a spec file. Follow this exact structure:

```typescript
// 1. Fixtures at top (const, not let)
const USER_ID = 'user-1';
const baseProduct = { id: 'prod-1', ... };

// 2. Mock objects (full Prisma mock with nested methods)
const mockPrisma = {
  order: { findMany: jest.fn(), findUnique: jest.fn(), ... },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

// 3. TestingModule in beforeEach
beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      ServiceUnderTest,
      { provide: PrismaService, useValue: mockPrisma },
    ],
  }).compile();
  service = module.get(ServiceUnderTest);
  jest.clearAllMocks();
});

// 4. Describe blocks organized by method
describe('ServiceName', () => {
  describe('methodName', () => {
    it('does the expected thing', async () => { ... });
    it('throws 404 when not found', async () => { ... });
  });
});
```

- Always `jest.clearAllMocks()` in `beforeEach`.
- Use `mockResolvedValue` / `mockResolvedValueOnce` for Prisma mocks.
- For `$transaction`, re-bind after `clearAllMocks`: `mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma))`.
- Mock external modules with `jest.mock()` at module level when needed (e.g., stock.ts).
- Run tests with `npx jest --no-coverage`. Full suite should pass in <3s.

### Database patterns

- **Prisma client** for all queries. Raw SQL (`$executeRaw`) only for atomic stock operations in `src/order/cart/stock.ts`.
- **Transactions** (`$transaction`) for multi-step writes that must be atomic (stock + cart, order creation + payment group).
- **Never put HTTP calls inside a DB transaction.** The checkout flow does TX1 (create orders) → HTTP (PayFast) → TX2 (clear cart) or TX3 (rollback).
- **Selective queries**: Always use `select` to avoid loading sensitive fields (passwordHash, tokens). Never `findUnique` without narrowing the return shape when it includes sensitive data.
- **Soft deletes**: Addresses use `deletedAt`. Filter with `where: { deletedAt: null }`.

### Store ownership

`StoreService.canManageStore(userId, storeId)` returns true if user is store owner OR active accepted employee. Used by both StoreModule endpoints and OrderModule's merchant-orders. Already exported from StoreModule and imported by OrderModule.

### Shipping and payments

- **Shipping**: Flat R110 per checkout. Lives on `PaymentGroup.shippingInCents`, NOT on individual Orders. `Order.shippingInCents = 0` always. YIIVA pays The Courier Guy directly — merchants never handle shipping money.
- **Commission**: 5.5% of subtotal only (shipping not commissionable). Locked on `Payment` row at order creation time.
- **PaymentGroup**: One PayFast transaction covering N orders. `amountGrossInCents = grandSubtotal + shipping`.
- **Payment**: Per-order slice. `amountGrossInCents = store subtotal` (no shipping). `merchantPayoutInCents = subtotal - commission`.

### Stock model

Independent SKU: bare product has `totalStock`/`reservedStock`, each variant has its own `stock`/`reservedStock`. They are NOT aggregated — a product with variants uses variant stock; a product without variants uses product stock. Stock operations route based on whether `variantId` is null.

- **Reserve**: Optimistic conditional UPDATE (`WHERE reservedStock + delta <= totalStock`). Throws `ConflictException` on race.
- **Release**: Unconditional UPDATE with `GREATEST(0, reservedStock - delta)` floor.
- Cart-add reserves stock. Cart-remove releases stock. Checkout does NOT re-reserve for authenticated buyers (already reserved). Guest checkout reserves in the commit transaction.

### Cursor-based pagination

Used in merchant-orders and buyer-orders. Pattern: fetch `take + 1` rows, if `length > take`, trim to `take` and set `nextCursor` to last item's ID.

### DTOs

All DTOs live in the module's `dto/` subdirectory. Use class-validator decorators. Enums defined in DTO files when they're DTO-specific (e.g., `CancelReason`, `BuyerCancelReason`). Prisma enums used directly when they match (e.g., `OrderStatus`).

## Key files and directories

```
prisma/
  schema.prisma                    — ALL models, enums, relations. Read this first.
  migrations/                      — Chronological SQL migrations
  seed.ts                          — Admin user seeding

src/
  main.ts                          — Bootstrap, global ValidationPipe
  app.module.ts                    — Root module, all imports, ThrottlerGuard

  auth/
    auth.service.ts                — Register, login, verify, refresh, password reset
    guards/jwt-auth.guard.ts       — Global JWT guard with @Public() bypass
    guards/optional-jwt-auth.guard.ts — For checkout (auth + guest)
    decorators/public.decorator.ts — @Public() decorator
    decorators/roles.decorator.ts  — @Roles() decorator
    claim/claim.service.ts         — Guest account claiming (scaffold)

  store/
    store.service.ts               — Store CRUD, canManageStore, employee management
    store.module.ts                — Exports StoreService

  product/
    product.service.ts             — Product CRUD, merchant + buyer views
    variant/variant.service.ts     — Variant CRUD
    image/image.service.ts         — Image management

  order/
    order.module.ts                — Registers all sub-features, contract bindings
    contracts/
      payment-contract.ts          — IPaymentService interface + PAYMENT_SERVICE token
      shipping-contract.ts         — IShippingService interface + SHIPPING_SERVICE token
      stubs/                       — Deterministic stub implementations
    cart/
      cart.service.ts              — Cart CRUD, stock reservation
      stock.ts                     — reserveStock/releaseStock (raw SQL)
    checkout/
      checkout.service.ts          — Quote + commit (multi-order, PayFast, guest)
      totals.ts                    — Pure computation (group by store, commission)
    merchant-orders/
      merchant-orders.service.ts   — List, detail, status transitions, cancel
    buyer-orders/
      buyer-orders.service.ts      — List, detail, buyer cancel
    address/
      address.service.ts           — Buyer address CRUD (soft delete)
    dto/                           — All order-related DTOs
    utils/
      order-number.ts              — YV-YYYY-XXXXXX generator
      phone.ts                     — SA phone normalization (+27...)

docs/
  order-module/
    order-module-foundation.md     — ALL phase decisions, schema changes, architecture
```

## Database schema (key models)

Read `prisma/schema.prisma` for the full schema. Key models:

- **User** — BUYER/MERCHANT/ADMIN, isGuestAccount flag, auth tokens
- **Store** — DRAFT→PENDING_REVIEW→APPROVED→PENDING_GO_LIVE→ACTIVE lifecycle
- **Product** — DRAFT/ACTIVE/OUT_OF_STOCK/ARCHIVED, independent stock per bare+variant
- **Cart/CartItem** — One cart per user, lazy-created on first add
- **Order** — One per store per checkout. Status: PENDING→CONFIRMED→PROCESSING→READY_FOR_DISPATCH→DISPATCHED→DELIVERED
- **OrderItem** — Snapshot of product details at order time
- **PaymentGroup** — One PayFast transaction, covers N orders. Holds shippingInCents.
- **Payment** — Per-order slice with commission math. One-to-one with Order.
- **Address** — Buyer delivery addresses, soft delete, max 4, one default

## Constraints and limitations

- **No CORS config** — needs to be added before frontend integration.
- **No e2e tests** — only unit tests exist. `test/` directory has config but no test files.
- **Pre-existing TS2502 errors** in 3 spec files (address, cart, checkout) from `$transaction` mock pattern. These don't affect test execution — Jest uses ts-jest which is more lenient.
- **No rate limiting per-endpoint** — only global throttle (100/60s).
- **Payments and Shipping are stubs** — `PaymentStubService` and `ShippingStubService` return deterministic fake data. Real integrations not yet built.
- **Guest account claim has no email verification** — stubbed with `emailVerified: true`. Needs Notifications module.
- **No image upload** — ProductImage stores URLs, actual upload mechanism not implemented.
- **noImplicitAny: false** in tsconfig — some untyped code exists (controller `@Req() req: any`).

## Order module phase status

The order module is built in 10 phases. Track progress in `docs/order-module/order-module-foundation.md`.

| Phase | Name | Status |
|-------|------|--------|
| 1 | Foundation (schema, stubs, scaffolding) | Complete |
| 2 | Address Management | Complete |
| 3 | Cart (CRUD, stock reservation) | Complete |
| 4 | Checkout (quote, commit, guest, PayFast) | Complete |
| 5 | Merchant Order Management | Complete |
| 6 | Buyer Order Views + Guest Claim | Complete |
| 7 | Admin Order Views | Not started |
| 8 | Cron: Cart & Stock Cleanup | Not started |
| 9 | Wishlist | Not started |
| 10 | Consolidated Testing | Not started |

## Commands

```bash
npx jest --no-coverage              # Run all tests (~2s)
npx jest --testPathPatterns="cart"   # Run tests matching pattern
npx tsc --noEmit                    # Type check (expect 3 pre-existing TS2502 in specs)
npx prisma generate                 # Regenerate Prisma client after schema changes
npx prisma migrate dev              # Apply pending migrations
npm run start:dev                   # Dev server with hot reload
```

## Session Protocol

Always read `STATUS.md` at the start of every session. Before a session ends, when asked to do a handoff, update `STATUS.md` — not this file.

`STATUS.md` tracks: what was just completed, what's in progress, uncommitted changes, and the immediate next step. This file (`CLAUDE.md`) is the stable reference — only update it when conventions, architecture, or project-wide patterns change.

If `STATUS.md` doesn't exist yet, create it on first handoff request.
