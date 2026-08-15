# YIIVA Auth Module — API Contract

> **Audience:** Frontend developers integrating the merchant dashboard, admin panel, **and the buyer mobile app**. Endpoint shapes are identical across clients; UX flows differ per client (see [`auth-frontend-flows.md`](./auth-frontend-flows.md) for the web flows and [`../Api-mobileapp-contracts/auth-flows.md`](../Api-mobileapp-contracts/auth-flows.md) for the mobile flows).
> **Scope:** All authentication endpoints. Admin accounts are seeded directly into the database — the admin frontend only needs login, refresh, logout, and `GET /auth/me`. No self-registration flow exists for admins.

---

## Endpoint Summary

| Method | Path | Auth required | Rate limit |
|---|---|---|---|
| `POST` | `/auth/register` | No | 3 / minute |
| `POST` | `/auth/verify-email` | No | 5 / minute |
| `POST` | `/auth/resend-verification` | No | 3 / minute |
| `POST` | `/auth/login` | No | 5 / minute |
| `POST` | `/auth/refresh` | No | 10 / minute |
| `POST` | `/auth/logout` | Yes | 5 / minute |
| `POST` | `/auth/logout-all` | Yes | 5 / minute |
| `POST` | `/auth/forgot-password` | No | 3 / minute |
| `POST` | `/auth/reset-password` | No | 5 / minute |
| `POST` | `/auth/claim` | No | 100 / minute (global) |
| `GET` | `/auth/me` | Yes | 100 / minute (global) |

---

## Error Response Shape

All errors follow this structure:

```json
{
  "statusCode": 401,
  "message": "string or array of strings",
  "error": "string"
}
```

`message` is an **array of strings** only on `400` DTO validation errors. All other errors return a single string.

---

## Token Architecture

The backend issues two tokens on login and verify-email:

| Token | Lifetime | Transport |
|---|---|---|
| `accessToken` | 15 minutes | `Authorization: Bearer <token>` header on every protected request |
| `refreshToken` | 7 days, **single-use** | Must never be accessible to browser JavaScript — store in an `httpOnly` cookie managed server-side (Next.js API route) |

**Single-use rotation:** Every call to `POST /auth/refresh` immediately invalidates the old refresh token and issues a new one. The new token must replace the cookie before the next refresh is needed. Replaying an already-used token returns `401`.

**Required header on every protected request:**
```
Authorization: Bearer <accessToken>
```

---

## Shared Response Shapes

### Auth Response (login, verify-email, refresh)

```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "user": {
    "id": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "role": "BUYER | MERCHANT | ADMIN",
    "avatarUrl": "string | null"
  }
}
```

### Full User Profile (GET /auth/me only)

```json
{
  "id": "string",
  "email": "string",
  "firstName": "string",
  "lastName": "string",
  "role": "BUYER | MERCHANT | ADMIN",
  "avatarUrl": "string | null",
  "phone": "string | null",
  "emailVerified": "boolean",
  "phoneVerified": "boolean",
  "accountStatus": "ACTIVE | SUSPENDED | DEACTIVATED | PENDING_VERIFICATION",
  "createdAt": "ISO 8601 string",
  "store": {
    "id": "string",
    "displayName": "string",
    "slug": "string",
    "status": "DRAFT | PENDING_REVIEW | APPROVED | PENDING_GO_LIVE | ACTIVE | SUSPENDED | CLOSED",
    "logoUrl": "string | null",
    "rejectionReason": "string | null"
  }
}
```

The `store` field is `null` if the user has no store. The `rejectionReason` field is non-null when the store has been rejected by an admin — the merchant dashboard should display this prominently.

---

## Endpoints

---

### `POST /auth/register`

**Public.** Creates a new account in `PENDING_VERIFICATION` status. Emails a **6-digit verification code** (expires in 10 minutes). The user cannot log in until the email is verified.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | valid email — normalised to lowercase |
| `password` | string | yes | min 8 chars, must contain uppercase, lowercase, and a digit |
| `firstName` | string | yes | non-empty |
| `lastName` | string | yes | non-empty |
| `phone` | string | no | — |

**Success — `201`**
```json
{
  "message": "Account created. Enter the 6-digit code we emailed you to verify your account."
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `409` | `"Email already registered"` | Email is already in use |
| `400` | array of validation strings | Invalid input (bad email format, weak password, missing required fields) |
| `429` | rate limit | More than 3 requests/minute |

---

### `POST /auth/verify-email`

**Public.** Activates the account and automatically logs the user in. The user types the 6-digit code from the verification email — **no URL is emailed** (OTP flow since 2026-08-15).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | normalised to lowercase |
| `code` | string | yes | exactly 6 digits |

**Success — `200`**

Returns an Auth Response. Store the `accessToken` in memory and the `refreshToken` in an `httpOnly` cookie (server-side). Redirect based on `user.role`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired verification code"` | Wrong code, unknown email, already verified, expired (10 min), or attempt cap reached — **one message for all cases intentionally** |
| `429` | rate limit | More than 5 requests/minute |

