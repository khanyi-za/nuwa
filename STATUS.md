# STATUS.md — Last updated 2026-06-01

## Where we are

**Mobile integration contract pass is complete.** Five mobile docs landed covering the full v1 buyer surface — auth, catalogue, cart/wishlist/addresses, checkout (incl. PayFast WebView pattern), orders + claim. Two small backend fixes shipped alongside to unblock specific mobile flows. The mobile team (Expo / React Native, in-house) can now start integrating against a written contract; the backend is ready.

- **Tests:** 558 across 33 suites, all passing in ~2.5s
- **Type check:** clean (pre-existing TS2502 in three order spec files only — harmless, documented in CLAUDE.md)
- `main` last committed: `7bc017c 1st round of front end integration, next is the mobile integration`

## Uncommitted on `main`

Smaller pile than the last STATUS — much of the previous accumulation (collections pivot, admin-read tweaks, multi-media banner, suburb field, employee-invite URL fix) was committed in `7bc017c`. Current uncommitted state, all from the mobile-integration pass:

### Code changes
- `src/store/store.controller.ts` — `GET /stores/:slug` rewired to `@Public()` + `@UseGuards(OptionalJwtAuthGuard)`; `userId` now `string | undefined` and normalised to `null` before the service call.
- `src/store/store.service.ts` — `getPublicStore(slug, userId: string | null)`: follower lookup is skipped when `userId` is null. Unauthenticated mobile buyers see `isFollowing: false` and the full profile.
- `src/store/store.service.spec.ts` (NEW) — 4 focused tests for the optional-auth path on `getPublicStore`. Was no `store.service.spec.ts` before.
- `src/order/cart/cart.controller.ts` — dropped `@UseGuards(RolesGuard)` + `@Roles(UserRole.BUYER)` at class level. JWT-only.
- `src/order/address/address.controller.ts` — same fix as cart.
- `src/order/wishlist/wishlist.controller.ts` — dropped orphaned `@Roles(BUYER)` (it had no `RolesGuard` paired, so it was already a no-op).
- `src/order/buyer-orders/buyer-orders.controller.ts` — same orphaned `@Roles(BUYER)` pattern, removed for consistency during Phase 5 audit.

### Doc changes
- `docs/Api-mobileapp-contracts/` (NEW folder, capital A) — 5 new docs:
  - `auth-flows.md` — registration, verify, login, refresh, password reset, logout, guest claim. Token storage (`expo-secure-store`), universal-link wiring, AppState foreground refresh.
  - `catalogue-flows.md` — home/discover, search, category browse, store profile, store catalogue, product detail, collection browse. Cloudinary transform recipe, FlatList pagination, skeleton states.
  - `cart-wishlist-addresses-flows.md` — three pre-checkout surfaces. Optimistic-with-rollback, undo snackbars, KeyboardAvoidingView, swipe-to-remove.
  - `checkout-flows.md` — quote, commit, PayFast WebView pattern with auto-submit HTML, return/cancel URL detection, network-failure recovery, universal-link extensions.
  - `orders-flows.md` — orders tab list + filters, order detail with status tracker + timeline, cancel flow with reason picker, post-checkout polling, guest claim entry card.
- `docs/Api-frontend-contracts/auth-module-api.md` — audience line updated to point mobile devs at the new mobile flows doc. One casing fix (lowercase `api-mobileapp-contracts` → `Api-mobileapp-contracts` to match the actual folder).

## What was completed since the last STATUS update

### Already committed in `7bc017c` (pile from earlier sessions)
- Multi-media banner (`StoreBannerMedia[]`)
- Cloudinary integration + `source=uw` signature fix
- Multi-merchant collections pivot (M10 — activation requires ≥1 collection, GET `/stores/:storeId/collections`, last-collection-on-ACTIVE rule)
- Admin GET access on products + collections (`OptionalJwtAuthGuard`-style fix at `userRole === ADMIN` short-circuit level)
- Address `suburb` field on store_addresses
- Employee invite email URL fix (`/employees/invite` → `/invites/accept`)
- PayfastClient DI export fix
- Bank-fields-owner-only and other STATUS.md follow-ups — still pending, not yet picked up

### This session (mobile integration pass, uncommitted)
1. **Phase 1 — auth flows** — buyer-mobile auth contract doc; converged on universal links instead of role-keyed URL branching (cleaner; merchant + buyer apps share `/auth/verify-email` and `/auth/reset-password` paths via universal-link claim).
2. **Phase 2 — catalogue flows** — full browse surface doc + 30-min backend fix to `GET /stores/:slug` making it public-with-optional-auth so unauthenticated mobile buyers can view store profiles.
3. **Phase 3 — cart/wishlist/addresses flows** — three-surface doc + role-gating drop so MERCHANT-role users (a merchant who also shops on mobile) aren't 403'd. Confirmed with the user this was the intended behaviour.
4. **Phase 4 — checkout flows + PayFast on mobile** — full WebView pattern documented; no backend changes needed (the commit DTO already accepts per-request returnUrl/cancelUrl that override env defaults).
5. **Phase 5 — orders flows** — list + detail + cancel + post-checkout success polling. Found and dropped an orphaned `@Roles(BUYER)` on the buyer-orders controller. Also discovered and fixed a path-prefix typo (`/buyer/orders` → `/orders`) repeated through the Phase 4 doc.

