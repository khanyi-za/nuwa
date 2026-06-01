# YIIVA Auth — Mobile App Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA **buyer mobile app** on Expo / React Native.
> **Scope:** Screen-level flows, token storage, universal-link wiring, edge cases, and copy guidance for **every auth-related user journey** in the mobile app.
>
> **Companion docs:**
> - [`../Api-frontend-contracts/auth-module-api.md`](../Api-frontend-contracts/auth-module-api.md) — endpoint shapes, request/response, error tables. **Source of truth for the API contract** — shared with the merchant web app.
> - [`../Api-frontend-contracts/auth-frontend-flows.md`](../Api-frontend-contracts/auth-frontend-flows.md) — the merchant web app's equivalent of this doc. Useful comparison reading; the endpoints are identical but the UX differs.
>
> This doc focuses on **what the buyer sees on their phone and how they move through it**. Endpoint specifics live in the API contract; do not duplicate them here.

---

## Table of Contents

1. [Context](#1-context)
2. [Token storage and silent refresh](#2-token-storage-and-silent-refresh)
3. [Universal-link wiring](#3-universal-link-wiring)
4. [Screen-level flows](#4-screen-level-flows)
   - [4.1 Registration](#41-registration--registerscreen)
   - [4.2 "Check your email" handoff](#42-check-your-email-handoff)
   - [4.3 Email verification deep-link](#43-email-verification-deep-link)
   - [4.4 Login](#44-login--loginscreen)
   - [4.5 Forgot password](#45-forgot-password--forgotpasswordscreen)
   - [4.6 Reset password deep-link](#46-reset-password-deep-link)
   - [4.7 Logout](#47-logout)
   - [4.8 Guest checkout → claim account](#48-guest-checkout--claim-account)
5. [Edge-case UX](#5-edge-case-ux)
   - [5.1 Account suspended/deactivated mid-session](#51-account-suspendeddeactivated-mid-session)
   - [5.2 App backgrounded for hours, foregrounded with expired tokens](#52-app-backgrounded-for-hours-foregrounded-with-expired-tokens)
   - [5.3 Network failure during silent refresh](#53-network-failure-during-silent-refresh)
   - [5.4 Reset-password's revoke-all-sessions side effect](#54-reset-passwords-revoke-all-sessions-side-effect)
   - [5.5 Email-verification link on a device without the app](#55-email-verification-link-on-a-device-without-the-app)
6. [UX patterns and copy guidance](#6-ux-patterns-and-copy-guidance)
7. [Testing checklist](#7-testing-checklist)

---

## 1. Context

### Who uses this app

The YIIVA **buyer mobile app** is the consumer-facing Expo / React Native app where South African shoppers browse and buy across YIIVA's merchant stores. There is one persona here: the **buyer**.

| Persona | Role | What they do here |
|---|---|---|
| **Buyer** | `BUYER` | Browses stores, builds a multi-merchant cart, checks out via PayFast, tracks orders, manages addresses, saves to wishlist. |

There is no merchant, admin, or employee experience in this app — those personas use the merchant web app. A user with `role: MERCHANT` who somehow logs in here should land on the same buyer experience (their merchant capabilities only exist on the web). They are also a buyer; the two personas coexist on one account.

> **Configuration values used in copy:** the example copy throughout this document references `support@yiiva.co.za` as the support contact. Treat this as a **placeholder**. Confirm the live address with the team and pull it from app config rather than hardcoding it across screens.

### How this differs from the merchant web app

| | Buyer mobile app | Merchant web app |
|---|---|---|
| Platform | Expo / React Native (iOS + Android) | Next.js (web) |
| Token storage | `expo-secure-store` (Keychain / EncryptedSharedPreferences) | httpOnly cookie + memory |
| Email links | **Universal links** that open the app if installed | Plain web URLs |
| Sessions | Long-lived; users rarely sign out | Per-session; sign-out more common |
| Post-login destination | Always `Home` / discover feed | Routing matrix (see merchant doc) |
| Special flows | Guest checkout → claim account ([§4.8](#48-guest-checkout--claim-account)) | Employee invite acceptance |

### Auth-relevant states the UI must reason about

```
user.role           ∈ { BUYER, MERCHANT, ADMIN }      ← effectively always BUYER here
user.accountStatus  ∈ { ACTIVE, SUSPENDED, DEACTIVATED, PENDING_VERIFICATION }
user.isGuestAccount ∈ { true, false }                 ← relevant for the claim flow
```

The mobile app does not need to reason about `user.store` — that's a merchant-side concept. Ignore it if present in the `/auth/me` response.

> **Known limitation — guest-account email verification is stubbed.** When a buyer completes guest checkout and later claims the account, the backend currently sets `emailVerified: true` without sending a verification email (see CLAUDE.md). Once the Notifications module ships, this will be tightened to a real verify-by-email flow. For v1 mobile, **do not show "check your inbox" copy on claim** — the account is active immediately.

---

## 2. Token storage and silent refresh

### Storage

```
accessToken  → memory only (Zustand / Context store, never persisted)
refreshToken → expo-secure-store, key: "yiiva.refreshToken"
user (basic) → expo-secure-store, key: "yiiva.user" (optional cache for cold-start splash)
```

**Why memory for access token.** The access token lives 15 minutes. Losing it on app cold-start is fine — the persisted refresh token bootstraps a new one in the silent-refresh hook before the first protected screen renders.

**Why SecureStore for refresh token.** `expo-secure-store` writes to iOS Keychain and Android EncryptedSharedPreferences — system-level encryption backed by hardware where available. Don't use `AsyncStorage` for the refresh token; it's plaintext on disk.

```ts
import * as SecureStore from 'expo-secure-store';

await SecureStore.setItemAsync('yiiva.refreshToken', token, {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
});
```

`AFTER_FIRST_UNLOCK` lets the app read the token after the first device unlock following a reboot — required so background fetches and notifications can authenticate.

### Silent refresh

The backend access token expires every 15 minutes. The mobile app should silently refresh on three triggers:

1. **App cold-start** — before the first protected request, check for a stored refresh token and exchange it.
2. **401 from any protected request** — if the response message is `"Access token has expired"`, refresh and retry the original request once. Any other 401 (`"Account is inactive or does not exist"`, `"Invalid token"`) is a hard sign-out — do not retry.
3. **App foregrounded after backgrounding** — when `AppState` changes from `background` to `active`, if the in-memory access token's `exp` is past or near-past, refresh proactively before the next request fires. See [§5.2](#52-app-backgrounded-for-hours-foregrounded-with-expired-tokens) for the details.

Refresh tokens are **single-use** on the backend — every refresh rotates the token. Store the new one immediately on every successful `/auth/refresh` response; don't let two refresh calls race on the same stored token (see [§5.3](#53-network-failure-during-silent-refresh)).

### Auth state shape (recommended)

```ts
type AuthState =
  | { status: 'loading' }                       // cold-start, before refresh resolves
  | { status: 'authenticated'; user: User }
  | { status: 'guest' }                         // signed out (or never signed in)
  | { status: 'guest-with-cart'; guestCartToken: string }; // post-guest-checkout, pre-claim
```

The `guest-with-cart` state is relevant only to the [claim flow](#48-guest-checkout--claim-account). For most screens, `authenticated` vs `guest` is the distinction.

---

## 3. Universal-link wiring

Two backend email URLs need to open the mobile app on iOS/Android instead of a web browser:

| URL path | Used by | Email source |
|---|---|---|
| `https://yiiva.co.za/auth/verify-email?token=<rawToken>` | [§4.3 Email verification](#43-email-verification-deep-link) | `sendVerificationEmail` in `EmailService` |
| `https://yiiva.co.za/auth/reset-password?token=<rawToken>` | [§4.6 Reset password](#46-reset-password-deep-link) | `sendPasswordResetEmail` in `EmailService` |

Both are HTTPS URLs the merchant web app *also* serves — when the user taps the email link, the device decides:

- **App installed** → universal link routes to the mobile app's deep-link handler.
- **App not installed** → opens in the browser → merchant web app renders the verify/reset page → still works (see [§5.5](#55-email-verification-link-on-a-device-without-the-app)).

This is intentional: no backend change is required to add a separate buyer URL. The same email works for both apps.

### Expo configuration

**`app.json`** — declare the iOS Associated Domains and Android intent filters:

```json
{
  "expo": {
    "scheme": "yiiva",
    "ios": {
      "associatedDomains": ["applinks:yiiva.co.za"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/auth/verify-email" },
            { "scheme": "https", "host": "yiiva.co.za", "pathPrefix": "/auth/reset-password" }
          ],
          "category": ["BROWSABLE", "DEFAULT"],
          "autoVerify": true
        }
      ]
    }
  }
}
```

**Web team owns** the matching server-side files:

- `https://yiiva.co.za/.well-known/apple-app-site-association` (iOS — JSON, no extension)
- `https://yiiva.co.za/.well-known/assetlinks.json` (Android)

Both must list the mobile app's bundle ID and the path prefixes above. Coordinate with the web team to publish these before the first email-triggered flow ships to production.

### React Navigation handler

```ts
import * as Linking from 'expo-linking';

const linking = {
  prefixes: [
    'yiiva://',                             // dev / cold install fallback
    'https://yiiva.co.za',                  // production universal link
  ],
  config: {
    screens: {
      VerifyEmail:   'auth/verify-email',
      ResetPassword: 'auth/reset-password',
    },
  },
};
```

The token comes through as a route param (`route.params.token`).

---

## 4. Screen-level flows

Every flow in this section follows the same structure: **entry**, **what the user sees**, **API calls** (linked to the contract), **success path**, **error paths**.

### 4.1 Registration — `RegisterScreen`

**Entry:** unauthenticated user taps "Sign up" on the home screen, the login screen, or any auth-gated action's "Sign in or sign up" prompt.

**What the user sees:**

- Headline: **"Create your YIIVA account"**
- Subhead: *"Shop South African brands, in one app."*
- Form:
  - **Email** (required, validation: valid email)
  - **First name** (required, non-empty)
  - **Last name** (required, non-empty)
  - **Phone** (optional)
  - **Password** (required, with rules: 8+ chars, uppercase, lowercase, digit)
  - Show/hide password toggle
  - Live password-strength indicator: ✓ 8+ characters, ✓ uppercase, ✓ lowercase, ✓ number
- Submit button: **"Create account"** — disabled until form is valid + becomes spinner + label *"Creating your account…"* while in flight
- Below the form: *"Already have an account?"* with a **Sign in** link → `LoginScreen`

**Mobile keyboard hints (set on each input):**

| Field | `keyboardType` | `autoComplete` | `textContentType` (iOS) |
|---|---|---|---|
| Email | `email-address` | `email` | `username` |
| First name | `default` | `given-name` | `givenName` |
| Last name | `default` | `family-name` | `familyName` |
| Phone | `phone-pad` | `tel` | `telephoneNumber` |
| Password | `default`, `secureTextEntry` | `password-new` | `newPassword` |

These hints unlock iOS strong-password suggestions and Android autofill.

**Validation timing:**
- Email format: validate **on blur** (don't nag while typing)
- Password rules: live (the strength indicator updates as they type)
- Required-field check: on submit
- Inline errors appear **below the field**, in error-red

**API call:** `POST /auth/register` (see [contract](../Api-frontend-contracts/auth-module-api.md#post-authregister))

**Success path (201):**
- Navigate to [Check your email handoff](#42-check-your-email-handoff)
- Pre-populate the displayed email from the form

**Error paths:**

| Response | UX |
|---|---|
| `409 "Email already registered"` | Inline error on the **email** field: *"That email is already in use. Sign in instead?"* with an action that pushes `LoginScreen` with email prefilled. |
| `400` validation array | Map each error to its field (email, password, firstName, lastName) and show inline. |
| `429` rate limit | Toast: *"Too many sign-up attempts. Please wait a minute and try again."* Disable submit for 60 seconds. |
| Network/5xx | Toast: *"Couldn't reach YIIVA. Check your connection and try again."* Keep the form intact. |

---

### 4.2 "Check your email" handoff

**Entry:** navigated from a successful registration.

**What the user sees:**

- Large envelope icon
- Headline: **"Check your inbox"**
- Body: *"We've sent a verification link to **{email}**. Tap the link to activate your account."*
- Helper text: *"The link expires in 24 hours. Be sure to check your spam folder."*
- Helper card with an **"Open Mail app"** button — see implementation note below
- Secondary text link: *"Use a different email"* → `RegisterScreen` (clear the form)

**"Open Mail app" implementation:**

```ts
import * as Linking from 'expo-linking';
Linking.openURL('message://');         // iOS: opens default Mail
// Android: try 'mailto:' or fall back to an intent
```

Wrap in a try/catch — if no mail app is installed, hide the button.

**API calls:** none. This is a static handoff screen.

> **Known backend gap — no resend.**
> There is no `POST /auth/resend-verification` endpoint, and re-registering with the same email returns `409 "Email already registered"` without rotating the token. The token expires after 24 hours but the user record stays `PENDING_VERIFICATION` indefinitely — so a user who didn't receive the email **cannot recover on their own**.
>
> Until a resend endpoint exists, surface support as the recovery path:
>
> *"Didn't receive the email? Contact us at support@yiiva.co.za and we'll re-send it."*
>
> Track these requests — high volume signals to prioritise the resend endpoint on backend.

---

### 4.3 Email verification deep-link

**Entry:** the user taps the verification link in their email on a device with the app installed → iOS/Android opens the app → React Navigation routes to `VerifyEmail` with `route.params.token`.

**What the user sees:**

Three states: in-flight, success, error. **Render the in-flight state from screen mount** — don't show "Verifying…" only after the request starts.

| State | UI |
|---|---|
| **In-flight** | Centered spinner + *"Verifying your email…"* — full-screen, no chrome |
| **Success** | Brief checkmark + *"Welcome to YIIVA!"* for ~800ms, then auto-navigate to `Home` |
| **Error** | Headline: *"This verification link is invalid or has expired."* Body: *"Verification links work once and expire after 24 hours."* Action: **"Create a new account"** → `RegisterScreen` |

**API call:** on mount, immediately call `POST /auth/verify-email` with `{ token: route.params.token }` (see [contract](../Api-frontend-contracts/auth-module-api.md#post-authverify-email)).

**Success path (200):**
- Backend returns `{ accessToken, refreshToken, user }` — the user is auto-logged in
- Store tokens per [§2](#2-token-storage-and-silent-refresh)
- Brief success state, then navigate to `Home` (`reset` to clear the auth stack)

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired verification token"` | Error state above. Don't distinguish "wrong token" from "expired" — backend deliberately conflates them. |
| `429` | Error state with rate-limit copy: *"Too many attempts. Please wait a minute, then try the link again."* No retry button until cooldown passes. |
| Network/5xx | Same error state with copy *"Couldn't verify your email right now. Try again in a moment."* + a **"Try again"** button. |

**Edge case — already-verified user re-taps the link:** the verify call fails with `400` (token already consumed). Show the standard error screen but swap the action to **"Continue to YIIVA"** → if logged in, push `Home`; otherwise push `LoginScreen`.

---

### 4.4 Login — `LoginScreen`

**Entry:** unauthenticated user, from explicit "Sign in" tap, from post-logout, or from any auth-gated action.

**What the user sees:**

- Headline: **"Sign in to YIIVA"**
- Form:
  - **Email** (`keyboardType: email-address`, `autoComplete: email`)
  - **Password** (`secureTextEntry`, `autoComplete: password`) — show/hide toggle
- Submit: **"Sign in"** — disabled until both fields populated; spinner + *"Signing in…"* in flight
- Below the form:
  - **"Forgot password?"** → `ForgotPasswordScreen`
  - *"Don't have an account?"* with **Sign up** link → `RegisterScreen`

**Biometric unlock (post-first-login, optional v1+):**

If the user has signed in once on this device and biometrics are available (`expo-local-authentication`), offer a one-tap **"Sign in with Face ID / Touch ID"** above the form on subsequent visits. This decrypts the stored refresh token and bypasses the email/password form. Skip in v1 if it adds scope.

**API call:** `POST /auth/login` (see [contract](../Api-frontend-contracts/auth-module-api.md#post-authlogin))

**Success path (200):**
- Store tokens per [§2](#2-token-storage-and-silent-refresh)
- Navigate to `Home` (or to the destination captured before the auth prompt — see "redirect-after-auth pattern" below)
- The login response includes `user` with `role` — buyers can be `BUYER` or `MERCHANT` (a merchant who also shops). Both land on the same home screen; no role-based routing in this app.

**Error paths:**

| Response | UX |
|---|---|
| `401 "Invalid credentials"` | Inline banner above the form: *"Incorrect email or password."* Do **not** distinguish wrong email from wrong password — backend deliberately returns the same error for both. Re-enable submit. |
| `403 "Please verify your email before logging in"` | Replace the form: headline *"Verify your email first"*, body *"We sent a verification link when you signed up. Check your inbox."* + **"Back to sign in"** action. (No automatic resend yet.) |
| `403 "Your account has been suspended. Contact support."` | Replace the form: headline *"Account suspended"*, body uses the backend message exactly, plus an email link to `support@yiiva.co.za`. |
| `403 "This account has been deactivated."` | Same pattern — *"Account deactivated"*. |
| `400` validation | Inline field errors. |
| `429` | Banner: *"Too many sign-in attempts. Please wait a minute."* Disable submit for 60s. |

**Redirect-after-auth pattern:** when the user lands on `LoginScreen` from an auth-gated action (e.g., they tapped "Save to wishlist" while signed out), capture the original navigation intent (`returnTo: { screen, params }`) in the navigator state and restore it after a successful login.

---

### 4.5 Forgot password — `ForgotPasswordScreen`

**Entry:** "Forgot password?" link on `LoginScreen`.

**What the user sees:**

- Headline: **"Reset your password"**
- Body: *"Enter your email and we'll send you a link to set a new password."*
- Form:
  - **Email** (required, valid)
- Submit: **"Send reset link"** — spinner + *"Sending…"* in flight
- Back navigation → `LoginScreen`

**API call:** `POST /auth/forgot-password` (see [contract](../Api-frontend-contracts/auth-module-api.md#post-authforgot-password))

**Success path (200) — always the same UI:**

The backend **always returns 200** regardless of whether the email exists, is verified, or is suspended. Replace the form with:

- Headline: **"Check your inbox"**
- Body: *"If an account exists for **{email}**, we've sent a password reset link. The link expires in 1 hour."*
- Helper: *"Be sure to check your spam folder."*
- Helper card with **"Open Mail app"** (same pattern as [§4.2](#42-check-your-email-handoff))
- Action: **"Back to sign in"** → `LoginScreen`

> **Critical UX rule:** never show different copy for "email found" vs "email not found." The same confirmation screen always. This is intentional security — the backend will not reveal whether an email is registered, and exposing that distinction would defeat the purpose.

**Error paths:**

| Response | UX |
|---|---|
| `400` validation | Inline error on the email field. |
| `429` | Banner: *"Too many requests. Please wait a minute."* Disable submit for 60s. |

---

### 4.6 Reset password deep-link

**Entry:** the user taps the reset link in their email → universal link → React Navigation routes to `ResetPassword` with `route.params.token`.

**What the user sees:**

- Headline: **"Set a new password"**
- Form:
  - **New password** (required: 8+ chars, uppercase, lowercase, digit) — show/hide toggle, live strength indicator
  - **Confirm new password** (required, must match)
- Submit: **"Update password"** — spinner + *"Updating…"* in flight
- The token from `route.params.token` is held in component state — never shown.

**API call:** `POST /auth/reset-password` (see [contract](../Api-frontend-contracts/auth-module-api.md#post-authreset-password))

**Success path (200):**
- Navigate to `LoginScreen` with a top-of-screen success banner: *"Password updated. Sign in with your new password."*
- Add a secondary line: *"Note: any other devices you were signed in on will be signed out automatically."* (Anchored in [§5.4](#54-reset-passwords-revoke-all-sessions-side-effect).)

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired reset token"` | Replace the form: headline *"This reset link is no longer valid"*, body *"Reset links work once and expire after 1 hour."* Action: **"Request a new link"** → `ForgotPasswordScreen`. |
| `400` validation array | Inline errors on the password fields. |
| `429` | Banner: *"Too many attempts. Please wait a minute."* Disable submit for 60s. |
| Mismatched confirm | Frontend-only validation — inline error on confirm field: *"Passwords don't match."* Do not submit. |

---

### 4.7 Logout

**Trigger:** the profile / settings screen contains:
- **"Sign out"** (this device only) → `POST /auth/logout`
- **"Sign out everywhere"** (revoke all refresh tokens) → `POST /auth/logout-all`

Phone-app convention is that users almost never sign out — keep the controls discoverable but not prominent (settings, not the bottom tab bar).

**Optional confirmation for "Sign out everywhere":**

```
"Sign out of YIIVA on every device? You'll need to sign in again on each one."
[ Sign me out everywhere ]   [ Cancel ]
```

No confirmation for plain "Sign out."

**UX flow (both variants):**

This is **optimistic logout**. Do not block the user on the API response.

```
User taps Sign out
  → immediately clear access token from memory
  → immediately delete refreshToken from SecureStore
  → navigate to Home (in guest state)
  → fire POST /auth/logout (or /logout-all) in the background, ignore the response
```

The server-side revocation is a security measure; the local cleanup always happens regardless of whether the network call succeeds. From the user's perspective, sign-out is instant.

If the background call fails, log it but don't surface it.

---

### 4.8 Guest checkout → claim account

**Why this flow exists.** A buyer can complete checkout without an account (guest checkout). The backend creates a `User` record with `isGuestAccount: true` and the buyer's email, and attaches the order to that user. Later, the buyer can "claim" the account by setting a password against that same email — converting the guest record into a full account.

**This is the only auth flow specific to mobile.** The merchant web app has no guest checkout.

> **Backend reality check — the claim is email-based, not token-based.** `POST /auth/claim` accepts `{ email, password }` only. There is no claim token in the post-checkout response, no expiring claim link, no SecureStore claim state to manage. The backend trusts that someone tapping "Save my account" from inside the mobile app is the same person who just completed the guest checkout (the order-confirmation screen is the implicit authorisation context).
>
> This is acceptable for v1 because (a) the screen surface is only reachable post-checkout, and (b) guest accounts hold no sensitive state beyond an order record. It will tighten when the Notifications module lands and verification-by-email becomes the claim gate — this doc will be updated then.

**Flow:**

1. User completes guest checkout. The order-confirmation screen surfaces a **"Save my account"** CTA below the order details.
2. User taps "Save my account" → `ClaimScreen`.
3. Backend converts the guest user record in place and returns a confirmation message. User is **not** auto-logged in — they're sent to `LoginScreen` to sign in fresh with their new credentials.

**`ClaimScreen` — what the user sees:**

- Headline: **"Save your YIIVA account"**
- Body: *"Set a password to track this order, save addresses, and shop with one tap next time."*
- Form:
  - **Email** (prefilled from the guest checkout, **locked** — the order is bound to this email; the claim must use this exact email)
  - **Password** (required, min 8 characters) — show/hide toggle
- Submit: **"Save my account"** — spinner + *"Saving…"* in flight

> **Password rules on claim are lighter than registration.** The backend's `ClaimAccountDto` only enforces `MinLength(8)` — no uppercase/lowercase/digit checks. Frontend can either match this (just length) or display the same strength indicator as registration as a UX nicety. Don't enforce more than the backend does on submit, or valid passwords will be rejected client-side.

**API call:** `POST /auth/claim` with `{ email, password }`.

**Success path (200):**
- Backend returns `{ message: "Account claimed successfully. You can now log in with your email and password." }` — **no tokens, no auto-login**.
- Show a brief success state: *"Account saved!"*
- Navigate to `LoginScreen` with the email prefilled and a top-of-screen banner: *"Account saved. Sign in with your new password."*

> **No "check your inbox" copy on claim.** Per the [Known limitation](#auth-relevant-states-the-ui-must-reason-about) in §1, the backend currently sets `emailVerified: true` automatically on claim. The account is active immediately.

**Error paths:**

| Response | UX |
|---|---|
| `404 "No account found with this email address."` | Should be unreachable in normal flow since the email field is locked to the guest checkout email. If hit, surface as a banner and offer **"Create a new account"** → `RegisterScreen` with email prefilled. |
| `409 "This email already belongs to a registered account. Please log in."` | Replace the form: *"This account is already active."* Offer **"Sign in instead"** → `LoginScreen` with email prefilled. |
| `400` validation | Inline errors. |
| `429` | Banner + 60s disable. |

---

## 5. Edge-case UX

### 5.1 Account suspended/deactivated mid-session

**Scenario:** the user is logged in and active. An admin suspends/deactivates them. On the next API call, the JWT is still cryptographically valid but `JwtStrategy` checks `accountStatus === ACTIVE` and throws `401 "Account is inactive or does not exist"`.

**UX:**

- The 401 interceptor sees the message *"Account is inactive or does not exist"* — this is **not** the same as *"Access token has expired"*, so do **not** attempt silent refresh. Refresh would just fail too.
- Immediately:
  - Clear access token from memory
  - Delete refresh token from SecureStore
  - Replace the current screen with a full-screen takeover:

```
Headline: Your account is no longer active
Body:    Please contact support@yiiva.co.za if you think this is a mistake.
Action:  [ Contact support ]   [ Back to sign in ]
```

- "Contact support" opens the Mail app pre-addressed to support.
- "Back to sign in" navigates to `LoginScreen` (next sign-in attempt will surface the suspended/deactivated error from `POST /auth/login`).

> **Implementation note:** the backend coalesces `SUSPENDED`, `DEACTIVATED`, and "user deleted" into one message. Don't try to distinguish; the generic copy above covers all three.

---

### 5.2 App backgrounded for hours, foregrounded with expired tokens

**Scenario:** the user opens the app, gets pulled away, returns 6 hours later. Both the access token (15 min) and possibly the refresh token (if longer than 7 days have passed since last refresh) have expired.

**UX:**

- Subscribe to `AppState` changes. On `background → active`:
  - If access token's `exp` is past or within 60 seconds of past, **proactively refresh** before any other API call fires.
  - Show a small unobtrusive top-of-screen spinner band (*"Syncing…"*) during the refresh — don't blank out the screen.
- If refresh succeeds, dismiss the spinner.
- If refresh fails with `401 "Invalid or expired refresh token"`:
  - Replace the current screen with `LoginScreen`
  - Top-of-screen banner: *"You've been signed out. Please sign in again."*
  - Preserve the user's current scroll position / cart state if possible (these don't require auth to render).

> **Why proactive:** mobile networks are higher-latency than desktop. Letting the user tap a button and then waiting for a refresh + retry produces a sluggish feel. Refreshing during the foreground transition is invisible to the user.

---

### 5.3 Network failure during silent refresh

**Scenario:** silent refresh fails due to network (timeout, offline, DNS hiccup). Cannot distinguish from "actually expired."

**UX:**

- **Retry once** after a brief delay (1.5–2 seconds). Many transient failures recover quickly.
- If the second attempt also fails:
  - If the response was `401`/`403` → real auth failure → clear local state + navigate to `LoginScreen`
  - If the response was a network error / timeout / 5xx → show a non-blocking toast: *"Connection issue. Trying again…"* and retry once more after 5 seconds. After three total failures, navigate to `LoginScreen`.
- **Never indefinitely loop.** Three attempts is the max.

The original request that triggered the refresh should not be retried until the refresh succeeds. If the refresh ultimately fails, drop the original request.

**Concurrency guard:** if two requests both 401 simultaneously, both will trigger a refresh. Wrap the refresh call in a single-flight promise — the second caller awaits the first's result instead of firing its own refresh (which would consume + invalidate the same token).

```ts
let refreshInFlight: Promise<TokenPair> | null = null;
async function ensureFreshToken() {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
```

---

### 5.4 Reset-password's revoke-all-sessions side effect

**Scenario:** the user has YIIVA on Device A (phone) and Device B (laptop). On Device A, they go through forgot-password → reset-password. After successful reset:

- All refresh tokens for the user are revoked
- Device A is **not automatically signed in** — the reset endpoint sends the user to `LoginScreen` with their new password.
- Device B's access token still works until expiry (~15 min). After that, the silent refresh fails because the refresh token was revoked.

**UX:**

**On Device A (where the reset happened):**
- After navigating to `LoginScreen` with the success banner, also include the consequence:
  - *"Your other YIIVA sessions have been signed out for security. Sign in again on any device you use."*
- The user signs in fresh.

**On Device B (the other device):**
- The next protected API call returns `401 "Invalid or expired refresh token"` from the refresh attempt.
- Standard sign-out flow kicks in: clear state → navigate to `LoginScreen` with the standard "Your session has expired" banner.
- The user has no way to know it was *because* of the reset — that's fine; the experience is "session expired, sign in again."

---

### 5.5 Email-verification link on a device without the app

**Scenario:** the user registers on a laptop (not on the phone) and taps the verification link in their laptop email client.

**Behaviour:**
- The link is a normal HTTPS URL → opens in the laptop's browser → merchant web app renders the verify-email page → verifies the account.
- The mobile app never sees the link. That's fine — when the user opens the mobile app later and signs in, their account is already `ACTIVE`.

**Conversely**, if the user registers on the phone and taps the link in a phone email client:
- iOS/Android intercepts the universal link → opens the mobile app → routes to `VerifyEmail`.
- The web app never sees the link.

**Edge case — the user taps the email link on a phone *without* the mobile app installed:**
- Universal-link claim fails → falls back to opening `https://yiiva.co.za/auth/verify-email?token=...` in the phone's browser.
- The merchant web app renders the verify page in mobile browser → verifies → shows a "Welcome to YIIVA!" page with a **"Download the YIIVA app"** prompt (App Store + Play Store badges).
- Web team owns that landing page's content. Coordinate that the verify-success state on web includes the "download the app" CTA for buyer flows specifically.

---

## 6. UX patterns and copy guidance

### Tone

The app is for South African buyers. Keep copy warm, conversational, and concrete. Avoid corporate phrasing. Examples:

| Don't | Do |
|---|---|
| *"Authentication required."* | *"Sign in to keep going."* |
| *"An error has occurred."* | *"Couldn't reach YIIVA. Check your connection."* |
| *"Submission successful."* | *"Account saved. Welcome to YIIVA!"* |

### Loading states

- Buttons: spinner-in-button with verb-form text (*"Signing in…"*, *"Sending…"*). Never change to *"Loading…"* — keep the action verb.
- Full-screen loading: only on cold-start splash, deep-link landings (verify-email, reset-password), and the optimistic-cleared sign-out state.
- Inline loading (e.g., during a refresh): a thin top-of-screen progress bar is less disruptive than a centered spinner.

### Error toasts vs banners

- **Toast** (auto-dismissing, 3-5s): transient errors (network blips, rate limits during background refresh)
- **Banner** (persistent until acknowledged): errors that block the current action (invalid credentials, validation)
- **Full-screen takeover**: account-state errors (suspended, deactivated) — the user cannot proceed without an explicit action

### Accessibility

- Set `accessibilityLabel` on every interactive element. *"Sign in button. Disabled until email and password are entered."* for buttons; *"Email input"* for fields.
- Form errors: also set `accessibilityLiveRegion="polite"` on the error text so screen readers announce them.
- Color contrast: error text must meet WCAG AA (4.5:1) against background.

---

## 7. Testing checklist

Before considering the auth surface done, run through this list **on a real device** (not just the simulator — universal links behave differently on hardware):

### Registration + verification
- [ ] Register a new buyer; receive verification email
- [ ] Tap email link on phone with app installed → app opens to `VerifyEmail` → success → land on `Home`
- [ ] Tap email link on phone *without* the app → opens web → verifies → web shows app download prompt
- [ ] Tap email link a second time → app shows the "already verified" error state with "Continue to YIIVA"
- [ ] Wait 24+ hours, tap an unused token → "link expired" state
- [ ] Re-register the same unverified email → 409 surfaces correctly

### Login
- [ ] Sign in with correct credentials → land on `Home` with persisted session
- [ ] Sign in with wrong password → `401` banner, form stays editable
- [ ] Sign in with unverified email → "Verify your email first" full-screen state
- [ ] Sign in with suspended account → suspended takeover screen
- [ ] Force-close the app, reopen → still signed in (silent refresh restored)
- [ ] Toggle airplane mode mid-login → toast, form stays editable

### Forgot password + reset
- [ ] Request reset for an existing email → "check your inbox" screen
- [ ] Request reset for a non-existent email → **same** screen (security)
- [ ] Tap reset link → `ResetPassword` opens with token in route params
- [ ] Submit new password → land on `LoginScreen` with success + "other devices signed out" banner
- [ ] Sign in on the laptop afterwards → forced sign-in again (refresh tokens revoked)

### Logout
- [ ] Tap "Sign out" → immediate navigation to `Home` (guest) → background API call doesn't block
- [ ] Tap "Sign out everywhere" → confirmation dialog → on confirm, same instant behaviour
- [ ] Force-close mid-logout → next launch is in guest state (local cleanup persisted before kill)

### Edge cases
- [ ] Background app for 1h → foreground → spinner band → continues without an interaction prompt
- [ ] Background for 8+ days (refresh token expired) → foreground → forced to `LoginScreen` with "session expired" banner
- [ ] Suspend the user via admin tool while they're active → next API call → suspended takeover screen
- [ ] Open the app on a device where SecureStore is locked (rare; immediately after boot before unlock) → app waits, no crash

### Guest claim
- [ ] Complete guest checkout → "Save my account" CTA shows on order confirmation
- [ ] Tap CTA → `ClaimScreen` with email locked and prefilled from the guest checkout
- [ ] Set a valid password (8+ chars) → success state → land on `LoginScreen` with email prefilled
- [ ] Sign in with the new credentials → land on `Home` authenticated
- [ ] After a successful claim, navigate back to `ClaimScreen` and re-submit → 409 "already belongs to a registered account" state with "Sign in instead" action
- [ ] Try claiming with an email that has no guest record → 404 fallback state (should be unreachable via UI since the field is locked)

### Universal links
- [ ] Cold-tap a verify-email link from email client → app opens correctly (not the browser)
- [ ] App killed, then verify-email link tapped → app cold-launches into `VerifyEmail`
- [ ] On Android: long-press the email link → confirm the system shows "Open in YIIVA" as the default action
- [ ] On iOS: link preview shows the YIIVA app icon

---

## Appendix — Endpoint cross-reference

For request/response shapes, error tables, and rate limits, see [`auth-module-api.md`](../Api-frontend-contracts/auth-module-api.md). The endpoints used in this doc:

| Endpoint | Used in |
|---|---|
| `POST /auth/register` | [§4.1](#41-registration--registerscreen) |
| `POST /auth/verify-email` | [§4.3](#43-email-verification-deep-link) |
| `POST /auth/login` | [§4.4](#44-login--loginscreen) |
| `POST /auth/refresh` | [§2](#2-token-storage-and-silent-refresh), [§5.2](#52-app-backgrounded-for-hours-foregrounded-with-expired-tokens), [§5.3](#53-network-failure-during-silent-refresh) |
| `POST /auth/logout` | [§4.7](#47-logout) |
| `POST /auth/logout-all` | [§4.7](#47-logout) |
| `POST /auth/forgot-password` | [§4.5](#45-forgot-password--forgotpasswordscreen) |
| `POST /auth/reset-password` | [§4.6](#46-reset-password-deep-link) |
| `POST /auth/claim` | [§4.8](#48-guest-checkout--claim-account) — **not yet documented in `auth-module-api.md`**; request shape is `{ email, password }`, success returns `{ message }` (no tokens). |
| `GET /auth/me` | Session validation on cold-start, silent refresh, and any auth-state-changing action |