**Attempt cap:** after 5 wrong guesses the code self-destructs; the user must request a new one via `resend-verification`.

---

### `POST /auth/resend-verification`

**Public.** Issues a fresh verification code for an unverified account (resets the attempt counter). Enumeration-safe: always returns the same generic message. Silent no-op within 60s of the previous send (cooldown).

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |

**Success — `200`**
```json
{
  "message": "If an account with that email exists and is unverified, a new code has been sent."
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `429` | rate limit | More than 3 requests/minute |

---

### `POST /auth/login`

**Public.** Authenticates a user. Only `ACTIVE` accounts can log in.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | normalised to lowercase |
| `password` | string | yes | — |

**Success — `200`**

Returns an Auth Response. Same handling as verify-email success.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Invalid credentials"` | Wrong email or wrong password — **same message for both intentionally** |
| `403` | `"Please verify your email before logging in"` | Account is `PENDING_VERIFICATION` |
| `403` | `"Your account has been suspended. Contact support."` | Account is `SUSPENDED` |
| `403` | `"This account has been deactivated."` | Account is `DEACTIVATED` |
| `429` | rate limit | More than 5 requests/minute |

**Important:** Never try to distinguish wrong email from wrong password — always display `"Invalid credentials"` as-is.

---

### `POST /auth/refresh`

**Public.** Issues a new access token and refresh token. The old refresh token is immediately invalidated (single-use). Must be called via a server-side layer so the refresh token can be read from the `httpOnly` cookie and forwarded in the request body.

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes — read from `httpOnly` cookie server-side |

**Success — `200`**

Returns an Auth Response. Update the `accessToken` in memory and replace the `httpOnly` cookie with the new `refreshToken`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Invalid or expired refresh token"` | Token not found, already used, or expired |
| `403` | `"Account is not active. Please log in again."` | Account was suspended or deactivated after the token was issued |
| `429` | rate limit | More than 10 requests/minute |

On **any** error from this endpoint: clear all auth state, delete the cookie, redirect to `/login`.

---

### `POST /auth/logout`

**Protected.** Revokes the current session's refresh token. The access token remains technically valid until its 15-minute expiry — clear it from memory immediately on the frontend regardless of the server response.

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes — read from `httpOnly` cookie server-side |

**Request header**
```
Authorization: Bearer <accessToken>
```

**Success — `200`**
```json
{ "message": "Logged out successfully" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Authentication required"` | No access token provided |
| `401` | `"Access token has expired"` | Attempt silent refresh first, then retry |
| `429` | rate limit | More than 5 requests/minute |

---

### `POST /auth/logout-all`

**Protected.** Revokes all refresh tokens for the user across every device. Use for "Sign out everywhere" functionality.

**No request body.**

**Request header**
```
Authorization: Bearer <accessToken>
```

**Success — `200`**
```json
{ "message": "Logged out of all devices" }
```

**Errors** — same as `POST /auth/logout`.

---

### `POST /auth/forgot-password`

**Public.** Emails a **6-digit reset code** (expires in 10 minutes). **Always returns the same success response** regardless of whether the email exists, is verified, or is suspended. Never reveal to the user whether the email is registered. Silent no-op within 60s of the previous send (cooldown).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | normalised to lowercase |