## What's next (when work resumes)

Per the post-integration roadmap, ranked by what unblocks the mobile launch path:

1. **PayFast sandbox smoke test** — manual ngrok + dev DB run-through; documented in CLAUDE.md. Still pending. Catches wire-format bugs that unit tests can't reach. Should run before any module that depends on PayFast's integration ships.
2. **Notifications module** — currently buyers get no order-confirmation emails; once mobile starts minting checkouts, this becomes urgent. Auth flows (verify, reset) already use Resend directly; this module is for transactional commerce emails (order confirmation, status updates, refund confirmation, payout statements).
3. **Shipping module** — replace `ShippingStubService` with real Courier Guy / ShipLogic. Mobile can ship on the R110 stub for v1, but real rates make checkout summary look serious. Slot in parallel with Notifications.
4. **Bank-fields owner-only authz** — Priority 1 security gap from older STATUS.md. Unrelated to mobile but still real.
5. **Smaller mobile follow-ups** flagged in the docs that we deferred:
   - `GET /buyer/orders?mPaymentId=<id>` for clean checkout-commit recovery (`checkout-flows.md §7.1`)
   - "Resume payment" endpoint to re-display PayFast form for a PENDING order (`checkout-flows.md §7.2`)
   - Multi-status filter on `GET /orders` (`orders-flows.md §6.1`)
   - Batch orders-by-numbers lookup (`orders-flows.md §6.4`)
   - `POST /auth/claim` documentation in `auth-module-api.md` (currently only documented in the mobile doc)

### Recommended sequence on resume
1. **User commits the mobile-integration pile** (the eight files in git status)
2. **PayFast sandbox smoke test** — small but high-value, validates the chain
3. **Notifications module** — biggest dependency for the mobile launch
4. **Shipping module** in parallel
5. **Bank-fields authz fix** as a low-traffic-time security cleanup

## What's fragile

(Order/payments/banner/uploads/admin-read fragility list still applies — unchanged from prior STATUS.)

Added this session:

19. **`getPublicStore` accepts `userId: string | null`**, not `string | undefined`. The controller normalises `undefined → null` before the service call. If you add another caller, pass `null` for unauthenticated paths — not undefined, not empty string. The follower lookup branch is explicit on `userId` (truthy).
20. **Role decorators on cart/wishlist/addresses/buyer-orders have been removed.** Don't re-add `@Roles(UserRole.BUYER)` to any of these without coordinating — the mobile app explicitly supports MERCHANT-role users shopping. Auth (JWT presence + ACTIVE account) is the only gate.
21. **The mobile docs reference `Api-frontend-contracts` and `Api-mobileapp-contracts` with capital A.** macOS is case-insensitive so lowercase links work locally but break on Linux deploy. One cross-folder link in `auth-module-api.md` was fixed mid-session; verify any new docs use the capital-A form.
22. **PayFast `returnUrl`/`cancelUrl` are per-request and override the env defaults** (via `req.returnUrl ?? this.config.returnUrl` in `payments.service.ts`). The mobile app passes its own universal-link URLs in `POST /checkout`; the env vars remain the defaults for the merchant web app. Don't remove this fallback — both clients depend on it.

## Backend follow-ups accumulated

(Older Priority 1/2/3 list still applies. New follow-ups from the mobile integration pass:)

### Mobile-launch follow-ups
- **`GET /orders?mPaymentId=<id>`** — surgical checkout-commit recovery (`checkout-flows.md §7.1`)
- **"Resume payment" endpoint** — re-fetch PayFast form for a PENDING order (`checkout-flows.md §7.2`)
- **Multi-status filter on `GET /orders`** — `?status=A,B,C` for the "Active" pill (`orders-flows.md §6.1`)
- **Return `orderIds` from checkout commit** (or `GET /orders?orderNumbers=A,B,C`) — avoid the number→id lookup per orderNumber on success screen (`orders-flows.md §6.4`)
- **Document `POST /auth/claim`** in `auth-module-api.md` (currently mobile-only documentation)

### Mobile push notification prerequisites (when Notifications module lands)
- `POST /me/push-tokens` (device-token registration)
- Push event delivery pipeline for order status changes
- Tracked in `orders-flows.md §6.5`

## Do not touch

(Existing list still applies.)

Added this session:

- **Do not re-add `@Roles(UserRole.BUYER)`** to `CartController`, `AddressController`, `WishlistController`, or `BuyerOrdersController`. The mobile app's auth model supports any authenticated user (including MERCHANT) shopping. JWT-only is correct.
- **Do not change `GET /stores/:slug` back to global-JWT-required.** Mobile buyers browse store profiles unauthenticated. The `OptionalJwtAuthGuard` + null-userId follower-skip is load-bearing.
- **Do not remove `req.returnUrl ?? this.config.returnUrl` fallback in `payments.service.ts`.** Mobile passes universal-link URLs per-request; the env-var default is for merchant web. Both depend on this.
- **Do not rename the `Api-mobileapp-contracts/` folder** to lowercase or any other case. Mirroring the existing `Api-frontend-contracts/` (capital A) is intentional. macOS case-insensitivity hides the issue locally; Linux deploys would 404 on lowercase links.
