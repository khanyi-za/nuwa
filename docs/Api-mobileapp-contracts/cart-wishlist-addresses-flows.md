# YIIVA Cart, Wishlist & Addresses — Mobile App Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA **buyer mobile app** on Expo / React Native.
> **Scope:** The three pre-checkout buyer surfaces — cart (multi-merchant, stock-aware), wishlist (cursor-paginated product saves), and address book (SA-validated). Mobile-specific concerns: cart badge sync, swipe-to-remove, address picker during checkout, optimistic UI for save/unsave.
>
> **Companion docs:**
> - [`auth-flows.md`](./auth-flows.md) — auth surface; this doc assumes the user is authenticated for every endpoint.
> - [`catalogue-flows.md`](./catalogue-flows.md) — what the buyer sees *before* tapping "Add to cart" or "Save".

---

## Table of Contents

1. [Context](#1-context)
2. [Available endpoints summary](#2-available-endpoints-summary)
3. [Cart flows](#3-cart-flows)
   - [3.1 Add to cart (from product detail)](#31-add-to-cart-from-product-detail)
   - [3.2 Cart screen](#32-cart-screen)
   - [3.3 Update quantity](#33-update-quantity)
   - [3.4 Remove item](#34-remove-item)
   - [3.5 Clear cart](#35-clear-cart)
   - [3.6 Anonymous cart (pre-login)](#36-anonymous-cart-pre-login)
   - [3.7 Stale-item handling on cart load](#37-stale-item-handling-on-cart-load)
4. [Wishlist flows](#4-wishlist-flows)
   - [4.1 Save (heart) from product detail or card](#41-save-heart-from-product-detail-or-card)
   - [4.2 Wishlist tab](#42-wishlist-tab)
   - [4.3 Remove from wishlist](#43-remove-from-wishlist)
5. [Address flows](#5-address-flows)
   - [5.1 Address book screen](#51-address-book-screen)
   - [5.2 Add address](#52-add-address)
   - [5.3 Edit address](#53-edit-address)
   - [5.4 Delete address](#54-delete-address)
   - [5.5 Set default](#55-set-default)
   - [5.6 Address picker during checkout](#56-address-picker-during-checkout)
6. [Known backend gaps](#6-known-backend-gaps)
7. [Mobile patterns](#7-mobile-patterns)
8. [Testing checklist](#8-testing-checklist)
9. [Endpoint cross-reference](#9-endpoint-cross-reference)

---

## 1. Context

These three surfaces are the **pre-checkout buyer state**. They share a few traits:

- **Auth-required.** Every endpoint requires a valid JWT — there is no public read or guest write.
- **One-per-user, scoped to `userId`.** No sharing, no collaboration. The mobile app is single-account-per-device.
- **Listed in the bottom tab bar** (cart + wishlist) or accessed via profile menu (addresses).

### How they interact with the rest of the flow

```
Browse (catalogue) ─► tap "Save"   ─► appears in Wishlist tab
                  └─► tap "Add to cart" ─► appears in Cart tab ─► tap "Checkout"
                                                                       │
                                                                       ▼
                                                       Address picker (from address book)
                                                                       │
                                                                       ▼
                                                         PayFast (covered in checkout-flows.md)
```

Cart, wishlist, and addresses are independent — removing a product from your wishlist doesn't affect your cart, and vice versa.

### Auth model

All three endpoints require a valid, ACTIVE-account JWT. **Any** authenticated user can call them — there is no role gate. A `BUYER` and a `MERCHANT` (a merchant who also shops) get identical access. Admins are seeded directly into the database and wouldn't reach these surfaces organically.

---

## 2. Available endpoints summary

All endpoints require a valid JWT. Authorization header: `Bearer <accessToken>`. Rate limits inherit the global 100/60s throttle.

### Cart

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/cart` | Get full cart, grouped by store, with stock-status flags |
| `POST` | `/cart/items` | Add a line (or increment if same `productId + variantId` pair exists) |
| `PATCH` | `/cart/items/:itemId` | Set absolute quantity (not delta) |
| `DELETE` | `/cart/items/:itemId` | Remove a single line |
| `DELETE` | `/cart` | Clear the entire cart |

### Wishlist

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/wishlist` | Cursor-paginated list (`?cursor=<id>&take=<n>`) |
| `POST` | `/wishlist/:productId` | Save a product. 409 if already saved. |
| `DELETE` | `/wishlist/:itemId` | Unsave (operates on the wishlist-item ID, not the product ID) |

### Addresses

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/addresses` | List the user's addresses (active only, ordered by `isDefault desc, createdAt desc`) |
| `GET` | `/addresses/:id` | Get one address |
| `POST` | `/addresses` | Create. 409 when over the 4-address cap. |
| `PATCH` | `/addresses/:id` | Update any field; setting `isDefault: true` auto-clears the previous default |
| `DELETE` | `/addresses/:id` | Soft delete (`deletedAt`). If the deleted address was default, the most recently updated remaining address inherits default. |

### Shared response shapes

**Cart** (`GET /cart` and after every mutation — they all return the full cart):

```ts
{
  stores: [
    {
      storeId: string;
      storeName: string;
      storeSlug: string;
      items: [
        {
          id: string;                // cart-item ID (use for PATCH/DELETE)
          productId: string;
          variantId: string | null;
          productTitle: string;
          productSlug: string;
          variantName: string | null;
          thumbnailUrl: string | null;
          unitPriceInCents: number;
          quantity: number;
          lineTotalInCents: number;
          status: 'available' | 'unavailable' | 'partial_stock';
          availableQuantity: number;
        }
      ];
      subtotalInCents: number;
    }
  ];
  grandSubtotalInCents: number;
  itemCount: number;            // total across all stores
}
```

Note `status` per item:
- `'available'` — full requested quantity is in stock
- `'partial_stock'` — fewer units in stock than the cart quantity; `availableQuantity` shows the ceiling
- `'unavailable'` — product / variant is no longer ACTIVE or has zero stock

**Wishlist** (`GET /wishlist`):

```ts
{
  data: [
    {
      id: string;                 // wishlist-item ID (use for DELETE)
      productId: string;
      title: string;
      slug: string;
      priceInCents: number;
      comparePriceInCents: number | null;
      thumbnailUrl: string | null;
      store: { displayName: string; slug: string };
      isAvailable: boolean;       // false if product flipped to non-ACTIVE
      addedAt: string;            // ISO 8601
    }
  ];
  nextCursor: string | null;      // pass back as ?cursor= for the next page
}
```

**Address** (returned by every address endpoint):

```ts
{
  id: string;
  label: string | null;           // e.g., "Home", "Mom's place"
  recipientName: string;
  phone: string;                  // normalised to +27XXXXXXXXX
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string;               // one of nine SA provinces
  postalCode: string;             // 4 digits
  country: string;                // "South Africa" (default)
  isDefault: boolean;
  createdAt: string;              // ISO 8601
  updatedAt: string;
}
```

---

## 3. Cart flows

### 3.1 Add to cart (from product detail)

**Entry:** the user taps the sticky **"Add to cart"** button on the product detail screen ([catalogue-flows §3.6](./catalogue-flows.md#36-product-detail)).

**Request body** — `POST /cart/items`:

```ts
{
  productId: string;
  variantId?: string;             // omit for bare-product SKUs
  quantity: number;               // min 1, no upper cap (stock is the ceiling)
}
```

**UX flow:**

1. User has picked a variant (if applicable) and chosen quantity (default 1).
2. Tap **Add to cart**. Button enters loading state: spinner + *"Adding…"*.
3. Fire the request.
4. On success: dismiss any modal, show a brief toast: *"Added to cart"* with an undo action (5s) → tap undo fires `DELETE /cart/items/:itemId` against the returned cart's matching item.
5. Update the bottom-tab cart badge to the new `itemCount` from the response.

**Authenticated callers only.** If the user is signed out when they tap, push them to `LoginScreen` with `returnTo: { screen: 'ProductDetail', params: { storeSlug, productSlug } }`. After login, restore the screen and re-show the add-to-cart action (do not auto-submit; let them tap again).

**Success path (201):** the full cart shape (see §2). Updates a global cart store (Zustand) so all subscribers — cart screen, badge, sticky checkout bar — refresh instantly.

**Error paths:**

| Response | UX |
|---|---|
| `404 "Product not available"` | Toast: *"This product is no longer available."* Refresh the product detail (it will likely 404 too). |
| `404 "Variant not available"` | Toast: *"This option is no longer available."* Re-fetch the product so variant selectors reflect current state. |
| `409 "Out of stock"` | Toast: *"Out of stock for that quantity."* Keep the screen open — user can lower the quantity or pick another variant. |
| `400` validation | Toast: *"Couldn't add to cart."* Log the validation error; this should only happen on a bug. |
| Network/5xx | Toast: *"Couldn't reach YIIVA. Check your connection."* Re-enable the button. |

**Idempotency-of-sorts:** the backend uses `@@unique([cartId, productId, variantId])` — adding the same product + variant pair a second time **increments the existing quantity**, it doesn't create a duplicate line. UX-wise this is the user's expectation, just be aware that the line ID returned will be the same as before.

---

### 3.2 Cart screen

**Entry:** bottom-tab "Cart" tab.

**API call on mount:** `GET /cart`.

**What the user sees:**

A vertically scrolling layout:

1. **Header** — *"Your cart"* + item count (e.g., *"3 items"*)
2. **Per-store sections** (one card per `stores[]` entry) — each card contains:
   - Store header: logo + `storeName` (tappable → store profile)
   - Item rows (see "Item row" below)
   - **Subtotal**: *"Subtotal: R{subtotalInCents / 100}"*
3. **Empty cart state** (when `itemCount === 0`): centered illustration + headline *"Your cart is empty"* + body *"Tap something you love."* + CTA **"Browse stores"** → Home tab
4. **Sticky bottom bar** when cart has items:
   - Left: grand subtotal *"R{grandSubtotalInCents / 100}"* + smaller *"+ R110 shipping at checkout"*
   - Right: full-width **"Continue to checkout"** button (disabled if **any** item is `unavailable` — see [§3.7](#37-stale-item-handling-on-cart-load))

**Item row layout:**

```
[thumbnail]  Product title                          [×] (top-right)
             Variant: "Red / Large"
             R249.00 × [−] 2 [+]        Total R498.00
             ⚠ Only 1 left            (yellow text, only on partial_stock)
             ⛔ Out of stock            (red text, only on unavailable)
```

- Thumbnail: 80×80 from Cloudinary (`w_200` transform)
- Quantity stepper: −/+ buttons fire `PATCH /cart/items/:itemId` ([§3.3](#33-update-quantity))
- × button: fires the swipe-to-remove flow ([§3.4](#34-remove-item))
- Tapping the row navigates to the product detail screen

**Pull-to-refresh:** re-fires `GET /cart`. Important for stock-status freshness.

---

### 3.3 Update quantity

**Entry:** user taps + or − on a cart item row.

**API call:** `PATCH /cart/items/:itemId` with `{ quantity: <new absolute value> }`.

> **Important:** quantity is the **absolute new value**, not a delta. Setting `0` is rejected (`@Min(1)` validation) — to remove, use DELETE.

**UX flow:**

1. **Optimistic update.** Immediately update the local cart store's quantity for the line; recompute `lineTotal`, `subtotal`, `grandSubtotal`, `itemCount`. The screen updates instantly.
2. Fire the request.
3. On success: replace local state with the response (canonical truth).
4. On failure: **roll back** to the pre-update state. Show an inline error chip near the item: *"Couldn't update. Tap to retry."*

**Why optimistic:** quantity steppers feel broken if every tap waits 200-500ms for a network round-trip. Mobile users tap fast; the UI must keep up.

**Error paths:**

| Response | UX |
|---|---|
| `404 "Cart item not found"` | Item was removed in another session / device. Refetch the cart; remove the stale row. |
| `409 "Out of stock"` | Roll back the quantity. Toast: *"Only {availableQuantity} in stock."* Update the row's `partial_stock` indicator. |
| `400 validation` | Roll back. Should only happen if quantity hit a UI bug. |
| Network/5xx | Retry chip on the row. |

**Debounce:** if the user mashes the + button rapidly, debounce the API call by 300ms after the last tap — fire only the final value.

---

### 3.4 Remove item

**Two trigger paths:**
- Tap the × button on the row
- Swipe-to-remove gesture (iOS-native pattern via `Swipeable`)

**API call:** `DELETE /cart/items/:itemId`.

**UX flow:**

1. **Optimistic removal** — animate the row off-screen + update local state immediately.
2. Show a snackbar at the bottom with **Undo** action (5s window). The snackbar's undo re-adds the item via `POST /cart/items` with the same productId/variantId/quantity.
3. Fire the DELETE in the background. Ignore the response unless it fails.

**Error paths:**

| Response | UX |
|---|---|
| `404 "Cart item not found"` | The item was already gone. Treat as success — no error UI. |
| Network/5xx | The row is already removed locally. Re-fire the DELETE on the next cart load (lazy retry). |

---

### 3.5 Clear cart

**Entry:** an overflow menu (⋯) in the cart header → *"Clear cart"* → confirmation dialog: *"Remove all items from your cart? This can't be undone."* + buttons [Clear] / [Cancel].

**API call:** `DELETE /cart`.

**UX flow:**

1. On confirm, show a brief loading state on the action sheet.
2. Fire request.
3. On success: dismiss the dialog, replace the screen with the empty-cart state.
4. On failure: keep the dialog open, show inline error.

This is **not** optimistic — clearing all items is destructive enough that the user benefits from the brief wait + clear confirmation.

---

### 3.6 Anonymous cart (pre-login)

The backend has no anonymous-cart concept. From `cart.controller.ts:25`: *"Anonymous carts are not persisted server-side — the frontend stashes items in `localStorage` until login and replays them."*

**Mobile equivalent:** use `AsyncStorage` (not SecureStore — cart contents aren't sensitive) to maintain a `pendingCart` array:

```ts
type PendingCartItem = { productId: string; variantId: string | null; quantity: number };
```

**Add-to-cart while signed out:**
1. The CTA on product detail says **"Sign in to add to cart"** (not *"Add to cart"*) when user is unauthenticated.
2. Tapping it pushes `LoginScreen` with `returnTo: { screen: 'ProductDetail', params: { ...productInfo, intent: 'addToCart', variantId, quantity } }`.
3. After login, the resume hook on `ProductDetailScreen` checks for `intent: 'addToCart'` and auto-fires `POST /cart/items`.

**Alternative (heavier):** stash items in `AsyncStorage` while signed out, replay all of them on login. Adds complexity (stock may have changed between save and replay; products may have been deactivated). v1 ship recommendation: skip the stash, redirect to login immediately. Add the stash later if user research shows abandonment from the friction.

---

### 3.7 Stale-item handling on cart load

The cart can contain items that became invalid since they were added:

| Backend status | Mobile rendering |
|---|---|
| `available` | Normal row, no warning |
| `partial_stock` | Yellow chip below the item: *"Only {availableQuantity} left"*. If quantity > availableQuantity, render the line at the requested quantity but in a muted state — let the user manually reduce or proceed to checkout (which will re-validate). |
| `unavailable` | Red chip *"No longer available"*. Disable the quantity stepper. Show a **Remove** action prominently. |

**Checkout button gating:** disable the **"Continue to checkout"** button if **any** item is `unavailable`. Show a helper hint: *"Remove unavailable items to continue."*

`partial_stock` items do **not** block checkout — the checkout flow will down-quantize them or surface a final-warning UI. (Behaviour locked in by the checkout flow; covered in the forthcoming `checkout-flows.md`.)

---

## 4. Wishlist flows

### 4.1 Save (heart) from product detail or card

**Entry:** the user taps a heart icon on a product card (catalogue grid) or on the product detail screen.

**API call:** `POST /wishlist/:productId`. No body.

**UX flow:**

1. **Optimistic fill.** Immediately set the heart icon to filled state.
2. Fire the request.
3. On success: keep the filled state.
4. On failure:
   - `409` (already saved): keep filled, no error toast — the user got what they wanted.
   - Other error: revert the icon to outline, show a toast: *"Couldn't save. Try again."*

**Authenticated callers only.** If signed out, redirect to `LoginScreen` with `returnTo` and a pending intent (`intent: 'wishlist'`).

**Success path (201):** the wishlist-item object (`{ id, productId, ... }`) — store the `id` in a local map keyed by `productId`. The map is what powers the heart-state lookup elsewhere in the app.

**Error paths:**

| Response | UX |
|---|---|
| `404 "Product not available"` | Toast: *"This product is no longer available."* — refresh the card list / detail. |
| `409 "Already in wishlist"` | Silent — the heart was already filled (idempotent UX). |
| Network/5xx | Revert heart, toast retry. |

---

### 4.2 Wishlist tab

**Entry:** bottom-tab "Wishlist" tab.

**API call on mount:** `GET /wishlist?take=20`.

**What the user sees:**

- **Empty state** (when `data.length === 0`): centered illustration + headline *"No saves yet"* + body *"Tap the heart on any product to save it here."* + CTA **"Browse"** → Home tab.
- **Populated:** 2-column grid of product cards (same component as catalogue grids). Each card shows:
  - Thumbnail (Cloudinary `w_400`)
  - Title (1 line, truncated)
  - Store name (muted)
  - Price (with compare-strike if applicable)
  - Removed-from-wishlist heart toggle (top-right of card)
  - Greyed-out + *"Unavailable"* overlay if `isAvailable === false`

**Pagination:** infinite scroll. On `onEndReached`, fire `GET /wishlist?cursor=<lastCursor>&take=20`. Append to the data array. Stop when `nextCursor` is `null`.

**Pull-to-refresh:** resets the cursor and re-fires from page 1.

**Tap a card:** navigate to product detail. The heart on detail will reflect the wishlist state because the local productId→itemId map is populated.

---

### 4.3 Remove from wishlist

**Two trigger paths:**
- Tap the filled heart on a wishlist card → unsave
- Tap the heart on product detail when it's already filled → unsave

**API call:** `DELETE /wishlist/:itemId`. Note: this takes the **wishlist-item ID**, not the productId. Look it up from the local map.

**UX flow:**

1. **Optimistic removal.**
   - On the wishlist tab: animate the card out of the grid. Show a snackbar with **Undo** (5s window). Undo re-fires `POST /wishlist/:productId`.
   - On product detail: just toggle the heart back to outline; no snackbar.
2. Fire the DELETE.
3. On success: 204 (no body) — keep optimistic state.
4. On failure:
   - `404`: item was already removed elsewhere — treat as success.
   - Network/5xx: revert + retry toast.

---

## 5. Address flows

### 5.1 Address book screen

**Entry:** profile menu → "Saved addresses".

**API call on mount:** `GET /addresses`.

**What the user sees:**

- **Header:** *"Your addresses"* + small helper text *"You can save up to 4 addresses."*
- **List of address cards** ordered with the default address first. Each card shows:
  - Label (if set) or first address line
  - Default badge if `isDefault` (small "Default" chip in primary color)
  - Recipient name + phone
  - Full address (lines 1-2, city, province, postalCode)
  - Edit + Delete row actions (overflow menu)
  - "Set as default" action (only on non-default addresses)
- **Add address button** at the bottom — disabled when `addresses.length >= 4` with helper text: *"Delete an address to add another."*
- **Empty state:** centered prompt + headline *"No addresses saved yet"* + body *"You'll need at least one to check out."* + CTA **"Add address"**.

---

### 5.2 Add address

**Entry:** "Add address" button on the address book screen, or "Add new address" from the checkout address picker.

**Form fields** (see DTO at `src/order/dto/create-address.dto.ts`):

| Field | Type | Rules | Mobile input |
|---|---|---|---|
| `label` | string, optional | 1-30 chars | Plain text input |
| `recipientName` | string, required | 2-100 chars | `autoComplete: name` |
| `phone` | string, required | SA format `0XXXXXXXXX` or `+27XXXXXXXXX` | `keyboardType: phone-pad`, `autoComplete: tel` |
| `addressLine1` | string, required | 1-200 chars | `autoComplete: address-line1` |
| `addressLine2` | string, optional | 0-200 chars | `autoComplete: address-line2` |
| `city` | string, required | 1-100 chars | `autoComplete: postal-address-locality` |
| `province` | enum, required | One of the 9 SA provinces | **Picker** — see below |
| `postalCode` | string, required | Exactly 4 digits | `keyboardType: number-pad`, `maxLength: 4` |
| `isDefault` | boolean, optional | Defaults to false (or true if this is the first address) | Toggle switch |

**Province picker:**

Use a native picker / bottom sheet with the nine values, in alphabetical order matching `src/order/dto/sa-provinces.ts`:

```
Eastern Cape · Free State · Gauteng · KwaZulu-Natal · Limpopo
Mpumalanga · Northern Cape · North West · Western Cape
```

Don't allow free-text entry — `@IsIn` rejects anything else with `400 "Province must be one of the 9 South African provinces."`.

**Phone formatting:**

The DTO accepts both `0821234567` and `+27821234567` and the service normalises to `+27...`. Render a small helper below the field: *"South African mobile or landline. We'll format it for you."*

**API call:** `POST /addresses` with the full DTO.

**Success path (201):**
- Returns the new address object (with `phone` normalised to `+27...`)
- Insert into the local addresses list, mark new card with a brief highlight pulse
- If `isDefault: true` was sent, clear the previous default in local state
- Navigate back (or, in checkout, auto-select the new address and proceed)

**Error paths:**

| Response | UX |
|---|---|
| `409 "You can have at most 4 addresses..."` | Replace form with empty-state message *"You've reached the 4-address limit. Delete one to add another."* + back to address book. |
| `400 "Province must be one of..."` | Inline on province field. Should be unreachable via UI since picker prevents it. |
| `400 "Phone must be a valid SA number..."` | Inline on phone field. Show example: *"e.g., 082 123 4567"*. |
| `400 "Postal code must be 4 digits."` | Inline on postal code. |
| Other `400` validation | Map to each field per the error array. |
| Network/5xx | Keep the form, toast retry. |

---

### 5.3 Edit address

**Entry:** "Edit" action on an address card.

**Same form as Add**, pre-populated with the existing address. `PATCH /addresses/:id` accepts any subset of fields.

**Behaviour quirk:** the backend rejects empty update payloads — submitting the unchanged form fires nothing client-side (compare initial vs current; if no changes, no API call, navigate back).

**API call:** `PATCH /addresses/:id` with only the changed fields.

**Success path (200):** returns the updated address. Replace the local card.

**Error paths:**

| Response | UX |
|---|---|
| `400 "No fields to update"` | Shouldn't reach this if the client-side diff check is in place. If it does, navigate back silently. |
| `404 "Address not found"` | Address was deleted in another session. Refresh address book, show toast: *"That address has been removed."* |
| Validation errors | Same as Add. |

---

### 5.4 Delete address

**Entry:** "Delete" action on an address card → confirmation dialog: *"Delete this address?"* + buttons [Delete] / [Cancel].

**API call:** `DELETE /addresses/:id`.

> **Behaviour:** soft delete (sets `deletedAt`). If the deleted address was the default, the most recently updated remaining address inherits default automatically. The mobile app doesn't need special handling — just re-render with the response state.

**UX flow:**

1. On confirm: optimistic removal from the list, plus snackbar with **Undo** (5s) — though undo here just re-adds via `POST /addresses` since the original ID is gone (soft-deleted records aren't recoverable from the API).
2. If user taps Undo within 5s: re-submit the original payload as a new address. Mention in the snackbar: *"Address restored as a new entry."*

**Error paths:**

| Response | UX |
|---|---|
| `404` | Already removed — treat as success. |
| Network/5xx | Revert the optimistic removal, retry toast. |

---

### 5.5 Set default

**Entry:** "Set as default" action on a non-default address card.

**API call:** `PATCH /addresses/:id` with `{ isDefault: true }`.

> **Backend behaviour:** setting `isDefault: true` on one address automatically clears it on whichever address was previously default — in a single transaction. The response is the updated address (now with `isDefault: true`); the *previously* default address won't be in the response. Refresh the list.

**UX flow:**

1. **Optimistic.** Immediately set the tapped card to default state in local state, clear it on the previously-default card.
2. Fire the request.
3. On success: maintain optimistic state.
4. On failure: revert both cards' default state.

---

### 5.6 Address picker during checkout

The address book screen lives at `Profile → Saved addresses`. During checkout, surface the same data in a **modal address picker**:

- Title: *"Deliver to"*
- List of saved addresses (same card layout as address book, with radio-button selection on the left)
- **Default address is auto-selected** when the picker opens
- **"+ Add new address"** row at the bottom — opens the [Add address](#52-add-address) form inline (modal-in-modal), and on save, the new address is auto-selected and the form dismisses back to the picker

The selected `addressId` is then passed to checkout commit. Covered in `checkout-flows.md` (Phase 4).

---

## 6. Known backend gaps

### 6.1 ~~`@Roles(BUYER)` blocks MERCHANT users~~ — **resolved (June 2026)**

The `@Roles(UserRole.BUYER)` decorator and the paired `@UseGuards(RolesGuard)` were dropped from `CartController`, `WishlistController`, and `AddressController`. Any authenticated user — including users with `role: MERCHANT` — can now use the cart, wishlist, and address book endpoints. The global `JwtAuthGuard` continues to enforce that a valid, ACTIVE-account JWT is present.

Bonus finding: `WishlistController` had a `@Roles(BUYER)` decorator without a paired `RolesGuard`, so it was already a no-op (and any role worked). Removed for clarity.

Mobile no longer needs to handle a role-mismatch 403 on these endpoints.

### 6.2 No "clear wishlist" endpoint — **acceptable for v1**

There's no equivalent of `DELETE /cart` for the wishlist. Mobile can iterate `DELETE /wishlist/:itemId` for each saved item if a "clear all" action is added later — but it's not in v1 UI scope.

### 6.3 No "merge anonymous cart into account cart" endpoint — **acceptable for v1**

Per [§3.6](#36-anonymous-cart-pre-login), the chosen v1 approach is to require login *before* adding to cart (no anonymous stash). If product research shows that's too much friction, a `POST /cart/merge` endpoint could be added later that accepts an array of `{ productId, variantId, quantity }` and best-effort adds each.

---

## 7. Mobile patterns

### Optimistic updates with rollback

Every mutating action in this doc is optimistic — local state changes instantly, network call happens in the background, errors trigger a rollback. The Zustand store should support:

```ts
type OptimisticUpdate = {
  apply: () => void;          // local mutation
  rollback: () => void;       // reverse of apply
  request: Promise<Response>; // network call
};

async function optimistic(update: OptimisticUpdate) {
  update.apply();
  try {
    const result = await update.request;
    return result;
  } catch (err) {
    update.rollback();
    throw err;
  }
}
```

### Undo snackbars

For destructive actions (remove cart item, delete address, unsave wishlist), show a snackbar with **Undo** for 5 seconds. The undo action re-submits the inverse operation. This converts "I tapped × by accident" anxiety into a smooth fix.

### Cart-badge sync via global store

The bottom-tab cart badge reads `itemCount` from the same Zustand store that the cart screen subscribes to. Every cart endpoint returns the full cart shape, so every mutation triggers a single store update that propagates to the badge, the cart screen, the sticky checkout bar, etc.

### Form keyboard handling

For the address form: wrap in `KeyboardAvoidingView` (iOS) + `keyboardShouldPersistTaps="handled"` on the parent `ScrollView`. The submit button needs to remain tappable while the keyboard is up. Auto-scroll the focused field into view as the keyboard opens.

### Swipe-to-remove

Use `react-native-gesture-handler`'s `Swipeable` for cart and wishlist items. Reveal a red **Delete** action on left-swipe. Animate the row off-screen on confirmed delete. Both surfaces use the same component.

### Caching strategy

- Cart: refetch on every screen mount + pull-to-refresh. Stock can change quickly; staleness is risky.
- Wishlist: cache for the session, refetch on pull-to-refresh. Wishlist changes infrequently.
- Addresses: cache for the session, refetch on pull-to-refresh or after any mutation. Addresses change very rarely.

---

## 8. Testing checklist

Test on a real device. Network conditions (cellular vs wifi) affect optimistic UX timing.

### Cart
- [ ] Add a product to cart → toast → cart badge updates → cart screen shows the line
- [ ] Add same product twice → quantity increments (no duplicate line)
- [ ] Add a product without variants → variant column shows null/blank in UI
- [ ] Add a product with variants without selecting one → CTA stays disabled
- [ ] Quantity stepper +/− updates instantly (optimistic) → matches server after API completes
- [ ] Set quantity to exceed stock → roll back + "Only N in stock" toast
- [ ] Remove an item → optimistic + undo snackbar → undo works
- [ ] Clear cart → confirmation → empty state
- [ ] Cart with a mix of available + partial_stock + unavailable items renders all three states correctly
- [ ] Checkout button is disabled when any item is unavailable
- [ ] Cart badge matches `itemCount` across tabs

### Anonymous cart
- [ ] Sign out → tap Add to cart on product detail → CTA says "Sign in to add to cart" → tapping opens LoginScreen with returnTo
- [ ] After login, returned to product detail → can tap Add to cart and it works

### Wishlist
- [ ] Heart a product from a card → optimistic fill → API confirms
- [ ] Heart same product twice → 409 silently absorbed (heart stays filled)
- [ ] Wishlist tab shows all saved items
- [ ] Infinite scroll loads next page on `?cursor=<nextCursor>`
- [ ] Empty wishlist shows empty state with browse CTA
- [ ] Unsave from wishlist → animates out → undo snackbar restores
- [ ] Unsave from product detail → heart reverts → product remains visible
- [ ] Unavailable wishlist item shows greyed overlay

### Addresses
- [ ] Add 1st address → automatically default (or `isDefault: true` if API requires it explicitly)
- [ ] Add up to 4 → 5th attempt → 409 caps message
- [ ] Phone formats normalise (`0821234567` becomes `+27821234567` in the returned object)
- [ ] Province picker enforces the nine values; free text is blocked
- [ ] Postal code accepts only 4 digits (mobile keyboard helps)
- [ ] Edit unchanged form → no API call, just navigates back
- [ ] Edit + change one field → PATCH fires with only that field
- [ ] Delete default address → another address inherits default (verify in response)
- [ ] Delete + undo within 5s → address is re-created (with a new ID)
- [ ] Set as default → previous default loses badge optimistically + API confirms
- [ ] Address picker in checkout pre-selects default + allows "Add new" inline

### General
- [ ] All flows show clear loading states on cold network
- [ ] Pull-to-refresh works on cart, wishlist, address book
- [ ] MERCHANT-role user (one who has started a store) can add to cart, save to wishlist, and add an address — no 403 (regression-check for the §6.1 fix)

---

## 9. Endpoint cross-reference

### Cart
| Endpoint | Used in |
|---|---|
| `GET /cart` | [§3.2 Cart screen](#32-cart-screen), [§3.7 Stale-item handling](#37-stale-item-handling-on-cart-load) |
| `POST /cart/items` | [§3.1 Add to cart](#31-add-to-cart-from-product-detail), undo paths in [§3.4](#34-remove-item) |
| `PATCH /cart/items/:itemId` | [§3.3 Update quantity](#33-update-quantity) |
| `DELETE /cart/items/:itemId` | [§3.4 Remove item](#34-remove-item) |
| `DELETE /cart` | [§3.5 Clear cart](#35-clear-cart) |

### Wishlist
| Endpoint | Used in |
|---|---|
| `GET /wishlist` | [§4.2 Wishlist tab](#42-wishlist-tab) |
| `POST /wishlist/:productId` | [§4.1 Save](#41-save-heart-from-product-detail-or-card), undo paths in [§4.3](#43-remove-from-wishlist) |
| `DELETE /wishlist/:itemId` | [§4.3 Remove from wishlist](#43-remove-from-wishlist) |

### Addresses
| Endpoint | Used in |
|---|---|
| `GET /addresses` | [§5.1 Address book](#51-address-book-screen), [§5.6 Address picker](#56-address-picker-during-checkout) |
| `GET /addresses/:id` | Pre-fill for [§5.3 Edit](#53-edit-address) |
| `POST /addresses` | [§5.2 Add address](#52-add-address) |
| `PATCH /addresses/:id` | [§5.3 Edit](#53-edit-address), [§5.5 Set default](#55-set-default) |
| `DELETE /addresses/:id` | [§5.4 Delete address](#54-delete-address) |