**Success — `200`** *(always, regardless of email existence)*
```json
{
  "message": "If an account with that email exists, we've sent a password reset code."
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | validation error | Invalid email format |
| `429` | rate limit | More than 3 requests/minute |

**Always** display the same success message to the user — never show different UI for found vs not found.

---

### `POST /auth/reset-password`

**Public.** Resets the password using the emailed 6-digit code — **no URL is emailed** (OTP flow since 2026-08-15). On success, **all sessions on all devices are revoked** — the user must log in again. The UI collects email → code + new password in one flow.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | normalised to lowercase |
| `code` | string | yes | exactly 6 digits |
| `password` | string | yes | min 8 chars, must contain uppercase, lowercase, and a digit |

**Success — `200`**
```json
{
  "message": "Password reset successful. Please log in with your new password."
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired reset code"` | Wrong code, unknown email, expired (10 min), or attempt cap reached — one message for all cases |
| `400` | array of validation strings | Weak password |
| `429` | rate limit | More than 5 requests/minute |

**Attempt cap:** after 5 wrong guesses the code self-destructs; the user requests a fresh one via `forgot-password` again (60s cooldown applies).

After success: clear all local auth state, delete the cookie, redirect to `/login`.

---

### `POST /auth/claim`

**Public — no authentication required.** Converts a guest user record (created during guest checkout with `isGuestAccount: true`) into a full account by setting a password against the same email. The request authenticates itself by demonstrating knowledge of the email tied to the guest record.

Primarily used by the **buyer mobile app** post-checkout (see [`../Api-mobileapp-contracts/auth-flows.md`](../Api-mobileapp-contracts/auth-flows.md) §4.8). The merchant web app has no guest-checkout flow and does not call this endpoint.

```
POST /auth/claim
```

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | Must match the email of a guest user record |
| `password` | string | yes | Min 8 characters. **Note:** unlike `/auth/register`, no uppercase / lowercase / digit rules are enforced server-side — keep frontend validation lighter to match. |

```json
{
  "email": "buyer@example.com",
  "password": "myNewPassword123"
}
```

**Success — `201 Created`**

```json
{
  "message": "Account claimed successfully. You can now log in with your email and password."
}
```

**Important:** the response carries **no tokens**. The user is NOT auto-logged-in — direct them to `/login` with the email prefilled. They sign in fresh with their new credentials.

> **Known v1 limitation — no email verification on claim.** The backend currently sets `emailVerified: true` automatically when an account is claimed (see `claim.service.ts:56` — `emailVerified: true, // stubbed — will require real verification later`). This will tighten once the Notifications module ships (OTP or magic link sent to the claim email). Today, the account is active immediately on a successful claim. Do not surface "check your inbox" copy.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"No account found with this email address."` | No `User` row matches the email (guest or otherwise). For the mobile flow, this should be unreachable because the email field is locked to the guest checkout's email — surface as a "create a new account" fallback if it does happen. |
| `409` | `"This email already belongs to a registered account. Please log in."` | A `User` with this email exists but is not a guest (`isGuestAccount: false`). The user has been claimed previously or registered through a different path. Direct them to `/login` with the email prefilled. |
| `400` | validation array | Invalid email format or password shorter than 8 characters |
| `429` | rate-limit error | Exceeded the global 100/min throttle (unlikely from a single user) |

---

### `GET /auth/me`

**Protected.** Returns the full profile for the currently authenticated user. Use this to hydrate auth state on app load after a silent refresh has restored the access token.

**No request body.**

**Request header**
```
Authorization: Bearer <accessToken>
```

**Success — `200`** — Returns the Full User Profile shape.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Authentication required"` | No access token provided |
| `401` | `"Access token has expired"` | Attempt silent refresh, then retry |
| `401` | `"Invalid access token"` | Token is malformed or tampered |

---

## Connection Logic

### Token storage

```
accessToken  →  JavaScript memory (React context / Zustand)
refreshToken →  httpOnly cookie set by a Next.js API route
```

The refresh token **must never reach browser JavaScript**. Route all login, refresh, and logout calls through a Next.js API route that reads/sets the cookie server-side and only forwards the `accessToken` to the browser.

### On app initialisation (every page load)

The access token is in memory and is lost on page refresh. On every app init:

```
App loads
  → call POST /auth/refresh (server-side reads the cookie)
      ├── 200 → store accessToken in memory, restore user state, render normally
      └── error → user is not logged in → show public content or redirect to /login
```

Show a loading state until this resolves. Do not render protected content before it completes.

### Silent refresh during a live session

When any protected API call returns `401 "Access token has expired"`:

```
Intercept the 401
  → call POST /auth/refresh once
      ├── 200 → update accessToken in memory, retry the original request with new token
      └── error → clear all auth state, delete cookie, redirect to /login
```

Only one retry per request. Never loop.

### Post-login role routing

After any successful login or email verification, redirect based on `user.role`:

| Role | Destination |
|---|---|
| `BUYER` | Customer app home |
| `MERCHANT` | Merchant dashboard |
| `ADMIN` | Admin panel |

### Logout is optimistic

Do not wait for a successful server response before clearing local state. The local cleanup must be instant; server-side revocation is a background security measure.

```
User triggers logout
  → immediately clear accessToken from memory
  → immediately delete the httpOnly cookie
  → redirect to /login
  → fire POST /auth/logout to the server (fire-and-forget)
```

### The four distinct `401` messages

Each requires different handling:

| Message | Source | Action |
|---|---|---|
| `"Authentication required"` | No token sent | Redirect to `/login` |
| `"Access token has expired"` | Token expired | Attempt silent refresh, retry original request |
| `"Invalid access token"` | Token malformed or tampered | Clear auth state, redirect to `/login` |
| `"Account is inactive or does not exist"` | Account suspended, deactivated, or deleted mid-session | Clear auth state, redirect to `/login` |

### The `store` field on `GET /auth/me`

For the merchant frontend, `store` is the single source of truth for onboarding state. Use `user.store?.status` to determine which screen to show:

| `store` value | Screen to show |
|---|---|
| `null` | Buyer — no store started |
| `{ status: "DRAFT" }` | Store application in progress |
| `{ status: "PENDING_REVIEW" }` | Submitted, awaiting admin decision |
| `{ status: "APPROVED" }` | Approved — merchant can add products, not yet live |
| `{ status: "PENDING_GO_LIVE" }` | Go-live request submitted |
| `{ status: "ACTIVE" }` | Store is live |
| `{ status: "SUSPENDED" }` | Store suspended by admin |
| `{ status: "CLOSED" }` | Store closed |

When `store.rejectionReason` is non-null, display it prominently so the merchant knows what to fix before resubmitting.

### Rate limiting behaviour

On `429 Too Many Requests`: show the user a brief message ("Too many attempts. Please wait a moment and try again."), disable the submit button temporarily. Do not auto-retry — let the user trigger the next attempt manually.
