# YIIVA Orders — Mobile App Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA **buyer mobile app** on Expo / React Native.
> **Scope:** The post-checkout buyer surface — orders tab list, order detail (with status tracker + timeline), buyer-initiated cancel, and the post-checkout success → first order view → claim-account handoff. Mobile-specific patterns: status pill colors, timeline rendering, optimistic cancel, pull-to-refresh polling for in-transit orders.
>
> **Companion docs:**
> - [`auth-flows.md`](./auth-flows.md) — guest account claim (§4.8) is reached from the post-checkout success flow described here.
> - [`checkout-flows.md`](./checkout-flows.md) — the checkout success screen (§4.6) navigates *into* the surfaces documented here.
> - [`cart-wishlist-addresses-flows.md`](./cart-wishlist-addresses-flows.md) — the cart screen is the typical *exit point* from this surface (re-order, browse).

---

## Table of Contents

1. [Context](#1-context)
2. [Available endpoints summary](#2-available-endpoints-summary)
3. [Order status state machine](#3-order-status-state-machine)
4. [Screen-level flows](#4-screen-level-flows)
   - [4.1 Orders tab — list](#41-orders-tab--list)
   - [4.2 Order detail](#42-order-detail)
   - [4.3 Cancel order](#43-cancel-order)
   - [4.4 Post-checkout success → first order detail](#44-post-checkout-success--first-order-detail)
   - [4.5 Guest claim entry from post-checkout](#45-guest-claim-entry-from-post-checkout)
5. [Mobile patterns](#5-mobile-patterns)
6. [Known gaps and considerations](#6-known-gaps-and-considerations)
7. [Testing checklist](#7-testing-checklist)
8. [Endpoint cross-reference](#8-endpoint-cross-reference)

---

## 1. Context

Orders are the buyer's record of what they've purchased. Each row in the database represents **one Order per store per checkout**, so a single PayFast payment can produce multiple orders if the cart spanned multiple merchants.

### What the buyer can do here

| Action | Endpoint | Status gate |
|---|---|---|
| See all their orders, filtered/searched/paginated | `GET /orders` | Any |
| See the full detail of one order — items, status, timeline, shipping address | `GET /orders/:orderId` | Any |
| Cancel their own order before the merchant ships it | `POST /orders/:orderId/cancel` | Only `PENDING` or `CONFIRMED` |

That's the full buyer-facing orders surface. Refunds, returns, and disputes are not yet wired buyer-side — see [§6](#6-known-gaps-and-considerations).

### Auth model

All three endpoints require a valid, ACTIVE-account JWT. **Any** authenticated user can call them. Ownership is enforced service-side: `order.userId !== currentUserId` returns `404 "Order not found"` (404-not-403 to prevent enumeration).

### Why guests can't see their orders

Guests have no auth session — they completed checkout without signing in. To see their order, they must either:
1. Use the order confirmation email's link (a separate web flow, owned by the web team) **or**
2. Complete the [claim-account flow](./auth-flows.md#48-guest-checkout--claim-account) to convert their guest account into a real one, then sign in

The mobile app prioritises path 2 — surfaces a prominent **"Save my account"** CTA on the post-checkout success screen. See [§4.5](#45-guest-claim-entry-from-post-checkout).

---

## 2. Available endpoints summary

All endpoints require `Authorization: Bearer <accessToken>`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/orders` | Cursor-paginated list, filterable by status, searchable by order number |
| `GET` | `/orders/:orderId` | Full order detail |
| `POST` | `/orders/:orderId/cancel` | Cancel a `PENDING` or `CONFIRMED` order with a reason |

### `GET /orders`

**Query parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `status` | enum | — | One of the `OrderStatus` values. Omit for "all". |
| `search` | string | — | Substring match (case-insensitive) on `orderNumber`. Useful when buyer has a long history. |
| `cursor` | string | — | Order ID from the previous page's `nextCursor`. Omit for page 1. |
| `take` | string | `"20"` | Page size. Min effective 1, max 50 (clamped server-side). |

**Response (200):**

```ts
{
  orders: [
    {
      id: string;                  // order ID — use this for detail + cancel calls
      orderNumber: string;         // human-readable e.g., "YV-2026-AB12CD"
      status: OrderStatus;         // see §3
      storeName: string;
      subtotalInCents: number;
      totalInCents: number;
      itemCount: number;
      placedAt: string;            // ISO 8601
    }
  ];
  nextCursor: string | null;       // pass back as ?cursor= for next page; null when done
}
```

Newest first (`placedAt desc`).

### `GET /orders/:orderId`

**Response (200):**

```ts
{
  id: string;
  orderNumber: string;
  status: OrderStatus;
  storeName: string;
  storeSlug: string;
  subtotalInCents: number;
  shippingInCents: number;          // always 0 on Order rows — shipping lives on PaymentGroup
  discountInCents: number;
  totalInCents: number;
  notes: string | null;             // buyer's checkout notes
  cancelReason: string | null;      // populated on cancelled orders (format described in §4.3)
  timeline: {
    placedAt: string;               // ISO 8601 — never null
    confirmedAt: string | null;     // set when PayFast ITN COMPLETED arrives
    dispatchedAt: string | null;    // set when merchant marks DISPATCHED
    deliveredAt: string | null;     // set when merchant marks DELIVERED
    cancelledAt: string | null;     // set on any cancellation path
  };
  shippingAddress: {
    recipientName: string;
    phone: string;                  // +27XXXXXXXXX (normalised)
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    province: string;
    postalCode: string;
    country: string;                // "South Africa"
  };
  items: [
    {
      id: string;
      productId: string;
      variantId: string | null;
      productTitle: string;
      variantName: string | null;
      productImageUrl: string | null;
      quantity: number;
      unitPriceInCents: number;
      totalInCents: number;
    }
  ];
  paymentStatus: PaymentStatus | null;   // PENDING / COMPLETED / FAILED / PARTIALLY_REFUNDED / REFUNDED / CANCELLED / RECONCILE_REQUIRED
}
```

**Notes:**
- `shippingInCents` is always 0 on individual Order rows because shipping is collected once per PaymentGroup (the cross-merchant payment envelope), not per Order. The mobile app should not show this field. The R110 the buyer paid lives on the PaymentGroup (not exposed buyer-side in v1).
- `paymentStatus` is `null` if the order has no Payment row — this should not happen in normal flows but the type accommodates it.
- Items are an order-time snapshot — `productTitle` etc. reflect what was in the catalogue when the order was placed, even if the product was renamed since.

**Errors:**

| Status | Message | Cause |
|---|---|---|
| `404 "Order not found"` | Order doesn't exist, or `order.userId` doesn't match the caller (enumeration prevention) |

### `POST /orders/:orderId/cancel`

**Request body:**

```ts
{
  reason: "CHANGED_MIND" | "ORDERED_BY_MISTAKE" | "FOUND_CHEAPER" | "OTHER";
  notes?: string;                   // optional, max 500 chars
}
```

When `reason === "OTHER"` and `notes` is provided, the backend stores `OTHER: {notes}` in `cancelReason`. For other reasons, only the enum value is stored. (See the cancel-reason prefix convention in CLAUDE.md.)

**Response (200):**

```ts
{
  id: string;
  status: "CANCELLED";
}
```

**Errors:**

| Status | Message | Cause |
|---|---|---|
| `404 "Order not found"` | As above |
| `400 "Cannot cancel an order in {STATUS} status. Please contact the merchant."` | Order is past `CONFIRMED` (PROCESSING / READY_FOR_DISPATCH / DISPATCHED / IN_TRANSIT / DELIVERED) or already in a terminal state |
| `400` validation | Bad reason enum or oversized notes |

---

## 3. Order status state machine

The buyer sees these statuses on every order. Mobile renders each with a distinct chip color + icon.

```
PENDING ────────► CONFIRMED ──► PROCESSING ──► READY_FOR_DISPATCH
   │                  │                              │
   │                  │                              ▼
   │                  │                          DISPATCHED ──► IN_TRANSIT ──► DELIVERED
   │                  │
   ▼                  ▼
CANCELLED         CANCELLED / REFUND_REQUESTED / REFUNDED
(SYSTEM:PAYMENT_*)
```

### Status → buyer-facing label, color, and copy

| Status | Buyer label | Chip color | Helper copy |
|---|---|---|---|
| `PENDING` | *"Awaiting payment"* | amber | *"We're confirming your payment. This usually takes under a minute."* |
| `CONFIRMED` | *"Order confirmed"* | emerald | *"The merchant has received your order and is preparing it."* |
| `PROCESSING` | *"Being prepared"* | emerald | *"The merchant is packing your order."* |
| `READY_FOR_DISPATCH` | *"Ready for collection"* | emerald | *"Waiting to be picked up by The Courier Guy."* |
| `DISPATCHED` | *"Dispatched"* | blue | *"Your order has been handed to The Courier Guy."* |
| `IN_TRANSIT` | *"In transit"* | blue | *"On its way to you."* |
| `DELIVERED` | *"Delivered"* | green | *"Your order has been delivered."* + delivery date |
| `CANCELLED` | *"Cancelled"* | grey | Show `cancelReason` interpretation — see "Cancel reason rendering" below |
| `REFUND_REQUESTED` | *"Refund being processed"* | grey | *"A refund is being processed for this order."* |
| `REFUNDED` | *"Refunded"* | grey | *"This order was refunded."* |

### Cancel reason rendering

The backend stores `cancelReason` as a string with a prefix convention (see CLAUDE.md):

| Prefix | Origin | Display |
|---|---|---|
| `CHANGED_MIND` / `ORDERED_BY_MISTAKE` / `FOUND_CHEAPER` / `OTHER` | Buyer self-cancel | *"You cancelled this order."* (with reason mapped to friendly copy, e.g. "Changed mind") |
| `OUT_OF_STOCK` / `CANNOT_FULFILL` | Merchant cancel | *"The merchant cancelled this order: {friendly reason}."* |
| `ADMIN:...` | Admin cancel | *"YIIVA cancelled this order: {reason after colon}."* |
| `SYSTEM:PAYMENT_TIMEOUT` | Pending-order cron expired the order | *"This order expired before payment was confirmed."* |
| `SYSTEM:PAYMENT_FAILED` | PayFast ITN reported failure | *"Payment failed for this order."* |
| `SYSTEM:PAYMENT_CANCELLED` | Buyer cancelled in the PayFast WebView | *"Payment was not completed."* |

Mobile should pattern-match the prefix before showing the reason — never display the raw value (e.g., `SYSTEM:PAYMENT_TIMEOUT`) to the buyer.

### Refund nuance

`REFUND_REQUESTED` and `REFUNDED` are admin-driven (via `AdminOrdersService.requestRefund`). Buyers cannot initiate refunds from the mobile app in v1 — they would need to contact support. See [§6](#6-known-gaps-and-considerations).

---

## 4. Screen-level flows

### 4.1 Orders tab — list

**Entry:** bottom-tab "Orders" tab.

**API call on mount:** `GET /orders?take=20`.

**What the user sees:**

- **Header** — *"Your orders"*
- **Filter bar** (horizontal pills) — *"All"*, *"Active"* (filters in-flight statuses: `CONFIRMED, PROCESSING, READY_FOR_DISPATCH, DISPATCHED, IN_TRANSIT`), *"Delivered"*, *"Cancelled"*. Tapping a pill re-fires the request with `?status=` set (or unset for "All"). "Active" uses multiple status calls or a client-side filter — the API takes a single status; see [§6.1](#61-no-multi-status-filter-on-get-orders).
- **Search affordance** (top-right) — opens a search input, fires `GET /orders?search=<query>` debounced 400ms
- **List** of order summary cards (each tappable → [§4.2 Order detail](#42-order-detail))

**Order summary card layout:**

```
┌─────────────────────────────────────────────────────────┐
│ {storeName}                              {statusChip}   │
│ Order #{orderNumber}                                    │
│ {itemCount} items · {placedAt — formatted as relative} │
│                                            R{total}     │
└─────────────────────────────────────────────────────────┘
```

- Status chip uses the colors from [§3](#3-order-status-state-machine)
- `placedAt`: render as relative ("2 days ago", "Today at 14:32"); on tap-and-hold, show absolute ISO date in a tooltip
- Tap anywhere on the card → push order detail

**Empty states:**

| State | UI |
|---|---|
| Total empty (new user, no orders) | Illustration + *"No orders yet"* + body *"When you check out, your orders will appear here."* + CTA **"Start shopping"** → Home tab |
| Empty for a specific filter | *"No orders match this filter."* + button to clear filter |
| Empty search result | *"No orders match {query}."* — keep search input visible |

**Pagination:** infinite scroll. On `onEndReached`, fire `GET /orders?cursor=<nextCursor>&take=20`. Append. Stop when `nextCursor` is `null`.

**Pull-to-refresh:** re-fires from page 1 with the current filter. Important for buyers tracking in-transit orders.

**Error paths:**

| Response | UX |
|---|---|
| `400` query validation | Toast: *"Couldn't load orders."* — log; should be unreachable through the UI |
| Network/5xx | Centered retry state if it's the initial load; toast + tap-to-retry footer if it's pagination |

---

### 4.2 Order detail

**Entry:** tap an order card on the list, or land here from the [post-checkout success screen](#44-post-checkout-success--first-order-detail).

**API call on mount:** `GET /orders/:orderId`.

**What the user sees** (top to bottom):

1. **Header bar** — *"Order #{orderNumber}"* + status chip on the right
2. **Status tracker** — a horizontal stepper showing the buyer-relevant milestones. See "Status tracker design" below.
3. **Helper copy** under the tracker — the helper string from [§3](#3-order-status-state-machine) for the current status
4. **Items section** — title *"Items ({itemCount})"*, then a list of item rows:
   - Thumbnail (Cloudinary `w_200`)
   - Title, variant name (if present)
   - Quantity × unit price (e.g., *"2 × R249.00"*)
   - Line total
5. **Store card** — store logo + name + chevron → store profile (catalogue Phase 2)
6. **Delivery address card** — recipient name, phone (formatted, e.g., `082 123 4567`), full address
7. **Buyer notes** (if present) — *"Your notes: {notes}"* in a muted card
8. **Payment summary** — subtotal, shipping (always shown as *"Included in payment"*; do not surface the per-Order 0), total. Helper: *"Paid with PayFast"* if `paymentStatus === 'COMPLETED'`.
9. **Sticky bottom action bar** — see "Action bar by status" below
10. **Help link** — *"Need help with this order? Contact support."*

**Status tracker design:**

Render the tracker as a horizontal stepper with up to 5 visible nodes:

```
   Placed       Confirmed      Dispatched     In transit    Delivered
     ●─────────────●───────────────○───────────────○──────────────○
   Apr 12        Apr 12
   14:32         14:35
```

- Filled circle: this milestone has been reached (timeline field is non-null)
- Empty circle: not yet reached
- Connecting line: filled segment between two reached milestones; dashed/grey otherwise
- Show the timestamp under each reached node (relative for recent, absolute for old)

**Map timeline fields → tracker nodes:**

| Tracker node | Lit when |
|---|---|
| Placed | `timeline.placedAt` non-null (always true) |
| Confirmed | `timeline.confirmedAt` non-null |
| Dispatched | `timeline.dispatchedAt` non-null OR status is `DISPATCHED` / `IN_TRANSIT` / `DELIVERED` |
| In transit | status is `IN_TRANSIT` or `DELIVERED` |
| Delivered | `timeline.deliveredAt` non-null |

For cancelled orders, **replace the tracker** with a single muted banner: status chip + *"Cancelled on {cancelledAt}"* + the cancel-reason interpretation from [§3](#3-order-status-state-machine).

**Action bar by status:**

| Status | Action bar |
|---|---|
| `PENDING` | **"Cancel order"** (primary, neutral color) + helper text *"This will release any held stock."* |
| `CONFIRMED` | **"Cancel order"** (secondary) + helper *"You can cancel until the merchant starts preparing."* |
| `PROCESSING` / `READY_FOR_DISPATCH` / `DISPATCHED` / `IN_TRANSIT` | No primary action — too late to self-cancel. Show **"Contact merchant"** (secondary) which deep-links to a mailto if a merchant contact is exposed (see [§6.3](#63-no-merchant-contact-on-buyer-order-detail)) |
| `DELIVERED` | **"Buy again"** (primary) — re-adds the items to cart (mobile-side; iterates `POST /cart/items` for each) |
| `CANCELLED` / `REFUND_REQUESTED` / `REFUNDED` | **"Buy again"** if non-refund cancellation, otherwise no primary action |

**Auto-refresh policy:** if the screen is open and status is `CONFIRMED`, `PROCESSING`, `READY_FOR_DISPATCH`, or `DISPATCHED`, poll `GET /orders/:orderId` every 30 seconds. Stop polling when the screen unfocuses (use React Navigation's `useFocusEffect`). The PENDING auto-refresh case is handled by the post-checkout success screen ([§4.4](#44-post-checkout-success--first-order-detail)) and uses a more aggressive 5s cadence.

**Pull-to-refresh:** manual re-fetch. Use sparingly — the auto-refresh handles most freshness needs.

**Error paths:** `404` → empty state *"This order isn't available."* + back action. Network/5xx → centered retry.

---

### 4.3 Cancel order

**Entry:** tap **"Cancel order"** in the order detail action bar (only visible on `PENDING` or `CONFIRMED` orders).

**What the user sees:**

A bottom sheet (modal half-screen):

- Title: **"Cancel this order?"**
- Body: *"Tell us why so we can help future buyers."*
- Reason selector — radio buttons:
  - *"Changed my mind"* → `CHANGED_MIND`
  - *"Ordered by mistake"* → `ORDERED_BY_MISTAKE`
  - *"Found it cheaper elsewhere"* → `FOUND_CHEAPER`
  - *"Other"* → `OTHER` (reveals an additional text input with 500-char limit + counter)
- Submit: **"Cancel order"** (red text, primary) — disabled until a reason is selected
- Secondary: **"Keep order"** → dismiss the sheet

**API call:** `POST /orders/:orderId/cancel` with `{ reason, notes? }`.

**UX flow:**

1. Disable both buttons. Show spinner + *"Cancelling…"* on the primary.
2. Fire the request.
3. On success: dismiss the sheet, update the local order state to `CANCELLED` (this is essentially canonical truth — the response confirms), show a toast: *"Order cancelled. Any held stock has been released."*
4. The status tracker on the detail screen swaps to the cancelled banner.
5. The order list re-fetches in the background so the list reflects the new status next time the user goes back.

**Error paths:**

| Response | UX |
|---|---|
| `400 "Cannot cancel an order in {STATUS} status..."` | Toast with the backend message. The order's status has advanced since the user opened the screen — refetch the order detail to update the action bar. |
| `404` | Toast: *"This order isn't available."* — back to orders list. |
| `400` validation | Inline error on the reason / notes. Should be unreachable via UI. |
| Network/5xx | Sheet stays open, re-enable buttons, toast retry. |

**Why no optimistic update:** cancel is a high-stakes action. The 200ms wait for the server's response is acceptable; getting it wrong (showing "cancelled" then reverting) is worse.

---

### 4.4 Post-checkout success → first order detail

This is the screen flow that connects [checkout-flows §4.6](./checkout-flows.md#46-return-url-handling--success-path) to the orders module.

**Entry:** the WebView detected the success-URL universal link → navigated to `CheckoutSuccessScreen` with `{ paymentGroupId, orderNumbers }`.

**Initial state — confirmation:**

- Animation: brief check-mark celebration
- Headline: **"Payment received!"**
- Body: *"Thanks for shopping on YIIVA."* + orderNumbers count: *"You have {N} order{s}: {orderNumbers.join(', ')}."*
- If `N === 1`: a single "Track order" action (primary) → navigate to `OrderDetail` for that order
- If `N > 1`: a primary "View orders" action → navigate to `OrdersList` (will show all N), and a smaller "Track first order" → first order detail

**API call on mount (after the celebration animation, ~800ms):**

Fire `GET /orders/:orderId` for each `orderNumber` (parallel `Promise.all`). The success screen needs the *current* status for the polling logic in the next section.

Note: the API uses **`orderId`** (the DB id), not `orderNumber`, so the path-param mapping needs to happen against what came back from the checkout commit. The commit response returns `orderNumbers: string[]`, **not** order IDs — so for v1, the success screen fires `GET /orders?search=<orderNumber>` once per orderNumber to look up the IDs first. Acceptable for the success-screen surface; see [§6.4](#64-no-batch-orders-by-numbers-endpoint).

**Polling pattern (for the most-recent order):**

```
GET /orders/:orderId
  Status PENDING → wait 5s → retry (up to 6 times = 30s total)
  Status CONFIRMED → stop polling, show confirmed UI
  Status CANCELLED (with SYSTEM:PAYMENT_* reason) → stop polling, show "payment failed" UI
```

After 30s of PENDING:
- Show *"Your payment is still being confirmed. We'll email you the moment it's done."* + a **"View order"** action that takes them to the detail screen (which will continue auto-refreshing).

**Guest-specific UI:**

If the user is NOT authenticated (guest checkout), additionally surface a prominent claim CTA — see [§4.5](#45-guest-claim-entry-from-post-checkout).

**Edge case: multi-merchant cart on the success screen:**

When `N > 1`, the screen lists all orderNumbers but only polls the first one for status (more requests on this critical screen is overkill). The user can navigate to each order's detail for individual tracking.

---

### 4.5 Guest claim entry from post-checkout

**Entry:** the `CheckoutSuccessScreen` detects the user is unauthenticated (no access token in memory + the commit response had `guest` data).

**What the user sees:**

A prominent card below the order confirmation:

```
┌──────────────────────────────────────────────────────┐
│  💾                                                  │
│  Save your YIIVA account                             │
│  Set a password to track this order, save           │
│  addresses, and shop with one tap next time.        │
│                                                      │
│  [ Save my account ]                                 │
└──────────────────────────────────────────────────────┘
```

Tap **"Save my account"** → push `ClaimScreen` ([auth-flows §4.8](./auth-flows.md#48-guest-checkout--claim-account)).

The flow from the user's perspective:
1. Tap "Save my account" → enter password → submit
2. Backend converts guest user to a real account (`isGuestAccount: false`)
3. Return to `LoginScreen` with email prefilled and a success banner
4. Sign in → land on Home tab as a real user
5. Their orders are now visible in the Orders tab

The orderNumbers from the success screen should be cached locally so when the user lands back after claim+login, the Orders tab knows to highlight or scroll to those orders.

> See [auth-flows §4.8](./auth-flows.md#48-guest-checkout--claim-account) for the full claim screen design + error catalogue.

---

## 5. Mobile patterns

### Status chip component

A single reusable `<OrderStatusChip status={...} />` component that:
- Picks color + label from [§3](#3-order-status-state-machine)
- Renders as a small rounded pill with an inline icon
- Stays at small text size — chips are summary indicators, not the primary readout

### Relative date rendering

```
< 1 hour ago      → "Just now" / "{N}m ago"
< 24 hours        → "Today at HH:mm"
< 7 days          → "{N} days ago"
< 1 year          → "{Month} {day}" (e.g., "Apr 12")
≥ 1 year          → "{Month} {day}, {year}"
```

Render absolute date on long-press as a tooltip. Use the device locale; default to `en-ZA`.

### Auto-refresh management

Use React Navigation's `useFocusEffect` to start/stop polling intervals. **Never** leave a polling loop running on an unfocused screen — it drains battery and produces stale state.

```ts
useFocusEffect(useCallback(() => {
  const interval = setInterval(refetch, 30_000);
  return () => clearInterval(interval);
}, [refetch]));
```

### Buy again

The "Buy again" action on a delivered/cancelled order iterates the order's items and fires `POST /cart/items` for each. Show a single spinner + *"Adding to cart…"* during the iteration; on completion, toast: *"{N} items added to cart."* and offer **"View cart"**.

Skip items where `POST /cart/items` returns 404 (product no longer available); show a follow-up toast: *"{M} item(s) couldn't be added — they're no longer available."*

### Money formatting

Same `formatRand(cents)` helper from [checkout-flows §6](./checkout-flows.md#6-mobile-patterns). Use consistently.

---

## 6. Known gaps and considerations

### 6.1 No multi-status filter on `GET /orders` — **mobile workaround**

The endpoint accepts a single `status` value. The "Active" filter pill in the orders tab needs five statuses (`CONFIRMED, PROCESSING, READY_FOR_DISPATCH, DISPATCHED, IN_TRANSIT`).

**Mobile workaround:** for the "Active" pill, fetch *all* orders (no status filter), client-side filter to the active set, and continue infinite-scrolling normally. Slightly more bandwidth, but pagination still works because the cursor isn't status-bound.

**Backend follow-up if usage proves it matters:** accept `?status=CONFIRMED,PROCESSING,...` (comma-separated). Effort: ~1 hour. Skip for v1.

### 6.2 No buyer-initiated refund or return — **acceptable for v1**

Buyers cannot request a refund or return through the API; only admins (via `AdminOrdersService.requestRefund`) can initiate refunds. The mobile app should route any "I want a refund" intent through a support contact (mailto link), then ops handles it via the admin tool.

Mobile UI: on `DELIVERED` orders, surface a small *"Need a refund or have an issue? Contact support."* link below the buy-again button. Don't promise self-service.

### 6.3 No merchant contact on buyer order detail — **acceptable for v1**

The order detail returns `storeName` and `storeSlug` but no contact email/phone for the merchant. The "Contact merchant" action on the order detail action bar (for orders past CONFIRMED) currently has no concrete target. Either:
- Hide the action in v1
- Surface YIIVA support as a proxy ("Contact YIIVA support" → mailto)

Recommend the latter — keeps the action visible and doesn't promise direct merchant contact that doesn't exist.

### 6.4 No batch orders-by-numbers endpoint — **mobile workaround**

The checkout commit response returns `orderNumbers: string[]`, but the orders API keys off `orderId` (DB id). To show "your orders are X, Y, Z" with status on the success screen, the mobile app needs to resolve numbers → IDs.

**Current workaround:** fire `GET /orders?search=<orderNumber>` per number on success-screen mount. Inefficient but works.

**Backend follow-up if multi-merchant carts become common:** add `GET /orders?orderNumbers=A,B,C` or return order IDs in the checkout commit response. Effort: ~30 min for the commit-response change. Skip for v1.

### 6.5 Polling-based status freshness — **acceptable for v1**

Order status updates fire from the backend (PayFast ITN, merchant actions). The mobile app currently learns of changes only via:
- Polling on the success screen (5s, max 30s)
- Polling on the order detail (30s while focused)
- Pull-to-refresh on the list

A push-notification-driven update would be a real improvement for in-transit and delivered states. Requires:
- The forthcoming Notifications module (currently deferred — see CLAUDE.md)
- A device-token registration endpoint (`POST /me/push-tokens`) and a push-event delivery pipeline

This is deferred until the Notifications module ships. Until then, accept polling as v1.

---

## 7. Testing checklist

Test on a real device — auto-refresh / focus effects behave differently from the simulator.

### Orders list
- [ ] Empty state shows on a fresh account with no orders
- [ ] After checkout, the order appears in the list with the correct status
- [ ] Filter pills work — "All", "Active" (client-side multi-status filter), "Delivered", "Cancelled"
- [ ] Search by order number returns matching orders only
- [ ] Infinite scroll loads next page on `cursor=<id>&take=20`; stops when `nextCursor` is null
- [ ] Pull-to-refresh resets to page 1 with current filter
- [ ] Status chips use the correct colors per [§3](#3-order-status-state-machine)

### Order detail
- [ ] All fields render: items, store card, address, totals, payment status
- [ ] Status tracker correctly fills nodes based on `timeline` fields
- [ ] Cancelled order swaps tracker for the cancelled banner with the right reason interpretation
- [ ] Auto-refresh polls every 30s while focused, stops on blur
- [ ] Pull-to-refresh works
- [ ] `shippingInCents: 0` is NOT shown as a line item; instead "Included in payment"

### Cancel
- [ ] Cancel action only visible on PENDING and CONFIRMED orders
- [ ] Selecting "Other" reveals the notes input with 500-char limit
- [ ] Submitting without a reason keeps the button disabled
- [ ] Successful cancel updates the screen to CANCELLED + toasts the user
- [ ] Cancelling an order that's already advanced (race) shows the backend's status message + refetches
- [ ] Cancel reasons are correctly stored (verify in DB or via admin view)

### Post-checkout success
- [ ] Single-order checkout → "Track order" → order detail
- [ ] Multi-merchant checkout → list of N orderNumbers + "View orders" action
- [ ] Polling promotes PENDING → CONFIRMED within ~5-10s in sandbox
- [ ] 30s timeout shows fallback copy
- [ ] Payment failure (SYSTEM:PAYMENT_FAILED cancel reason) shows the cancelled UI, not the success UI

### Guest claim
- [ ] Guest checkout success → claim card visible
- [ ] Tap "Save my account" → ClaimScreen → set password → success → land on LoginScreen → sign in → orders visible
- [ ] Authenticated checkout success → claim card NOT visible

### Cross-flow
- [ ] Order detail → "Buy again" → cart populated; navigate to cart → checkout flow works
- [ ] Order list scroll position preserved across navigation away and back
- [ ] After cancel, return to orders list → list reflects CANCELLED (re-fetched on navigation back)

---

## 8. Endpoint cross-reference

| Endpoint | Used in |
|---|---|
| `GET /orders` | [§4.1 Orders list](#41-orders-tab--list), [§4.4 success-screen number-to-id lookup](#44-post-checkout-success--first-order-detail), [§4.5 Mobile workaround](#64-no-batch-orders-by-numbers-endpoint) |
| `GET /orders/:orderId` | [§4.2 Order detail](#42-order-detail), [§4.4 Post-checkout polling](#44-post-checkout-success--first-order-detail) |
| `POST /orders/:orderId/cancel` | [§4.3 Cancel order](#43-cancel-order) |
| `POST /auth/claim` | [§4.5 Guest claim](#45-guest-claim-entry-from-post-checkout) — full flow in [auth-flows §4.8](./auth-flows.md#48-guest-checkout--claim-account) |
| `POST /cart/items` | [§5 Buy again](#5-mobile-patterns) — full flow in [cart-wishlist-addresses-flows §3.1](./cart-wishlist-addresses-flows.md#31-add-to-cart-from-product-detail) |
