# YIIVA Auth — Frontend Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA merchant web app (Next.js).
> **Scope:** Screen-level flows, role-based routing, edge cases, and copy guidance for **all auth-related user journeys** in the merchant web app. Consumer mobile-app auth flows will be documented separately.
>
> **Companion docs:**
> - [`auth-module-api.md`](./auth-module-api.md) — endpoint shapes, request/response, error tables. Source of truth for API contract.
> - [`../auth-guide.md`](../auth-guide.md) — token storage, silent-refresh interceptor, request setup. The "how to wire it up" guide.
>
> This doc focuses on **what the user sees and how they move through it**. Cross-reference the contract for endpoint specifics; do not duplicate them here.

---

## Table of Contents

1. [Context](#1-context)
2. [Screen-level flows](#2-screen-level-flows)
   - [2.1 Registration](#21-registration--auth-register)
   - [2.2 "Check your email" handoff](#22-check-your-email-handoff)
   - [2.3 Email verification landing](#23-email-verification-landing--authverify-email)
   - [2.4 Login](#24-login--login)
   - [2.5 Forgot password](#25-forgot-password--forgot-password)
   - [2.6 Reset password](#26-reset-password--authreset-password)
   - [2.7 Logout (current device + everywhere)](#27-logout-current-device--everywhere)
   - [2.8 Invite landing — public, pre-auth](#28-invite-landing--public-pre-auth)
   - [2.9 Invite acceptance — authenticated](#29-invite-acceptance--authenticated)
3. [Post-login routing matrix](#3-post-login-routing-matrix)
   - [3.1 The matrix](#31-the-matrix)
   - [3.2 First-time-user onboarding](#32-first-time-user-onboarding)
4. [Edge-case UX](#4-edge-case-ux)
   - [4.1 Account suspended/deactivated mid-session](#41-account-suspendeddeactivated-mid-session)
   - [4.2 Multi-tab coordination](#42-multi-tab-coordination)
   - [4.3 Network failure during silent refresh](#43-network-failure-during-silent-refresh)
   - [4.4 Reset-password's revoke-all-sessions side effect](#44-reset-passwords-revoke-all-sessions-side-effect)
5. [UX patterns & copy guidance](#5-ux-patterns--copy-guidance)
6. [Testing checklist](#6-testing-checklist)

---

## 1. Context

### Who uses this app

The YIIVA **merchant web app** is the back-of-house Next.js platform that hosts the merchant dashboard, admin panel, and employee views. It serves three personas:

| Persona | Role | What they do here |
|---|---|---|
| **Merchant** | `MERCHANT` | Owns a store. Manages products, orders, branding, payouts, employees. |
| **Employee** | `BUYER` (technically) | Invited by a merchant to help manage their store. Same store-management actions as the merchant *except* invite/remove employees, submit/request go-live, and edit bank details. |
| **Admin** | `ADMIN` | YIIVA staff. Reviews store applications, approves go-live requests, manages categories, moderates the platform. |

There is no buyer-facing shopping experience in this app. Buyers shop on the **consumer mobile app**. However, brand-new users who register via this web app land here as `BUYER` — they can either start a store (becoming a merchant) or sign out. There is no third path for buyers in this app.

> **Configuration values used in copy:** the example copy throughout this document references `support@yiiva.co.za` as the support contact. Treat this as a **placeholder**. Confirm the live address with the team and pull it from frontend config (e.g. `NEXT_PUBLIC_SUPPORT_EMAIL`) rather than hardcoding it across screens.

### Auth-relevant states the UI must reason about

The user's experience on every page is determined by the combination of four signals from `GET /auth/me`:

```
user.role          ∈ { BUYER, MERCHANT, ADMIN }
user.accountStatus ∈ { ACTIVE, SUSPENDED, DEACTIVATED, PENDING_VERIFICATION }
user.store         null | { id, displayName, slug, status, logoUrl, rejectionReason }
user.store.status  ∈ { DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE, SUSPENDED, CLOSED }
```

> **Important:** A user accessing the merchant web app is logged in once and stays logged in across sessions via the silent-refresh flow. The frontend re-evaluates the routing matrix in [§3](#3-post-login-routing-matrix) on every app init and after any state-changing action.

> **Known v1 limitation — employees have no auto-discovery of their store.**
>
> Employees retain `role: BUYER` after accepting an invite, and the merchant web app currently has **no `/auth/me` field that lists store memberships**. So an employee logging in will see `user.store === null` and `user.role === BUYER`, with no programmatic way to find the store they have access to.
>
> Until a backend endpoint like `/auth/me/employments` exists, employees must re-enter the store via the link from their invitation email — or you can persist `store.id` in localStorage at acceptance time as a workaround. The screens described in this doc **assume a merchant-owned store** unless explicitly stated. Coordinate with backend to close this gap before the employee dashboard is fully functional.

---

## 2. Screen-level flows

Every flow in this section follows the same structure: **entry**, **what the user sees**, **API calls** (linked to the contract), **success path**, **error paths**.

### 2.1 Registration — `/register`

**Entry:** unauthenticated user navigates to `/register`. Also reachable from the login screen via "Don't have an account? Sign up" and from the public invite landing if the recipient doesn't yet have a YIIVA account.

**What the user sees:**

- Headline: **"Create your YIIVA account"**
- Subhead: "Start your brand on South Africa's home for creative commerce."
- Form:
  - **Email** (required, validation: valid email)
  - **First name** (required, non-empty)
  - **Last name** (required, non-empty)
  - **Phone** (optional)
  - **Password** (required, with rules: 8+ chars, uppercase, lowercase, digit)
  - Show/hide password toggle
  - Live password-strength indicator: ✓ 8+ characters, ✓ uppercase, ✓ lowercase, ✓ number
- Submit button: **"Create account"** — disabled until form is valid + becomes spinner+label "Creating your account…" while in flight
- Below the form: "Already have an account? **Sign in**" link → `/login`

**Validation timing:**
- Email format: validate **on blur** (don't nag while typing)
- Password rules: live (the strength indicator updates as they type — feels rewarding, not nagging)
- Required-field check: on submit
- Inline errors appear **below the field**, in red

**API call:** `POST /auth/register` (see [contract](./auth-module-api.md#post-authregister))

**Success path (201):**
- Navigate to the [Check your email handoff](#22-check-your-email-handoff) screen
- Pre-populate the displayed email from the form

**Error paths:**

| Response | UX |
|---|---|
| `409 "Email already registered"` | Inline error on the **email** field: *"That email is already in use. Sign in instead?"* with a link to `/login` |
| `400` validation array | Map each error to its field (email, password, firstName, lastName) and show inline |
| `429` rate limit | Banner above the form: *"Too many sign-up attempts. Please wait a minute and try again."* Disable the submit button for 60 seconds. |

**Optional URL parameters:**

The registration screen accepts two optional query parameters to support cross-flow handoffs:

| Param | Purpose | Used by |
|---|---|---|
| `?email=<value>` | Pre-populate the email field. Don't lock — the user may want to use a different account. | Invite acceptance (see [employee journey §4](./employee-journey.md#4-phase-2--the-authentication-path)) |
| `?returnUrl=<path>` | Capture and restore the destination URL after registration completes (analogous to the login pattern in [§2.4](#24-login--login)). Validate the path against your routing-matrix permissions before redirect. | Invite acceptance, deep links, future flows |

When `?email=` is present, surface a small helper note under the field: *"This email matches the invite. You can change it if you'd rather use a different account."* — explicit but not coercive.

---

### 2.2 "Check your email" handoff

**Entry:** redirect from successful registration. Also (future) from a "resend verification" action.

**What the user sees:**

- Large checkmark or envelope icon
- Headline: **"Check your inbox"**
- Body: *"We've sent a verification link to **{email}**. Click the link to activate your account."*
- Helper text: *"The link expires in 24 hours. Be sure to check your spam folder if you don't see it within a few minutes."*
- Two secondary actions:
  - **"Use a different email"** → `/register` (clear the form, no warning — re-registration is fine since the previous account hasn't been activated)
  - **"I've verified — sign in"** → `/login` (in case the user verified in another tab and wants to come back here)

**API calls:** none. This is a static handoff page.

> **Known backend gap — no recovery for missed verification emails.**
>
> There is no `POST /auth/resend-verification` endpoint, and re-registering with the same email returns `409 "Email already registered"` **without rotating the verification token or re-sending the email**. The token expires after 24 hours but the user record stays in `PENDING_VERIFICATION` indefinitely, so a user who didn't receive their email **cannot recover on their own**.
>
> Until a resend endpoint exists, **do not show a "Resend email" button** (it would have nothing to call). Instead, surface the support contact as the recovery path:
>
> *"Didn't receive the email? Contact us at support@yiiva.co.za and we'll re-send it manually."*
>
> Place this as a small text link below the helper copy. Track the frequency of these support requests — high volume is the signal to prioritise the resend endpoint on the backend.

---

### 2.3 Email verification landing — `/auth/verify-email`

**Entry:** the user clicks the verification link in their email. The link format is `https://<domain>/auth/verify-email?token=<rawToken>`.

**What the user sees:**

The screen has three states: in-flight, success, error. **Make the in-flight state default-visible** — don't show "Verifying…" only after a request starts; render it from page mount onwards.

| State | UI |
|---|---|
| **In-flight** | Centered spinner with text *"Verifying your email…"* — full-page, no chrome |
| **Success** | Brief checkmark + *"Welcome to YIIVA!"* for ~800ms, then auto-redirect based on role |
| **Error** | Headline: *"This verification link is invalid or has expired."* Body: *"Verification links work once and expire after 24 hours."* Action: **"Create a new account"** → `/register` (with email field empty) |

**API call:** on mount, extract `?token=` from the query string and immediately call `POST /auth/verify-email` (see [contract](./auth-module-api.md#post-authverify-email)).

**Success path (200):**
- Backend returns `{ accessToken, refreshToken, user }` — the user is auto-logged in
- Store tokens per the [integration guide](../auth-guide.md#1-token-storage-recommendation)
- Brief success state, then redirect using the [routing matrix](#3-post-login-routing-matrix). For a freshly verified BUYER with no store, that's [first-time-user onboarding](#32-first-time-user-onboarding).

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired verification token"` | Error state above. Don't distinguish "wrong token" from "expired" — backend deliberately conflates them. |
| `429` | Error state with rate-limit copy: *"Too many attempts. Please wait a minute, then refresh this page."* No action button until cooldown passes. |
| Network/5xx | Same error state with copy *"We couldn't verify your email right now. Try refreshing this page in a moment."* + a **"Try again"** button that re-fires the request. |

**Edge:** if the user is already logged in (silent-refresh restored their session) and they click another verification link, the verify call will likely fail with 400 (token already consumed). Show the standard error screen — they're already verified, so the "Create a new account" recovery doesn't apply. Instead, swap the action button for **"Go to dashboard"** → routing matrix.

---

### 2.4 Login — `/login`

**Entry:** unauthenticated user, either from explicit navigation, from the post-logout redirect, or from a redirect-after-auth flow (e.g., the public invite landing).

**What the user sees:**

- Headline: **"Sign in to YIIVA"**
- Form:
  - **Email** (required, valid)
  - **Password** (required) — show/hide toggle
- Submit: **"Sign in"** — disabled until both fields populated; spinner + *"Signing in…"* while in flight
- Below the form:
  - **"Forgot password?"** → `/forgot-password`
  - **"Don't have an account? Sign up"** → `/register`

**Validation timing:**
- Email format: on blur
- Required check: on submit

**API call:** `POST /auth/login` (see [contract](./auth-module-api.md#post-authlogin))

**Success path (200):**
- Store tokens per the [integration guide](../auth-guide.md#1-token-storage-recommendation)
- Determine the destination using the [routing matrix](#3-post-login-routing-matrix)
- Important: the login response includes `user` with `role` but **does not include the store**. To compute the destination, immediately follow up with `GET /auth/me` so you have `store`. Show a brief loading splash during this step rather than flashing the wrong screen.

**Error paths:**

| Response | UX |
|---|---|
| `401 "Invalid credentials"` | Banner above the form: *"Incorrect email or password."* Do **not** distinguish wrong email from wrong password — the backend deliberately returns the same error for both. Re-enable the submit button. |
| `403 "Please verify your email before logging in"` | Replace the form with a small page: headline *"Verify your email first"*, body *"We sent a verification link when you signed up. Check your inbox."* + a **"Back to sign in"** secondary action. (No automatic resend yet.) |
| `403 "Your account has been suspended. Contact support."` | Replace the form: headline *"Account suspended"*, body uses the message exactly as the backend returns it, plus an email link to `support@yiiva.co.za`. |
| `403 "This account has been deactivated."` | Same pattern — *"Account deactivated"*, body uses the backend message, plus support link. |
| `400` validation | Inline field errors. |
| `429` | Banner: *"Too many sign-in attempts. Please wait a minute."* Disable submit for 60s. |

**The redirect-after-auth pattern:** When the user lands on `/login` from a protected route (e.g., they tried to open `/dashboard` while signed out), capture the original URL as `?returnUrl=...` and restore it after a successful login instead of following the routing matrix's default. Example: `/login?returnUrl=/dashboard/products` → after login, push to `/dashboard/products` (still validate it matches the routing matrix's permissions).

---

### 2.5 Forgot password — `/forgot-password`

**Entry:** "Forgot password?" link on the login screen.

**What the user sees:**

- Headline: **"Reset your password"**
- Body: *"Enter your email and we'll send you a link to set a new password."*
- Form:
  - **Email** (required, valid)
- Submit: **"Send reset link"** — spinner + *"Sending…"* while in flight
- "Back to sign in" link → `/login`

**API call:** `POST /auth/forgot-password` (see [contract](./auth-module-api.md#post-authforgot-password))

**Success path (200) — always the same UI:**

The backend **always returns 200** regardless of whether the email exists, is verified, or is suspended. Replace the form with a confirmation screen:

- Headline: **"Check your inbox"**
- Body: *"If an account exists for **{email}**, we've sent a password reset link. The link expires in 1 hour."*
- Helper: *"Be sure to check your spam folder."*
- Action: **"Back to sign in"** → `/login`

> **Critical UX rule:** never show different copy for "email found" vs "email not found." The same confirmation screen always. This is intentional security — the backend will not reveal whether an email is registered, and exposing that distinction would defeat the purpose.

**Error paths:**

| Response | UX |
|---|---|
| `400` validation | Inline error on the email field. |
| `429` | Banner: *"Too many requests. Please wait a minute."* Disable submit for 60s. |

---

### 2.6 Reset password — `/auth/reset-password`

**Entry:** the user clicks the reset link in their email. URL format: `https://<domain>/auth/reset-password?token=<rawToken>`.

**What the user sees:**

- Headline: **"Set a new password"**
- Form:
  - **New password** (required, validation: 8+ chars, uppercase, lowercase, digit) — show/hide toggle, live strength indicator (same as registration)
  - **Confirm new password** (required, must match new password)
- Submit: **"Update password"** — spinner + *"Updating…"* while in flight
- The token from `?token=` is held in component state, never displayed or editable.

**API call:** `POST /auth/reset-password` (see [contract](./auth-module-api.md#post-authreset-password))

**Success path (200):**
- Redirect to `/login` with a top-of-page success banner: *"Password updated. Sign in with your new password."*
- Also include a secondary line: *"Note: any other devices you were signed in on will be signed out automatically."* (Anchored in [§4.4](#44-reset-passwords-revoke-all-sessions-side-effect).)

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired reset token"` | Replace the form: headline *"This reset link is no longer valid"*, body *"Reset links work once and expire after 1 hour."* Action: **"Request a new link"** → `/forgot-password`. |
| `400` validation array | Inline errors on the password fields (e.g., "Password is too short"). |
| `429` | Banner: *"Too many attempts. Please wait a minute."* Disable submit for 60s. |
| Mismatched confirm | Frontend-only validation — show inline error on confirm field: *"Passwords don't match."* Do not submit. |

---

### 2.7 Logout (current device + everywhere)

**Trigger:** the **profile menu** in the app's top-right corner contains:
- **"Sign out"** (this device only) → `POST /auth/logout`
- **"Sign out everywhere"** (revoke all refresh tokens) → `POST /auth/logout-all`

**Optional confirmation dialog for "Sign out everywhere":**
*"Sign out of YIIVA on every device? You'll need to sign in again on each one."* with **"Sign me out everywhere"** / **"Cancel"** actions.

No confirmation needed for plain "Sign out."

**UX flow (both variants):**

This is **optimistic logout**. Do not block the user on the API response.

```
User clicks Sign out
  → immediately clear access token from memory
  → immediately clear refresh-token httpOnly cookie via the Next.js API route
  → redirect to /login
  → fire POST /auth/logout (or /logout-all) in the background, ignore the response
```

The server-side revocation is a security measure; the local cleanup always happens regardless of whether the network call succeeds. From the user's perspective, sign-out is instant.

**No error handling needed in the UI.** If the background call fails, log it but don't surface it.

---

### 2.8 Invite landing — public, pre-auth

**Entry:** the recipient clicks the link in their invitation email. URL format: `https://<domain>/invites/accept?token=<rawToken>` (or whatever path you choose — coordinate with the email template).

**What the user sees:**

The screen has three states: in-flight, valid, invalid.

| State | UI |
|---|---|
| **In-flight** | Spinner + *"Loading invite…"* |
| **Valid** | The store's branded card: logo, **displayName**, plus *"You've been invited to help manage **{displayName}** on YIIVA."* and *"This invite was sent to **{email}**."* Below: a contextual primary action (see logic below). |
| **Invalid** | Headline *"This invite is no longer valid"*, body *"Invitations expire after 7 days, or may have already been accepted."* Action: contact the merchant who invited you. |

**API call:** on mount, `GET /employees/invites/validate?token=<rawToken>` (see [contract](./auth-module-api.md#get-employeesinvitesvalidate)). This is `@Public()` — no auth required.

**Success path (200) — primary action depends on the user's auth state:**

| Current frontend state | Primary action |
|---|---|
| Not logged in | **"Sign in to accept"** → `/login?returnUrl=/invites/accept?token=<rawToken>` |
| Not logged in *and* this is likely a new user | Show both: **"Sign in to accept"** *or* **"Create a YIIVA account"** → `/register?email=<invite.email>&returnUrl=...` |
| Logged in as a user whose email matches `invite.email` | **"Accept invitation"** → fires the [authenticated accept flow](#29-invite-acceptance--authenticated) |
| Logged in as a different email | Warning banner *"This invite was sent to {invite.email}, but you're signed in as {user.email}."* + **"Sign out and switch account"** action |

> **Tip:** pre-populating the registration form with `invite.email` (and ideally locking the field) shortens the path for users who don't yet have an account. Add a small note: *"This email matches the invite. You can change it after signing up."* — but do NOT lock it, because they may want to use a different account they already have.

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired invitation"` | Invalid state above. |
| Network/5xx | Generic error with **"Try again"** button. |

---

### 2.9 Invite acceptance — authenticated

**Entry:** the user is now signed in (came back from `/login` or `/register` with `returnUrl`) and the validate call has succeeded.

**What the user sees:**

- The same store branding card as in [§2.8](#28-invite-landing--public-pre-auth)
- Optional input: **Employee number** (free text, max 50 chars) — *"Some teams track members by employee numbers. You can leave this blank."*
- Submit: **"Join {store.displayName}"** — spinner + *"Joining…"* while in flight

**API call:** `POST /employees/invites/accept` with `{ token, employeeNumber? }` (see [contract](./auth-module-api.md#post-employeesinvitesaccept))

**Success path (200):**
- Show a brief celebration state *"You're in! Taking you to {store.displayName}…"*
- Redirect to the store dashboard for that `store.id`

> **Caveat:** as noted in [§1](#note-on-employees), the merchant web app currently lacks a clean way for an employee to *return* to the store dashboard after their session ends, because `/auth/me` does not list employments. For v1, document this limitation and rely on the user revisiting the invite email's link, OR persist the `store.id` in localStorage at acceptance time so the dashboard can be re-entered. Coordinate with backend to add an employments endpoint as a follow-up.

**Error paths:**

| Response | UX |
|---|---|
| `400 "Invalid or expired invitation"` | Replace the form with the invalid-invite UI from [§2.8](#28-invite-landing--public-pre-auth). |
| `400 "This invitation was sent to a different email address. Please log in with the correct account."` | Banner: *"This invite was sent to **{invite.email}**, but you're signed in as **{user.email}**."* Action: **"Sign out and use the right account"** → triggers logout flow then sends the user to `/login?returnUrl=/invites/accept?token=...` |

---

## 3. Post-login routing matrix

This is the canonical decision table for **where to send the user after authentication, on every app load, and after any state-changing action**. Re-evaluate it whenever `GET /auth/me` is fetched.

### 3.1 The matrix

| `user.role` | `user.store` | `user.store.status` | `user.store.rejectionReason` | Screen | Notes |
|---|---|---|---|---|---|
| BUYER | `null` | — | — | **Onboarding** — "Apply to sell on YIIVA" | New user. See [§3.2](#32-first-time-user-onboarding). |
| BUYER | present | `DRAFT` | `null` | **Store setup wizard** | Continuing a fresh application. |
| BUYER | present | `DRAFT` | populated | **Store setup wizard** + rejection banner | First-review rejection. The banner stays until the user *edits anything* (which auto-clears `rejectionReason`) or resubmits. |
| BUYER | present | `PENDING_REVIEW` | — | **"Application under review"** read-only status page | No editing while review is in flight. Show the submission timestamp and an explainer of the next steps. |
| MERCHANT | present | `APPROVED` | `null` | **Merchant dashboard** + "Add products & request go-live" prompt | Approved at first gate but not yet live. Surface the go-live readiness checklist. |
| MERCHANT | present | `APPROVED` | populated | **Merchant dashboard** + go-live rejection banner | Second-gate rejection. **The banner persists until the merchant calls `request-go-live` again** — edits in `APPROVED` do not clear the reason. See [store contract](./store-module-api.md). |
| MERCHANT | present | `PENDING_GO_LIVE` | — | **"Final review in progress"** read-only status page | Same pattern as `PENDING_REVIEW`. |
| MERCHANT | present | `ACTIVE` | — | **Full merchant dashboard** | Live store, normal operating mode. |
| MERCHANT | present | `SUSPENDED` | — | **"Store suspended"** notice with support contact | Read-only. No actions available. |
| MERCHANT | present | `CLOSED` | — | **"Store closed"** notice | Read-only. |
| ADMIN | any | any | any | **Admin panel** | Admins ignore their own `store` field for routing. |

**Note on `SUSPENDED` and `CLOSED` rows:** the schema supports these statuses, but **no backend endpoint currently transitions a store into either state**. They're reserved for a future moderation feature. The screens are still worth designing — they'll be reachable once admin moderation ships — but you cannot QA them end-to-end against the current backend.

**Combinations that should never occur** (treat them as bugs and log to your error tracker if you see them):
- `BUYER` with `store.status` ∈ {`APPROVED`, `PENDING_GO_LIVE`, `ACTIVE`} — the role upgrade at first approval should have already moved them to `MERCHANT`.
- `MERCHANT` with `store === null` — by schema design, deleting a store cascade-requires deleting the user, so a merchant without a store is unreachable. If seen, the data is corrupt.
- `MERCHANT` with `store.status` ∈ {`DRAFT`, `PENDING_REVIEW`} — the role upgrade is one-way and only fires when the store first reaches `APPROVED`. There's no path back to these statuses for an upgraded user.

If you encounter one, fall back to a "Something looks off — refreshing your session" UI that triggers a logout-and-relogin cycle.

### 3.2 First-time-user onboarding

A freshly verified `BUYER` with `store === null` lands on the merchant web app for the first time. They have two distinct intents:

1. **They want to sell** — go through store creation.
2. **They're here by mistake** — they thought this was the buyer app, or they were testing.

**Screen design:**

- Hero with YIIVA branding
- Headline: **"Welcome, {firstName}. Ready to start selling on YIIVA?"**
- Body: *"YIIVA is the home for South African creative brands. Set up your store, list your products, and start reaching buyers across the country."*
- Primary CTA: **"Start my store"** → opens the store creation form (`POST /stores`, scoped in the store contract)
- Secondary, smaller CTA: **"I'm just looking around"** → reveals a small explainer: *"This is the merchant dashboard for sellers. To shop on YIIVA, download our consumer app from the App Store / Play Store."* with sign-out option.

**After they click "Start my store":**
- Show the store creation form (companyName, displayName, optional description/story/contact)
- On `201` from `POST /stores`, transition the user to the **store setup wizard** (the `DRAFT` row of [§3.1](#31-the-matrix))

This is the single moment where the merchant web app justifies its existence to a new BUYER. Make it warm and inviting; this is the brand promise from `about_yiiva.md` materialising for the user.

---

## 4. Edge-case UX

### 4.1 Account suspended/deactivated mid-session

**Scenario:** the user is logged in and active. An admin suspends or deactivates them. On their next API call, the JWT is still cryptographically valid, but `JwtStrategy` checks `accountStatus === ACTIVE` and throws `401 "Account is inactive or does not exist"` (see [contract](./auth-module-api.md#error-response-shape)).

**UX:**

- The 401 interceptor (described in [auth-guide.md §3](../auth-guide.md#3-making-authenticated-requests)) sees the message *"Account is inactive or does not exist"* — this is **not** the same as *"Access token has expired"*, so do **not** attempt a silent refresh. Refresh would just fail too.
- Immediately:
  - Clear access token from memory
  - Clear refresh-token cookie
  - Replace the current page with a full-screen takeover:

```
Headline: Your account is no longer active
Body:    Please contact support@yiiva.co.za if you think this is a mistake.
Action:  [ Contact support ]   [ Back to sign in ]
```

- The "Back to sign in" button takes them to `/login` with no banner (their next sign-in attempt will surface the suspended/deactivated error from `POST /auth/login`).

> **Implementation note:** there's no easy way to know whether the cause is `SUSPENDED` vs `DEACTIVATED` vs the user being deleted — the backend coalesces them into one message. Don't try to distinguish; the generic copy above covers all three.

### 4.2 Multi-tab coordination

**Scenario:** user opens YIIVA in two tabs (A and B). They share the same httpOnly refresh-token cookie (cookies are scoped per domain, not per tab). The single-use rotation creates a race condition when both tabs need to refresh near-simultaneously:

1. Tab A's access token expires → it calls `/auth/refresh` with the current cookie value.
2. Backend revokes the old refresh token, issues a new one, returns it.
3. The Next.js API route sets the new cookie — both tabs now see it.
4. **But before step 3 completed**, Tab B's access token also expired and Tab B called `/auth/refresh` with the *same* original cookie value (the one Tab A had at step 1).
5. Backend sees that token has been revoked → returns `401 "Invalid or expired refresh token"`.

The race is **concurrent refreshes starting from the same cookie value**, not stale cookies sitting around. After Tab A's rotation lands, any *subsequent* refresh from Tab B (using the now-current cookie) would actually succeed — but the failed call has already triggered the 401-handler.

**UX options (pick one and apply consistently):**

**Option A — Lazy detection (recommended for v1).** Don't actively coordinate. Tab B's silent refresh fails on its next call → standard "session expired" handling kicks in: clear local state, redirect to `/login` with a banner:

```
Headline: Your session has expired
Body:    You may have signed out or refreshed in another window. Please sign in again.
```

**Option B — Active coordination.** Use a `BroadcastChannel('yiiva-auth')` channel. When a tab successfully rotates, broadcast `{ type: 'tokens-refreshed', accessToken }`. Other tabs listen and adopt the new in-memory access token. They keep the cookie value the active tab now holds, since cookies are shared anyway.

This is more invisible to the user but more code. **Stick with Option A for v1** unless you see signal that users open many tabs.

### 4.3 Network failure during silent refresh

**Scenario:** silent refresh request fails due to network (timeout, offline, DNS hiccup). Cannot distinguish from "actually expired."

**UX:**

- **Retry once** after a brief delay (1.5–2 seconds). Many transient failures recover quickly.
- If the second attempt also fails:
  - If the response was `401`/`403` → real auth failure → clear state + redirect to `/login`
  - If the response was a network error / timeout / 5xx → show a non-blocking toast: *"Connection issue. Trying again…"* and retry once more after 5 seconds. After three total failures, redirect to `/login`.
- **Never indefinitely loop**. Three attempts is the max.

The original request that triggered the refresh should not be retried until the refresh succeeds. If the refresh ultimately fails, drop the original request.

### 4.4 Reset-password's revoke-all-sessions side effect

**Scenario:** the user has YIIVA open on Device A (laptop) and Device B (phone). On Device A, they go through the forgot-password → reset-password flow. After successful reset:

- All refresh tokens for the user are revoked (`auth.service.ts:390`)
- Device A is **not automatically signed in** — the reset endpoint sends the user to `/login` with their new password instead of issuing a fresh session.
- Device B's access token still works until expiry (~15 min). After that, the silent refresh fails because the refresh token was revoked.

**UX:**

**On Device A (where the reset happened):**
- After redirecting to `/login` with the success banner, also include the consequence:

```
Banner: Password updated. Sign in with your new password.
        Other devices have been signed out automatically.
```

**On Device B (the other device):**
- The first failed silent refresh kicks them to `/login`
- Show a banner with explanatory copy:

```
Banner: Your password was changed.
        Please sign in with your new password.
```

This means the silent-refresh-failure handler needs to differentiate "session expired naturally" from "session revoked by password change" if you want to show distinct copy. Since both produce the same 401 from the backend, they cannot be distinguished — use the **single banner**: *"Your session has expired. Please sign in again."* and let the user's awareness fill in the rest.

---

## 5. UX patterns & copy guidance

### Error placement

| Severity | Placement | Examples |
|---|---|---|
| Field-level (validation) | Inline below the field, red text, clears on edit | "Email is required" / "Password is too short" |
| Form-level (auth/permission) | Banner at the top of the form, **persistent** until the user re-submits or edits the form. Manually dismissible via a close button — **never auto-dismiss on a timer** (the user might miss it). | "Incorrect email or password" / "Email already registered" |
| Page-replacing | Full-screen takeover of the auth screen | "This verification link has expired" / "Your account is no longer active" |
| Global / network | Toast in the top-right corner, auto-dismissing after 5s | "Connection issue. Retrying…" |
| Rate limit | Banner above the form + disabled submit for 60s | "Too many attempts. Please wait a minute." |

### Loading states

| Where | Pattern |
|---|---|
| Form submission | Submit button shows a spinner + active-tense label ("Signing in…", "Creating your account…", "Sending…"). Disable other inputs in the form. |
| Silent refresh on app init | Render a full-page splash with the YIIVA logo and a subtle progress indicator. **Do not render protected content yet.** Resolve the `/auth/refresh` + `/auth/me` chain before transitioning. |
| Silent refresh during a session | Invisible to the user — the original request resumes seamlessly after refresh. |
| Page-load API calls (dashboard, store detail) | Skeleton screens for the affected section. Don't blank the page. |
| Optimistic actions (logout) | Update local state and navigate immediately. Don't wait on the network. |

### Tone

- **Warm, not corporate.** YIIVA serves creative founders — the voice should feel like a colleague, not a bank.
- **Use first-person plural for the platform** ("We've sent…") and second-person for the user ("Your password…").
- **Don't blame the user.** "Incorrect email or password" not "Wrong credentials."
- **Match the backend's error semantics, soften the wording.** Backend says *"Email already registered"*; UI shows *"That email is already in use. Sign in instead?"* The meaning is the same; the tone is friendlier.
- **For account-status messages (suspended, deactivated)**, lean factual and low-blame. Always include a way to contact support.

### Copy principles

- **One action per screen.** When you have a primary CTA, make it visually dominant; secondary actions should be smaller text links.
- **Lead with what the user gets, not what they have to do.** "Start your brand on YIIVA" beats "Fill in this form."
- **Confirm don't accuse.** After an action: *"Password updated."* not *"Operation successful."*

### Form validation timing

- **On blur** for format checks (email, URL) — let the user finish typing before scolding them.
- **Live** for password strength indicators — they are *helpful*, not nagging.
- **On submit** for required-field checks and form-level validation.
- **Match check** (confirm password) — debounced live, or on submit. Don't validate on every keystroke.

### Session-restoration UX

The single most-important page in the app for first-load UX is whatever route the user first hits *while authenticated*. The integration guide describes the silent refresh on init; the UX consequence is that **for the first ~200–800ms of every page load, the user has no role information available**. Render a splash, not the wrong screen.

---

## 6. Testing checklist

Manual UX checks for each flow. Run these on a real device whenever auth code changes.

### Registration
- [ ] Valid input → 201 → "Check your email" screen with the correct email displayed
- [ ] Invalid email format → on-blur inline error
- [ ] Password missing rule → live indicator updates as you type, submit disabled until all rules met
- [ ] Email already registered → 409 → friendly inline error with sign-in link
- [ ] Hit submit button 4 times rapidly → 429 → rate-limit banner, submit disabled for 60s
- [ ] Optional phone field can be left blank without errors

### Email verification
- [ ] Click valid token in email → in-flight spinner → brief success → redirect to onboarding
- [ ] Click already-used token → error screen with "Create a new account" recovery
- [ ] Click expired (>24h old) token → same error screen
- [ ] Click malformed URL (no token) → error screen, no crash
- [ ] Open verify URL while already logged in → error screen with "Go to dashboard" recovery

### Login
- [ ] Correct credentials → loading splash → routed correctly per matrix
- [ ] Wrong password → "Incorrect email or password" banner
- [ ] Non-existent email → same banner (verify wording matches)
- [ ] Unverified account → "Verify your email first" replaces form
- [ ] Suspended account → "Account suspended" replaces form, includes support email
- [ ] Deactivated account → "Account deactivated" replaces form
- [ ] Hit submit 6 times rapidly → 429 → banner + 60s lockout
- [ ] Login with `?returnUrl=/dashboard/products` → after auth, lands on `/dashboard/products`

### Forgot password
- [ ] Existing email → success confirmation (don't peek at the network response — verify visually)
- [ ] Unknown email → **same** success confirmation
- [ ] Invalid email format → on-blur inline error
- [ ] Submit 4 times → 429 banner

### Reset password
- [ ] Valid token + valid password → redirect to `/login` with success banner
- [ ] Valid token + weak password → inline field error, form stays
- [ ] Valid token + mismatched confirm → inline error, no submit
- [ ] Expired token → "reset link no longer valid" page with "Request a new link" CTA
- [ ] Valid token + 6 rapid submits → 429 banner

### Logout
- [ ] "Sign out" → instantly back on `/login`, no flicker
- [ ] "Sign out everywhere" with confirmation → instantly back on `/login`
- [ ] After logout, navigating to a protected URL → redirected to `/login`
- [ ] After logout, refreshing the page → still on `/login`
- [ ] After "Sign out everywhere" on Device A, Device B's next call → silent refresh fails → Device B redirects to `/login` with banner

### Token refresh
- [ ] Wait 16 minutes idle, click any protected action → silent refresh succeeds, action completes
- [ ] Manually expire access token in dev tools, click any action → silent refresh succeeds
- [ ] Manually expire refresh cookie → next protected action → kicked to `/login` cleanly
- [ ] Two tabs open, refresh in tab A → tab B's next refresh fails → tab B redirects to `/login`

### Mid-session account status changes
- [ ] Active session, admin suspends user → next API call → "Account is no longer active" takeover
- [ ] Active session, admin deactivates user → same takeover
- [ ] Active session, user resets password elsewhere → other tab's next refresh fails → redirected to `/login` with banner

### Invite flow
- [ ] Click valid invite link while logged out → store branding shown + sign-in/sign-up CTAs
- [ ] Sign in via the invite landing → return to `/invites/accept?token=...` → "Accept invitation" CTA → success → store dashboard
- [ ] Click expired invite (>7 days) → invalid-invite screen
- [ ] Click invite while logged in as a different email → wrong-email banner + "Sign out and switch" recovery
- [ ] Submit accept with optional employee number → success
- [ ] Submit accept with empty employee number → success

### Routing matrix
- [ ] Verify each matrix row visually using a seeded user in each state — at minimum: BUYER no-store, BUYER DRAFT-rejected, BUYER PENDING_REVIEW, MERCHANT APPROVED, MERCHANT APPROVED-rejected, MERCHANT PENDING_GO_LIVE, MERCHANT ACTIVE, MERCHANT SUSPENDED, ADMIN
- [ ] Confirm that rejection banners on DRAFT auto-clear after editing the store
- [ ] Confirm that go-live rejection banners on APPROVED **persist** until `request-go-live` is called again

### Copy & accessibility
- [ ] Every interactive element has a visible focus state (keyboard navigation works)
- [ ] All form labels are associated with their inputs (screen readers)
- [ ] Submit buttons have descriptive text in their disabled / loading states
- [ ] Error banners are announced by screen readers (`role="alert"`)
- [ ] Color contrast on error text ≥ 4.5:1
