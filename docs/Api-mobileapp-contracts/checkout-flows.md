# YIIVA Checkout & PayFast — Mobile App Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA **buyer mobile app** on Expo / React Native.
> **Scope:** The two checkout endpoints (quote, commit) + PayFast handoff via WebView + return/cancel deep-link routing + the post-payment confirmation. Mobile-specific patterns: WebView form submission, universal-link return handling, network-failure recovery on commit, guest checkout entry.
>
> **Companion docs:**
> - [`auth-flows.md`](./auth-flows.md) — claim flow and the universal-link configuration shared with checkout return URLs.
> - [`cart-wishlist-addresses-flows.md`](./cart-wishlist-addresses-flows.md) — what the buyer has when they tap "Checkout".
> - [`../docs/payments-module/payments-module-foundation.md`](../payments-module/payments-module-foundation.md) — backend-side PayFast architecture, ITN flow, sandbox smoke test.

---

## Table of Contents

1. [Context](#1-context)
2. [Available endpoints summary](#2-available-endpoints-summary)
3. [The mobile PayFast flow](#3-the-mobile-payfast-flow)
4. [Screen-level flows](#4-screen-level-flows)
   - [4.1 Cart → checkout entry](#41-cart--checkout-entry)
   - [4.2 Checkout summary screen](#42-checkout-summary-screen)
   - [4.3 Guest checkout entry](#43-guest-checkout-entry)
   - [4.4 Address picker + new-address inline](#44-address-picker--new-address-inline)
   - [4.5 PayFast handoff (WebView)](#45-payfast-handoff-webview)
   - [4.6 Return-URL handling — success path](#46-return-url-handling--success-path)
   - [4.7 Return-URL handling — cancel and failure paths](#47-return-url-handling--cancel-and-failure-paths)
   - [4.8 Network failure during commit — the dangerous middle state](#48-network-failure-during-commit--the-dangerous-middle-state)
5. [Universal-link configuration for checkout](#5-universal-link-configuration-for-checkout)
6. [Mobile patterns](#6-mobile-patterns)
7. [Known gaps and considerations](#7-known-gaps-and-considerations)
8. [Testing checklist](#8-testing-checklist)
9. [Endpoint cross-reference](#9-endpoint-cross-reference)

---

## 1. Context

Checkout is the most complex flow in the buyer app. It bridges three systems:

1. **Mobile app** — gathers the cart + address + contact info, presents the summary
2. **YIIVA backend** — validates stock, computes totals + shipping, creates Orders + PaymentGroup, signs the PayFast payload, returns a redirect package
3. **PayFast** — accepts the buyer, processes the payment, redirects back to YIIVA, fires an ITN webhook to the backend

The mobile app is **never on the critical path for payment confirmation**. The backend's ITN webhook is the only source of truth for "did the payment actually succeed." The mobile app's return-URL handling is a **UX-only signal** — it shows the user the right screen, but the order's actual status comes from the next `GET /orders/:id` fetch, which reflects what the ITN already processed (or didn't yet).

### Two checkout shapes

| Authenticated buyer | Guest buyer |
|---|---|
| Cart items come from the server-side cart (`GET /cart`) | Items provided inline in the request body |
| Delivery address picked from saved `/addresses` (by `addressId`) | Address provided inline in `guest.address` |
| Stock was reserved at cart-add time | Stock is reserved during the commit transaction |
| `GET /orders/:id` works post-checkout | Same — but until claim, the user has no auth context to query orders |

Both use the same two endpoints — the `OptionalJwtAuthGuard` on `/checkout/quote` and `/checkout` accepts either path.

### Three commercial details to surface in UI

- **Shipping is flat R110** across all carts in v1 (the shipping module is still on its stub — real Courier Guy rates come later). The quote response surfaces this as `grandShippingInCents`; show it as a line item.
- **YIIVA commission is 5.5%** on subtotal only (not shipping). Buyers do not see this — it's a merchant-side concern.
- **Multi-merchant carts produce multiple orders** — one Order per store. The buyer makes a single PayFast payment that covers all of them.

---

## 2. Available endpoints summary

Both endpoints accept authenticated buyers AND guests (`@Public()` + `OptionalJwtAuthGuard`). Auth via `Authorization: Bearer <accessToken>` when available; omit the header for guest flows.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/checkout/quote` | Preview totals + shipping. No DB writes. Safe to call multiple times. |
| `POST` | `/checkout` | Lock the order, create DB records, get the PayFast redirect package. **Side-effecting — see [§4.8](#48-network-failure-during-commit--the-dangerous-middle-state) for retry semantics.** |

### Request — `POST /checkout/quote`

```ts
{
  addressId?: string;             // required for authed buyers (omit otherwise)
  guest?: GuestInfo;              // required for guests (see GuestInfo below)
  items?: CheckoutItem[];         // required for guests (1+ items)
}

type GuestInfo = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;                  // SA format: 0XX... or +27XX...
  address: {                      // GuestAddressDto — same shape as buyer addresses minus label + isDefault
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    province: string;             // one of the 9 SA provinces
    postalCode: string;           // exactly 4 digits
  };
};

type CheckoutItem = {
  productId: string;
  variantId?: string;
  quantity: number;               // min 1
};
```

### Response — `POST /checkout/quote` (200)

```ts
{
  stores: [
    {
      storeId: string;
      storeName: string;
      storeSlug: string;
      items: [
        {
          productId: string;
          variantId: string | null;
          productTitle: string;
          variantName: string | null;
          productImageUrl: string | null;
          unitPriceInCents: number;
          quantity: number;
          lineTotalInCents: number;
        }
      ];
      subtotalInCents: number;
      commissionInCents: number;  // merchant-facing; do not show to buyer
      totalInCents: number;        // same as subtotalInCents (shipping isn't per-store)
    }
  ];
  grandSubtotalInCents: number;
  grandShippingInCents: number;
  grandTotalInCents: number;
  shippingQuoteId: string;        // opaque token; not currently consumed but reserved for shipping module rollout
}
```

### Request — `POST /checkout`

Same shape as quote, plus:

```ts
{
  ...quoteDto,
  notes?: string;                 // optional, max 500 chars
  returnUrl: string;              // required — where PayFast redirects on success
  cancelUrl: string;              // required — where PayFast redirects on user cancellation
}
```

`returnUrl` and `cancelUrl` are per-request and override the backend's `PAYFAST_RETURN_URL` / `PAYFAST_CANCEL_URL` env defaults. **The mobile app supplies universal-link URLs here** — see [§5](#5-universal-link-configuration-for-checkout).

### Response — `POST /checkout` (201)

```ts
{
  orderNumbers: string[];         // e.g., ["YV-2026-AB12CD", "YV-2026-XY99ZZ"]
  paymentGroupId: string;
  mPaymentId: string;             // the m_payment_id used by PayFast for reconciliation
  payfast: {
    actionUrl: string;            // e.g., "https://sandbox.payfast.co.za/eng/process"
    fields: Record<string, string>; // all the signed form fields, including the signature
  };
}
```

### Error catalogue

| Status | Message / shape | Cause |
|---|---|---|
| `400 "Address is required"` | Authenticated buyer omitted `addressId` |
| `400 "addressId is required for logged-in buyers"` | Same as above, more specific |
| `400 "guest info not allowed with JWT"` | Authenticated buyer sent a `guest` payload — pick one path |
| `400 "guest info is required when not logged in"` | Guest path missing `guest` block |
| `400 "items are required for guest checkout"` | Guest path missing `items` |
| `400 "Cart is empty"` | Authenticated buyer with no items in their server cart |
| `404 "Address not found"` | `addressId` doesn't belong to the user or was soft-deleted |
| `404 "Product not available"` (in the items list) | Product is no longer ACTIVE between quote and commit |
| `409 { message, items: [...] }` | **Structured error** — stock changed; see "Stock-conflict shape" below |
| `409 "An account with this email exists. Please log in to continue."` | Guest tried to check out with an email belonging to a real account |
| `500 "Order number generation failed"` | Exhausted 3 retries on the YV-YYYY-XXXXXX format collision check — extremely rare |
| `500` (PayFast error) | PayFast API timed out / rejected the request — the order rows are rolled back |

**Stock-conflict shape (409 from `assertAllItemsAvailable`):**

```ts
{
  statusCode: 409,
  message: "Some items are no longer available. Please update your cart.",
  items: [
    {
      productId: string;
      variantId: string | null;
      productTitle: string;
      requestedQuantity: number;
      availableQuantity: number;
      reason: "out_of_stock" | "partial_stock" | "inactive";
    }
  ]
}
```

Render this as a list back on the cart screen — see [§4.2](#42-checkout-summary-screen) for the handling pattern.

---

## 3. The mobile PayFast flow

PayFast's hosted checkout requires a **POST** form submission with signed fields. Mobile apps cannot use `expo-web-browser`'s `openAuthSessionAsync` for this — that opens a system browser (SFAuthenticationSession on iOS, Custom Tab on Android) which only accepts GET URLs.

**The pattern this app uses: in-app WebView.**

### Full sequence

```
Mobile app                                Backend                    PayFast
─────────                                 ─────────                  ─────────
1. POST /checkout            ──────────►
                                          - Validate cart
                                          - Create Orders + PaymentGroup
                                          - Sign PayFast fields
   { payfast: { url, fields }, ... }  ◄─

2. Build HTML form from fields
   Open WebView with source={{ html }}
   Auto-submit on load           ──────────────────────────────────►
                                                                     - Show hosted checkout
                                                                     - User pays
                                                                     - Redirect to returnUrl
                                          ◄──────────────────────── POST /payments/notify (ITN, server-to-server)
                                          - Validate signature
                                          - Update PaymentGroup status
                                          - Update Orders → CONFIRMED

3. WebView onNavigationStateChange
   detects URL = returnUrl
   Close WebView, navigate to
   Confirmation screen          ──────────►
4. GET /orders/:id                  - Return order details
                                              (status reflects ITN result)
```

### What the mobile app actually does

1. **Receives** `{ payfast: { actionUrl, fields }, paymentGroupId, mPaymentId, orderNumbers }` from `POST /checkout`.
2. **Constructs** an HTML string that auto-submits a form to `actionUrl` with the signed fields:

   ```ts
   function buildPayfastForm(actionUrl: string, fields: Record<string, string>): string {
     const inputs = Object.entries(fields)
       .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`)
       .join('\n');
     return `
       <!DOCTYPE html>
       <html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
       <body style="margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fff">
         <p style="font-family:sans-serif;color:#666;">Loading secure payment…</p>
         <form id="pf" action="${escapeHtml(actionUrl)}" method="POST">${inputs}</form>
         <script>document.getElementById('pf').submit();</script>
       </body></html>
     `;
   }
   ```

3. **Opens a WebView** with `source={{ html: builtFormHtml, baseUrl: 'https://yiiva.co.za' }}`. `baseUrl` matters — cookies and CORS policies key off it; PayFast may reject requests that don't have a real-looking origin.
4. **Listens** for navigation changes. When the WebView's URL matches `returnUrl` or `cancelUrl`, close the WebView and route accordingly.

### Why not WebBrowser (in-app SFAuthenticationSession)?

- `expo-web-browser` opens a GET URL — no form POST capability.
- The hosted-form-on-backend workaround (backend serves a GET URL that renders + auto-submits the PayFast form) is possible but adds a backend route just for mobile. WebView is simpler and matches the merchant-web app's existing auto-submit pattern.

### Why not raw `fetch` against PayFast from RN?

PayFast's redirect flow is a browser/WebView pattern by design — they don't expose a payment-processing JSON API. They want the buyer to see PayFast's branded page (trust + compliance). Don't try to skip the WebView.

---

## 4. Screen-level flows

### 4.1 Cart → checkout entry

**Entry:** the user taps "Continue to checkout" in the sticky cart bottom bar ([cart-wishlist-addresses-flows §3.2](./cart-wishlist-addresses-flows.md#32-cart-screen)).

**Behaviour gated by:**
- Auth state — authenticated users go to `CheckoutSummaryScreen` directly; signed-out users get an entry choice (see [§4.3](#43-guest-checkout-entry))
- Cart has no `unavailable` items (button is disabled otherwise)

**Authenticated path:**
1. Tap → navigate to `CheckoutSummaryScreen` with no params (the screen pulls cart + addresses itself)

**Unauthenticated path:**
1. Tap → bottom sheet with two options:
   - **"Sign in or sign up"** → `LoginScreen` with `returnTo: { screen: 'CheckoutSummary' }`
   - **"Continue as guest"** → `GuestCheckoutEntryScreen` ([§4.3](#43-guest-checkout-entry))

---

### 4.2 Checkout summary screen

**Entry:** from cart's "Continue to checkout" (authenticated), or after guest-entry-form completion.

**API call on mount:** `POST /checkout/quote` — pass `addressId` (default address from `/addresses`) for authenticated buyers, or `guest` + `items` for guests.

**What the user sees:**

1. **Header** — *"Review your order"*
2. **Delivery address card** — selected address summary with **Change** action → opens address picker ([§4.4](#44-address-picker--new-address-inline))
3. **Per-store sections** — one card per `stores[]` entry, each with:
   - Store name + chevron (tappable → store profile)
   - Items list (thumbnail + title + variant + quantity + line total)
   - Store subtotal
4. **Order summary card** at the bottom:
   - Subtotal: R{grandSubtotal}
   - Shipping: R{grandShipping}
   - **Total: R{grandTotal}**
   - Helper line: *"Shipping is a flat R110 across all merchants while we work on per-merchant rates."*
5. **Optional notes field** — free text, max 500 chars (e.g., delivery instructions)
6. **Sticky bottom**: **"Pay R{grandTotal} with PayFast"** button — spinner + *"Preparing payment…"* in flight. Below it, small fine print: *"You'll be redirected to PayFast's secure checkout."*

**Loading + error states on mount:**

- Initial load: skeleton with the layout above
- 409 stock conflict on quote: replace the layout with a card list showing the conflicting items + a CTA **"Back to cart"** → cart screen with the conflicting items pre-flagged
- 400/404 on quote: error state with retry; if it's `"Address not found"`, push to address picker
- Network/5xx: full-screen retry

**Tap "Pay with PayFast":**

1. Disable the button. Fire `POST /checkout` with:
   - `addressId` or `guest`+`items` (same shape as quote)
   - `notes` if entered
   - `returnUrl: "https://yiiva.co.za/checkout/success"` — universal link
   - `cancelUrl: "https://yiiva.co.za/checkout/cancel"` — universal link
2. On `201`: navigate to `PayFastWebViewScreen` with the response payload ([§4.5](#45-payfast-handoff-webview)).
3. On `409` stock conflict: surface the conflicting items inline + suggest "Back to cart". Do **not** re-enable the button — let the user go fix the cart.
4. On `400 "Address not found"`: send back to address picker — the user's default address was probably deleted.
5. On `500`: full-screen error with retry: *"We couldn't reach PayFast. Tap to retry."* See [§4.8](#48-network-failure-during-commit--the-dangerous-middle-state) for nuances.

---

### 4.3 Guest checkout entry

**Entry:** from the cart's "Continue as guest" option ([§4.1](#41-cart--checkout-entry)).

**What the user sees:**

A form gathering the guest identity + delivery address inline (since guests have no saved addresses):

| Section | Fields |
|---|---|
| **Contact** | email, firstName, lastName, phone (SA format) |
| **Delivery address** | recipientName (defaults to "firstName lastName" — editable), phone (defaults to contact phone — editable), addressLine1, addressLine2 (optional), city, province (picker), postalCode (4 digits) |

All inputs use the same mobile-keyboard hints documented in [cart-wishlist-addresses-flows §5.2](./cart-wishlist-addresses-flows.md#52-add-address).

**Below the form:** a small helper *"You'll be able to save this account after checkout by setting a password."* — anticipates the [claim flow](./auth-flows.md#48-guest-checkout--claim-account).

**Submit:**
1. Local validation passes → fire `POST /checkout/quote` with `guest` + `items` from local cart.
2. On `200`: navigate to `CheckoutSummaryScreen` with the quote shape (it'll re-fire the quote on mount or accept the prefetch as initial state).
3. On `409 "An account with this email exists..."`: switch into a "Sign in" inline state with the email pre-filled and a **"Sign in to continue"** action.

**Error paths:** standard form validation errors per field.

---

### 4.4 Address picker + new-address inline

Same component as [cart-wishlist-addresses-flows §5.6](./cart-wishlist-addresses-flows.md#56-address-picker-during-checkout). Selecting an address sets the local checkout state's `addressId`; the summary refreshes the quote with the new address (which may change shipping cost when real per-merchant rates ship later).

**Guest checkout has no picker** — the address is in the inline form on [§4.3](#43-guest-checkout-entry). Tapping "Change" on the summary's delivery card returns the user to that form.

---

### 4.5 PayFast handoff (WebView)

**Entry:** navigated from a successful `POST /checkout` response.

**Route params:** `{ paymentGroupId, mPaymentId, orderNumbers, payfast: { actionUrl, fields }, returnUrl, cancelUrl }`.

**What the user sees:**

- **Top bar** — *"Secure payment"* + a close (×) button. Tapping × shows a confirmation: *"Cancel this payment? Your order won't be placed."* + [Cancel payment] / [Keep paying]. On confirmation, treat as a cancel-path return ([§4.7](#47-return-url-handling--cancel-and-failure-paths)).
- **WebView** — full-screen below the top bar. Renders the auto-submitted PayFast form ([§3](#3-the-mobile-payfast-flow) for the HTML construction).
- **Loading overlay** — semi-transparent over the WebView while it submits to PayFast (the white "Loading secure payment…" page in the HTML is visible for ~500ms before PayFast loads). Show a centered spinner + *"Loading PayFast…"*. Dismiss when the WebView reports `onLoadEnd` for the PayFast domain.

**WebView setup:**

```tsx
<WebView
  source={{ html: builtFormHtml, baseUrl: 'https://yiiva.co.za' }}
  onNavigationStateChange={handleNavChange}
  onShouldStartLoadWithRequest={shouldAllowRequest}
  onError={handleWebViewError}
  // iOS-specific:
  sharedCookiesEnabled
  // Android-specific:
  thirdPartyCookiesEnabled
/>
```

**Navigation handler:**

```ts
function handleNavChange(navState: WebViewNavigation) {
  const { url } = navState;
  if (url.startsWith(returnUrl)) {
    closeWebView();
    navigate('CheckoutSuccess', { paymentGroupId, orderNumbers });
    return;
  }
  if (url.startsWith(cancelUrl)) {
    closeWebView();
    navigate('CheckoutCancelled', { paymentGroupId });
    return;
  }
  // Otherwise let the WebView keep navigating PayFast pages.
}
```

**Key consideration — back-button:** Android's hardware back button defaults to navigating back in the WebView's history. Override with `BackHandler` so it triggers the same "Cancel this payment?" dialog as the × button instead. Otherwise the user can back out to PayFast's first page and get confused.

**Edge cases:**

| Edge | Handling |
|---|---|
| WebView fails to load (network error before PayFast responds) | Full-screen retry state with **"Try again"** (rebuilds the WebView) + **"Cancel"** (back to summary). The order is already created with status PENDING; if abandoned, the [pending-order cron](../order-module/order-module-foundation.md) cancels it within 30 minutes. |
| WebView loads but the user takes >30 min | The order's PENDING status expires server-side. PayFast may still process the payment — backend's CANCELLED-stays-CANCELLED rule sets `PaymentGroup.status = RECONCILE_REQUIRED` for ops to handle. From the mobile app, treat any return after expiry as the cancel/failure path. |
| WebView shows a PayFast error page (signature mismatch, etc.) | Backend wouldn't normally produce a bad signature in production — if it happens, the user will see PayFast's error UI inline. Provide the × close button + suggest contacting support. |
| PayFast 3D-Secure / OTP screens | Render natively inside the WebView — no special handling needed. |

---

### 4.6 Return-URL handling — success path

**Entry:** the WebView detects navigation to a URL starting with `returnUrl` (e.g., `https://yiiva.co.za/checkout/success`).

**Important:** the success URL only means "PayFast believes the transaction succeeded and redirected the buyer." The **authoritative confirmation** is the ITN webhook the backend receives separately, which updates Order status to `CONFIRMED` and PaymentGroup to `COMPLETED`. The mobile app does **not** trust the returnUrl as proof of payment.

**Mobile flow:**

1. Close the WebView.
2. Navigate to `CheckoutSuccessScreen` with `{ paymentGroupId, orderNumbers }`.
3. On mount, fire `GET /orders?paymentGroupId=<id>` (or per-order `GET /orders/:id` for each `orderNumber`) — see the forthcoming `orders-flows.md` for the exact endpoint shape.
4. **Show the screen state based on the API's current view of the order**, *not* on what the WebView's URL suggested:

| Backend order status | Mobile screen |
|---|---|
| `CONFIRMED` | Success screen — checkmark, *"Payment received!"*, order details, claim-account CTA (for guests) |
| `PENDING` | Pending screen — *"We're confirming your payment with PayFast. This usually takes under a minute."* + auto-refresh every 5s for up to 30s (then surface a "Still processing — check your email for confirmation" fallback) |
| `CANCELLED` | Failure screen — *"Your order was not completed."* + **"Try again"** action → back to cart |

**Why the polling:** PayFast's ITN may arrive a few seconds before or after the user is redirected. If the mobile app shows "success" immediately based on the URL but the ITN hasn't fired yet, the next screen's order list might still show PENDING. Polling for up to 30s catches the common case.

**Claim CTA on guest success:** prominently show **"Save my account"** which routes to `ClaimScreen` ([auth-flows §4.8](./auth-flows.md#48-guest-checkout--claim-account)). After claim, the order will be linked to the now-real account.

**Empty bottom-tab cart after success:** when navigating to the success screen, clear the local cart state (the backend cleared the server cart in TX2 of the commit flow). The cart badge should drop to 0 immediately.

---

### 4.7 Return-URL handling — cancel and failure paths

PayFast redirects to `cancelUrl` in two distinct scenarios:

1. **User cancellation** — they tapped a "Cancel" / "Back to merchant" button inside PayFast
2. **Payment failure** — declined card, insufficient funds, 3DS challenge failed

PayFast does not distinguish these in the cancelUrl redirect — both arrive at the same URL.

**Mobile flow:**

1. Close the WebView.
2. Navigate to `CheckoutCancelledScreen` with `{ paymentGroupId }`.
3. Show: *"Your order was not completed."* + body *"No charges were made. You can try again when you're ready."*
4. Two actions:
   - **"Try again"** → re-fires `POST /checkout` with the same payload (cart is still intact server-side for authenticated users; guest cart is still in local state)
   - **"Back to cart"** → cart screen

**Important — the PENDING orders left behind:**

When the user cancels mid-payment, the order rows already exist server-side with `status: PENDING`. They will be auto-cancelled within 30 minutes by the [pending-order cleanup cron](../order-module/order-module-foundation.md). The mobile app doesn't need to do anything special — but be aware that:

- A "Try again" that fires a new `POST /checkout` creates **new** Order rows + a new PaymentGroup; the cancelled ones expire in the background.
- If the user looks at their order history immediately after cancelling, they may briefly see the PENDING orders. The forthcoming orders-flows doc will cover whether to filter these out of the list.

---

### 4.8 Network failure during commit — the dangerous middle state

**Scenario:** the mobile app fires `POST /checkout`. The backend successfully:
- Creates Orders + PaymentGroup (TX1)
- Calls PayFast and gets the redirect package
- Returns 201 to the app

But the **network drops or the app crashes** before the response is received. The mobile app sees a timeout / error; the backend has live PENDING orders and a charged PaymentGroup-but-no-redirect-completed.

**This is the most fragile spot in the entire checkout flow.** Handling:

**On commit timeout / network error:**

1. Show a modal: *"We're not sure if your order went through. Don't tap back — we're checking."*
2. Fire a recovery probe: `GET /orders?mPaymentId=<localCachedMpaymentId>` *(see [§7 gaps](#7-known-gaps-and-considerations) — a lookup-by-mPaymentId endpoint is recommended; without it, fall back to fetching the user's orders list and searching by recent createdAt)*.
3. Branch on the probe result:
   - Found an order in PENDING → the commit succeeded but we lost the redirect. Show a **"Resume payment"** action that re-fetches the PayFast redirect package from the order *(also a backend gap — see §7)* and pushes back into the WebView.
   - Found an order in CONFIRMED → ITN already arrived (race-y but possible). Navigate to success.
   - No matching order found → the commit failed before TX1. Safe to allow a retry of the same `POST /checkout` from scratch.

**For v1**, until the recovery endpoints exist, the simpler approach:

1. On commit timeout / network error, show the modal above.
2. Wait 5 seconds, then `GET /orders?limit=5&sort=newest` (the user's own most recent orders).
3. If a PENDING order exists from the last 60 seconds, show *"Your payment is still being processed. Check email for confirmation; if you don't receive one in 30 minutes the order will be automatically cancelled."*. Don't allow retry from this screen — let the cron handle it.
4. If no recent order exists, allow retry.

**This is documented as a known UX gap below** ([§7.1](#71-no-mpaymentid-or-order-lookup-by-mpaymentid)). Lock in the cleaner recovery flow when those endpoints land.

**Guests are at extra risk:** they have no session to query their own orders. If the network drops mid-commit for a guest, the mobile app cannot tell whether the order was created. Display: *"Your payment is being processed. Check {guest.email} in 30 minutes for confirmation. If you don't receive one, the order was cancelled — try again."*

---

## 5. Universal-link configuration for checkout

The mobile app needs two additional universal-link paths beyond the auth ones:

| Path | Source | Used for |
|---|---|---|
| `https://yiiva.co.za/checkout/success` | `returnUrl` sent in `POST /checkout` | Success path |
| `https://yiiva.co.za/checkout/cancel` | `cancelUrl` sent in `POST /checkout` | Cancel + failure path |

**Why universal links** instead of relying on the WebView's `onNavigationStateChange`:

The WebView handler is the **primary** detection path — it catches the redirect inside the WebView before the page ever loads. But for two edge cases, having universal links as a backstop is important:

1. If the user's WebView crashes mid-redirect (rare), they may be shown the URL in their system browser instead → universal link claim opens the app
2. If they share / open the URL from another context

**Expo config additions** (extend the `auth-flows.md` config):

```json
{
  "expo": {
    "ios": {
      "associatedDomains": ["applinks:yiiva.co.za"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/auth/verify-email" },
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/auth/reset-password" },
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/checkout/success" },
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/checkout/cancel" }
          ],
          "category": ["BROWSABLE", "DEFAULT"],
          "autoVerify": true
        }
      ]
    }
  }
}
```

Web team owns the corresponding entries in `apple-app-site-association` and `assetlinks.json`. The web app should *also* serve these URLs (success/cancel landing pages) for the un-installed-app fallback.

---

## 6. Mobile patterns

### Disable double-submit on commit

The commit button is the most expensive call in the app — never let it fire twice. After the first tap:

```ts
const [committing, setCommitting] = useState(false);
async function handleCommit() {
  if (committing) return;
  setCommitting(true);
  try { ... } finally { setCommitting(false); }
}
```

Disable the button visually while `committing === true`. Show a spinner over the button.

### Reachability check before commit

Before firing `POST /checkout`, do a quick reachability ping (e.g., HEAD `/health` or just verify NetInfo says connected). If offline, show *"You're offline. Connect to the internet to complete checkout."* — do **not** fire the commit. The risk of a half-completed commit in poor connectivity is too high.

### WebView background protection

If the user backgrounds the app while the WebView is open (e.g., to look up a card number in their banking app), preserve the WebView's state. **Do not** unmount it on `AppState` change to `background`. Resume on `active` and let the user continue.

### Forgive the slow ITN

The success screen should *gracefully* show PENDING while the ITN catches up. Don't show alarm UI; show calm *"We're confirming your payment with PayFast"* with an auto-refresh + a max 30s wait before suggesting email confirmation.

### Money formatting

Use a single `formatRand(cents: number): string` helper that returns `R{N},{NN}` (South African convention: comma as decimal separator). Example: `12500` → `"R125,00"`. Apply consistently across summary, totals, and confirmation.

---

## 7. Known gaps and considerations

### 7.1 No mPaymentId or order lookup by mPaymentId — **acceptable for v1 with caveats**

The mobile app needs a way to recover from a network failure mid-commit. The cleanest pattern requires an endpoint like:

```
GET /orders?mPaymentId=<id>
```

…that the mobile app can call with the cached `mPaymentId` from its last quote/commit attempt to determine whether an order was actually created. **This doesn't exist today.** Use the v1 fallback in [§4.8](#48-network-failure-during-commit--the-dangerous-middle-state) and add this endpoint when commit-failure rates become measurable.

### 7.2 No "resume payment" endpoint — **acceptable for v1**

If a user's WebView drops mid-PayFast (rare — they're already on PayFast's site, on a different domain) and the order is PENDING server-side, the cleanest UX would be to re-display the PayFast form. The backend doesn't currently expose a way to rebuild the PayFast payload for an existing PaymentGroup. Mobile workaround: tell the user to wait for the cancel-and-retry cycle (30-minute pending expiry, then start fresh).

### 7.3 Shipping is flat R110, regardless of cart contents — **known and called out in UI**

The shipping module is still on its stub. Mobile should call this out gently in the summary: *"Shipping is a flat R110 across all merchants while we work on per-merchant rates."* — sets expectations.

### 7.4 PayFast field shape is opaque to the mobile app — **intentional**

The `payfast.fields` Record returned by `POST /checkout` is a black box from the mobile app's perspective. Don't inspect or modify it — just inject it verbatim into the WebView form. Tampering with any field (including the `signature`) will cause PayFast to reject the request.

### 7.5 PayFast sandbox quirks — **dev-only**

In sandbox, refunds always reject (covered in the payments-module foundation). Mobile devs testing checkout against sandbox creds should expect:

- Test card: 5200 8282 8210 0044 — succeeds
- 3DS test: 5200 8282 8210 0014 — triggers a sandbox 3DS challenge screen
- See `docs/payments-module/payments-module-foundation.md` for the full PayFast sandbox cheat sheet.

---

## 8. Testing checklist

Test on a real device. WebView + universal-link behaviour does not match the simulator reliably.

### Authenticated checkout
- [ ] Cart with items from one store → quote screen shows correct totals, single store card
- [ ] Cart with items from multiple stores → quote screen shows multiple store cards, summed grand total
- [ ] Change address → quote refetches with the new address
- [ ] Tap "Pay" → WebView opens, PayFast loads, complete sandbox payment → return to success screen
- [ ] Success screen shows PENDING briefly, polls, then CONFIRMED (sandbox ITN typically arrives in <5s)
- [ ] Cart badge drops to 0 after success
- [ ] Order appears in the orders tab with status CONFIRMED

### Guest checkout
- [ ] From empty-cart (signed out) state, populating cart works
- [ ] Tap "Continue to checkout" → guest entry form
- [ ] Fill valid SA address → quote screen
- [ ] Submit guest checkout with existing-account email → 409 → switch to sign-in inline
- [ ] Complete guest payment → success screen has prominent **Save my account** CTA
- [ ] Tap **Save my account** → ClaimScreen → set password → land on LoginScreen → sign in → order is now visible in the user's orders tab

### Stock conflict
- [ ] In a second device/session, reduce stock on a product in the cart to 0 → fire commit → 409 with the structured items array → mobile shows the conflict UI
- [ ] User can tap "Back to cart" → cart shows the now-unavailable items flagged

### Cancel and retry
- [ ] Tap "Pay" → WebView opens → tap the × button → confirmation dialog → cancel → back to summary
- [ ] Cancel inside PayFast (e.g., back button) → WebView navigates to cancelUrl → mobile detects → cancelled screen
- [ ] Tap "Try again" → fresh commit → new PayFast flow

### Network failure
- [ ] Toggle airplane mode just before tapping "Pay" → reachability check blocks commit
- [ ] Tap "Pay" → enable airplane mode mid-request → modal warns *"checking…"* → orders list polled → no recent order found → safe retry allowed
- [ ] Force-kill the app mid-WebView → reopen → orders tab shows the PENDING order from the last commit (will auto-cancel in 30 min)

### Universal links
- [ ] After completing a PayFast payment from another device's email link to success URL → opens the mobile app's success screen (if app installed)
- [ ] Same for cancel URL

### Visual + UX
- [ ] Money formatting consistent (R125,00 not R125.00) across summary, totals, success
- [ ] Optional notes field can be left blank
- [ ] Notes field rejects > 500 chars with inline error
- [ ] Shipping disclaimer copy visible in the summary

---

## 9. Endpoint cross-reference

| Endpoint | Used in |
|---|---|
| `POST /checkout/quote` | [§4.2 Summary screen mount](#42-checkout-summary-screen), [§4.3 Guest entry submit](#43-guest-checkout-entry), [§4.4 Address change](#44-address-picker--new-address-inline) |
| `POST /checkout` | [§4.2 Pay button](#42-checkout-summary-screen), [§4.7 Try again](#47-return-url-handling--cancel-and-failure-paths), [§4.8 Network failure retry](#48-network-failure-during-commit--the-dangerous-middle-state) |
| `GET /orders/:orderId` and `GET /orders` | [§4.6 Success polling](#46-return-url-handling--success-path), [§4.8 Recovery probe](#48-network-failure-during-commit--the-dangerous-middle-state) — full surface covered in [`orders-flows.md`](./orders-flows.md) |

PayFast's `actionUrl` and `fields` are opaque payload from the mobile app's perspective — see [§3](#3-the-mobile-payfast-flow) for the WebView pattern.
