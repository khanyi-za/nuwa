# STATUS.md — Last updated 2026-05-29

## Where we are

**Frontend integration is in progress.** The merchant Next.js app is wired against the backend; M1–M8 smoke testing has surfaced fixes across uploads, banner, payments DI, and address schema. The M10 merchant journey pivoted to collections-first; the backend just landed the three coordinated changes that unblock it, plus two follow-on admin-read tweaks for the launch-review screen.

- **Tests:** 554 across 32 suites, all passing in ~3s
- **Type check:** clean (pre-existing TS2502 in three order spec files only — harmless, documented in CLAUDE.md)
- `main` last committed: `5caac7d cloudinary integration V1` (still unchanged — the user commits this work themselves)

## Uncommitted on `main`

A meaningful pile sitting on `main` since `5caac7d`. Grouped by integration sub-cycle:

### A. Multi-media banner (M1–M8 smoke)
- `prisma/schema.prisma` — `Store.bannerUrl` removed; new `StoreBannerMedia` model + relation
- `prisma/migrations/20260526144209_multi_media_store_banner/` (NEW) — applied
- `src/store/banner-media/` (NEW) — controller, service, 2 DTOs, spec (17 tests)
- `src/store/store.module.ts` — registered BannerMediaController + Service
- `src/store/store.service.ts` — dropped bannerUrl from storeSelect; getMyStore + listPendingGoLive + getPublicStore include bannerMedia; requestGoLive validates `_count.bannerMedia` instead of `!bannerUrl`
- `src/store/dto/update-store.dto.ts` — `bannerUrl` field removed (now in `forbidNonWhitelisted` 400 territory if a client sends it)
- `src/uploads/dto/cloudinary-signature-request.dto.ts` — added `STORE_BANNER_VIDEO` enum value
- `src/uploads/uploads.service.ts` — added `store_banner_video` preset; **added `source=uw` to the signature string-to-sign** (Cloudinary widget fix)
- `src/uploads/uploads.service.spec.ts` — tests for `STORE_BANNER_VIDEO` + regression guard for `source=uw`
- Earlier in the session: `src/payments/payments.module.ts` exports `PayfastClient` (was missing — caused `UnknownDependenciesException` at boot). Comment updated in `src/order/order.module.ts`.

### B. Store address — suburb field
- `prisma/schema.prisma` — `StoreAddress.suburb String? @db.VarChar(100)` (between `buildingName` and `city`)
- `prisma/migrations/20260527100733_add_store_address_suburb/` (NEW) — applied
- `src/store/dto/create-address.dto.ts` + `update-address.dto.ts` — optional `suburb` with `@MaxLength(100)`, `@Transform` trim
- `src/store/store.service.ts` — `addAddress` plumbs `suburb` through to create

### C. Merchant collections pivot (M10)
Three coordinated changes per `docs/backend-handoffs/merchant-collections.md`:

1. **Activation requirement** — `src/product/product.service.ts` `activate()`: `_count.categories` → `_count.collections`; new error string `"Product must be in at least one collection to activate."`. The "≥1 platform category" gate is dropped; categories remain in schema and admin endpoints but no longer activation-gating.
2. **`GET /stores/:storeId/collections`** — new merchant endpoint:
   - `src/product/collection/collection.controller.ts` — `@Get()` route
   - `src/product/collection/collection.service.ts` — `listForMerchant(userId, userRole, storeId)`: returns collections with `_count.products`, ordered by `sortOrder, name`. No store-status gate. 403 (enumeration-safe) when not owner/employee.
3. **Last-collection-on-ACTIVE rule** — `src/product/collection/collection.service.ts` `removeProduct`: 400 with the handoff doc's exact message when product is `ACTIVE` and `_count.collections <= 1`.

New `src/product/collection/collection.service.spec.ts` covers all three (7 tests).

### D. Admin GET access on merchant catalogue (follow-on to C)
Two small authz tweaks per the two backend handoffs in `docs/backend-handoffs/`:

- `src/product/product.controller.ts` + `product.service.ts` — `listProducts` and `getProduct` now take `userRole`; `canManageStore` short-circuits when `userRole === UserRole.ADMIN`. Mutations untouched.
- `src/product/collection/collection.controller.ts` + `collection.service.ts` — `listForMerchant` takes `userRole`; same ADMIN short-circuit. Mutations untouched.
- New `src/product/product.service.spec.ts` (5 tests covering ADMIN bypass + non-admin 403 + MERCHANT happy path on both list and detail). `collection.service.spec.ts` extended with an ADMIN-bypass case.

### Doc changes (uncommitted)
- `docs/Api-frontend-contracts/product-module-api.md`:
  - Endpoint summary table includes `GET /stores/:storeId/collections`
  - Activation requirements rewritten: "≥1 collection" with the exact error string, plus a May 2026 note explaining the platform-category demotion
  - New endpoint section: `GET /stores/:storeId/collections` (request/response/errors)
  - `DELETE /collections/:id/products/:id` documents the new last-collection-on-ACTIVE 400
  - New "Admin read access (May 2026)" subsection covering the two products GETs **and** the collections GET
  - GET endpoint headers updated: "Owner or active accepted employee, OR any `ADMIN` user"
- `docs/Api-frontend-contracts/store-frontend-flows.md` — §7.3a banner gallery + table updates (frontend's edit)
- `docs/Api-frontend-contracts/store-module-api.md` — Banner Media section, `BannerMedia` shape, updated request-go-live (frontend's edit)
- `docs/Api-frontend-contracts/uploads-module-api.md` — `store_banner_video` in upload-contexts/authz tables; "What gets signed" explicitly includes `source=uw`
- `docs/cloudinary-setup.md` — 7th preset; "six" → "seven" throughout; shared banner folder note
- `docs/Api-frontend-contracts/store-banner-media.md` (NEW) — frontend's banner handoff
- `docs/Api-frontend-contracts/uploads-source-uw-signature.md` (NEW) — frontend's `source=uw` handoff
- `docs/backend-handoffs/` (NEW directory) — frontend's collections, admin-products, admin-collections handoffs
- `CLAUDE.md` — updates for UploadsModule patterns, banner media, useContainer, PayfastClient export rule (from earlier in the integration cycle)

## What's been completed this integration cycle

### Pre-integration (committed)
- `9a3f54a` Payments module v1
- `0a54e92` CORS config + .env.example
- `322fd86` Frontend integration docs
- `5caac7d` Cloudinary integration v1

### This integration cycle (uncommitted)
1. **Frontend smoke testing** started — auth + onboarding mostly proven
2. **PayfastClient DI boot fix** (Payments Phase 5 latent bug)
3. **Cloudinary `source=uw` signature fix** + regression guard
4. **Multi-media banner shipped** — `bannerUrl` → `StoreBannerMedia[]`, 3 new endpoints, status-aware delete protection
5. **Address `suburb` field** added end-to-end (schema, migration, DTOs, service)
6. **Merchant collections pivot (M10)** — activation requirement, new GET endpoint, last-collection-on-ACTIVE rule
7. **Admin GET access** on `GET /stores/:storeId/products` (+ `:productId`) and `GET /stores/:storeId/collections` — powers the launch-review screen catalogue strip and the per-product collection drill-down. Mutations stay locked.

## What's next (when work resumes)

### Active frontend integration
M1–M8 banner gallery + M10 merchant collections journey + admin launch-review screen are all now backend-unblocked.

### Recommended sequence on resume
1. **User commits the pile** (still uncommitted — see breakdown above)
2. **Restart backend dev server** with the latest code (`npm run start:dev`)
3. **Manual smoke tests against a running server**:
   - The handoff curl recipes for **collections pivot**, **admin-products GET**, and **admin-collections GET** — none of these have been exercised against a live server yet, only unit tests
   - Multi-media banner happy path + status-aware delete on an ACTIVE store
   - request-go-live with an empty banner gallery (expect 400)
4. **Continue M10+ smoke** — collection editor, product activation, admin launch-review screen end-to-end
5. **Rotate the Cloudinary API secret** before any production deploy (disclosed in chat earlier this session)

## What's fragile

(Order/payments/banner/uploads fragility list still applies — unchanged.)

Added this session:

16. **Admin GET short-circuit ordering matters**. In `ProductService.listProducts`/`getProduct` and `CollectionService.listForMerchant`, the `userRole === ADMIN` check **must** precede the `canManageStore` lookup — otherwise we'd do a DB hit per admin call and lose the intended cost saving. Tests assert `canManageStore` is *not* called for admins.
17. **Activation no longer requires categories**. Code paths that previously assumed every ACTIVE product has ≥1 category are now wrong. The schema-level relation still exists and the "last category on ACTIVE" rule on `DELETE /products/:id/categories/:categoryId` is preserved, but it's rarely hit in practice — ACTIVE products may now have zero categories. Don't reintroduce a category requirement in `activate()` without coordinating with the M10 merchant journey owner.
18. **`listForMerchant` has no store-status gate** (unlike the mutation endpoints in the same service). It's intentional — the merchant editor and the admin review screen both need to load collections on `DRAFT`/`PENDING_REVIEW` stores. Don't add `assertCanMutateProducts`-style status checks to read paths.

## Backend follow-ups accumulated across integration

### Priority 1 (security / correctness gaps)
- **Bank-fields owner-only authz** — both owner and employee can edit `bankName/bankAccountNo/...` via `PATCH /stores/:id`. Frontend hides the section from employees but that's a UI gate, not security. Needs a service-level role check.

### Priority 2 (UX-affecting)
- **`POST /auth/resend-verification`** — no recovery path for missed verification emails
- **`GET /auth/me/employments`** — replaces localStorage workaround for employees on returning sessions
- **Admin moderate / force-suspend endpoint** — once a store is APPROVED+, no admin endpoint reverses it; schema supports SUSPENDED
- **`StoreReview` audit table** — solves rejection-history-not-preserved + admin-action-audit
- **Chunked-upload signature endpoint** — when product video uploads ship, Cloudinary chunks files >100MB. Add `POST /uploads/cloudinary-widget-signature` accepting `paramsToSign: Record<string, unknown>`.

### Priority 3 (quality of life)
- **Structured `missing[]` array** on activation 400 (vs comma-separated string)
- **`_count.activeProducts` on `GET /stores/me`** — for go-live readiness checklist
- **`GET /stores/admin/:id`** — admin detail-screen direct-URL access
- **Batch variant-reorder endpoint**

### Operational
- **Unused-asset cleanup cron** for orphaned Cloudinary assets
- **Rotate `CLOUDINARY_API_SECRET`** before any prod deploy (disclosed in chat)
- **Migrate to a paid Cloudinary plan** when the 80% alert fires

## Do not touch

(Existing list still applies.)

Added this session:

- **Do not remove the `userRole` parameter** from `ProductService.listProducts`, `ProductService.getProduct`, or `CollectionService.listForMerchant`. The ADMIN short-circuit depends on it; controllers pass it via `@CurrentUser('role')`. Removing it silently re-locks admins out of the launch-review screen.
- **Do not add `userRole`-based bypass to any mutation method** in product/collection services. Admin write access to merchant catalogues is explicitly out of scope per both handoff docs.
- **Do not re-introduce the `≥1 platform category` activation requirement** without checking with the M10 merchant journey owner — the M10 pivot was a deliberate UX call, not a temporary state.
- **Do not put a store-status gate on `CollectionService.listForMerchant`** — the merchant editor and admin review screen need it to work on pre-ACTIVE stores.
