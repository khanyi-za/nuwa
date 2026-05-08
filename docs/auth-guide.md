# YIIVA — Frontend Authentication Guide

This document is written for the frontend engineer implementing authentication in the Next.js application. It covers every auth endpoint, the full token flow, storage recommendations, and how to handle errors and edge cases.

---

## Table of Contents

1. [Token Storage Recommendation](#1-token-storage-recommendation)
2. [How the Token System Works](#2-how-the-token-system-works)
3. [Making Authenticated Requests](#3-making-authenticated-requests)
4. [API Contract](#4-api-contract)
   - [Register](#41-register)
   - [Verify Email](#42-verify-email)
   - [Login](#43-login)
   - [Refresh Tokens](#44-refresh-tokens)
   - [Logout](#45-logout)
   - [Logout All Devices](#46-logout-all-devices)
   - [Forgot Password](#47-forgot-password)
   - [Reset Password](#48-reset-password)
   - [Get Current User](#49-get-current-user)
5. [Auth Flows](#5-auth-flows)
   - [Registration Flow](#51-registration-flow)
   - [Email Verification Flow](#52-email-verification-flow)
   - [Login Flow](#53-login-flow)
   - [Token Refresh Flow](#54-token-refresh-flow)
   - [Logout Flow](#55-logout-flow)
   - [Forgot Password Flow](#56-forgot-password-flow)
   - [Reset Password Flow](#57-reset-password-flow)
6. [Error Handling Reference](#6-error-handling-reference)
7. [Rate Limits](#7-rate-limits)

---

## 1. Token Storage Recommendation

The backend issues two tokens on login:

| Token | Lifetime | Purpose |
|---|---|---|
| `accessToken` | 15 minutes | Sent with every API request |
| `refreshToken` | 7 days | Used to get a new access token when it expires |

### Recommended approach for Next.js

**Access token → memory only (React context or Zustand store)**

Store the access token in JavaScript memory — never in `localStorage` or `sessionStorage`. Memory storage cannot be read by injected scripts (XSS protection). Because the access token only lives 15 minutes, losing it on page refresh is acceptable — you silently recover it using the refresh token.

**Refresh token → httpOnly cookie set by a Next.js API route**

The refresh token must never be accessible to JavaScript. Route your login and refresh calls through a Next.js API route (`/api/auth/login`, `/api/auth/refresh`). That route calls the backend, receives the refresh token, and sets it as an `httpOnly`, `Secure`, `SameSite=Strict` cookie. The browser sends this cookie automatically on subsequent calls to your API routes. JavaScript in the browser never sees the raw refresh token value.

### Why not localStorage?

`localStorage` is readable by any JavaScript running on the page. If a third-party script or an XSS vulnerability is ever introduced, attackers can steal tokens from `localStorage`. With the approach above, the worst case for XSS is a stolen 15-minute access token — not a 7-day refresh token.

### Summary

```
accessToken  →  memory (React context / Zustand)
refreshToken →  httpOnly cookie (set via Next.js API route)
```

---

## 2. How the Token System Works

1. User logs in → backend returns `accessToken` (15min) and `refreshToken` (7 days)
2. Every API request includes the access token in the `Authorization` header
3. When the access token expires, the backend returns `401` with the message `"Access token has expired"`
4. Your app calls the refresh endpoint (the httpOnly cookie carries the refresh token automatically via your Next.js API route)
5. The backend revokes the old refresh token and returns a brand new `accessToken` and `refreshToken` (token rotation — each refresh token is single-use)
6. Store the new access token in memory, update the cookie with the new refresh token
7. Retry the original failed request with the new access token
8. If the refresh token is also expired or invalid → clear all auth state and redirect to login

**Important:** The refresh token is single-use. Once used, it is immediately revoked. The backend issues a new refresh token alongside the new access token on every refresh call.

---

## 3. Making Authenticated Requests

Every request to a protected endpoint must include the access token in the `Authorization` header:

```
Authorization: Bearer <accessToken>
```

If this header is missing or the token is invalid, the backend returns `401`.

### Silent token refresh

Implement an HTTP interceptor (or a wrapper around `fetch`/`axios`) that:

1. Catches any `401` response
2. Checks the error message — if it is `"Access token has expired"`, attempt a silent refresh
3. If the refresh succeeds, retry the original request with the new token
4. If the refresh fails (refresh token expired or revoked), clear auth state and redirect to `/login`

Only attempt one silent refresh per request — do not retry indefinitely.

---

## 4. API Contract

**Base URL:** `http://localhost:3000` (development) / your production domain

All request bodies are JSON. Set `Content-Type: application/json` on every request.

---

### 4.1 Register

Creates a new account. Sends a verification email to the provided address. The account is in `PENDING_VERIFICATION` status until the email is verified — the user cannot log in until then.

```
POST /auth/register
```

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | valid email format |
| `password` | string | yes | min 8 chars, must contain uppercase, lowercase, and a digit |
| `firstName` | string | yes | non-empty |
| `lastName` | string | yes | non-empty |
| `phone` | string | no | optional |

```json
{
  "email": "jane@example.com",
  "password": "SecurePass1",
  "firstName": "Jane",
  "lastName": "Doe"
}
```

**Success response — `201 Created`**

```json
{
  "message": "Account created. Please check your email to verify your account."
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `409 Conflict` | `"Email already registered"` | Email is taken |
| `400 Bad Request` | validation errors array | Invalid input (bad email, weak password, missing fields) |
| `429 Too Many Requests` | rate limit error | More than 3 requests/minute from this IP |

**Validation error response shape (`400`)**

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 8 characters"
  ],
  "error": "Bad Request"
}
```

---

### 4.2 Verify Email

Called when the user clicks the verification link in their email. The link format is:

```
https://yiiva.co.za/auth/verify-email?token=<rawToken>
```

Your page at `/auth/verify-email` should extract the `token` query parameter and call this endpoint.

```
POST /auth/verify-email
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `token` | string | yes |

```json
{
  "token": "a3f9c2e1b4d87634..."
}
```

**Success response — `200 OK`**

The account is activated and the user is automatically logged in. Store the `accessToken` in memory and the `refreshToken` in your httpOnly cookie.

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a3b9f2e1c4d87634...",
  "user": {
    "id": "clxyz123",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "BUYER",
    "avatarUrl": null
  }
}
```

**User object shape**

| Field | Type | Notes |
|---|---|---|
| `id` | string | CUID — use this to identify the user in your app state |
| `email` | string | |
| `firstName` | string | |
| `lastName` | string | |
| `role` | `"BUYER"` \| `"MERCHANT"` \| `"ADMIN"` | Determines which app experience to show |
| `avatarUrl` | string \| null | |

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `400 Bad Request` | `"Invalid or expired verification token"` | Token not found in DB or has expired (24h expiry) |
| `429 Too Many Requests` | rate limit error | More than 5 requests/minute |

---

### 4.3 Login

Authenticates a user. Only `ACTIVE` accounts can log in — see error table for other statuses.

```
POST /auth/login
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |
| `password` | string | yes |

```json
{
  "email": "jane@example.com",
  "password": "SecurePass1"
}
```

**Success response — `200 OK`**

Same shape as verify-email success. Store tokens and redirect user based on `role`.

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a3b9f2e1c4d87634...",
  "user": {
    "id": "clxyz123",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "BUYER",
    "avatarUrl": null
  }
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `401 Unauthorized` | `"Invalid credentials"` | Wrong email OR wrong password (intentionally the same message) |
| `403 Forbidden` | `"Please verify your email before logging in"` | Account is `PENDING_VERIFICATION` |
| `403 Forbidden` | `"Your account has been suspended. Contact support."` | Account is `SUSPENDED` |
| `403 Forbidden` | `"This account has been deactivated."` | Account is `DEACTIVATED` |
| `429 Too Many Requests` | rate limit error | More than 5 requests/minute |

**Important:** The backend intentionally returns the same `"Invalid credentials"` message for both wrong email and wrong password. Do not try to distinguish them — display that message as-is.

---

### 4.4 Refresh Tokens

Issues a new access token and refresh token. The old refresh token is revoked immediately (single-use).

Call this via a Next.js API route (`/api/auth/refresh`) so the httpOnly cookie can be read server-side and the new one can be set.

```
POST /auth/refresh
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes |

```json
{
  "refreshToken": "a3b9f2e1c4d87634..."
}
```

**Success response — `200 OK`**

Same shape as login. Update the access token in memory and set the new refresh token cookie.

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "d7e2f8a1b3c94512...",
  "user": {
    "id": "clxyz123",
    "email": "jane@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "BUYER",
    "avatarUrl": null
  }
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `401 Unauthorized` | `"Invalid or expired refresh token"` | Token not found, revoked, or expired |
| `403 Forbidden` | `"Account is not active. Please log in again."` | Account status changed to non-ACTIVE since token was issued |
| `429 Too Many Requests` | rate limit error | More than 10 requests/minute |

On any error from this endpoint → clear all auth state and redirect to `/login`.

---

### 4.5 Logout

Revokes the current device's refresh token. The access token remains technically valid until its 15-minute expiry, but it will be unusable on the next refresh cycle. Clear it from memory immediately on the frontend.

**Requires authentication.**

```
POST /auth/logout
Authorization: Bearer <accessToken>
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes |

```json
{
  "refreshToken": "a3b9f2e1c4d87634..."
}
```

**Success response — `200 OK`**

```json
{
  "message": "Logged out successfully"
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `401 Unauthorized` | `"Authentication required"` | Missing access token |
| `401 Unauthorized` | `"Access token has expired"` | Access token expired — attempt refresh first, then retry |
| `429 Too Many Requests` | rate limit error | More than 5 requests/minute |

After a successful logout response, clear the access token from memory and clear the refresh token cookie.

---

### 4.6 Logout All Devices

Revokes all refresh tokens for the user across every device and session. Use this for "Sign out everywhere" functionality.

**Requires authentication.**

```
POST /auth/logout-all
Authorization: Bearer <accessToken>
```

**Request body**

None required.

**Success response — `200 OK`**

```json
{
  "message": "Logged out of all devices"
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `401 Unauthorized` | `"Authentication required"` | Missing access token |
| `401 Unauthorized` | `"Access token has expired"` | Attempt refresh first, then retry |
| `429 Too Many Requests` | rate limit error | More than 5 requests/minute |

After success, clear local auth state the same way as regular logout.

---

### 4.7 Forgot Password

Triggers a password reset email. This endpoint **always returns the same success message** regardless of whether the email exists, whether the account is verified, or whether the account is suspended. This is intentional — the backend does not reveal whether an email is registered.

```
POST /auth/forgot-password
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |

```json
{
  "email": "jane@example.com"
}
```

**Success response — `200 OK`**

This is returned in all cases — even if the email doesn't exist.

```json
{
  "message": "If an account with that email exists, we've sent a password reset link."
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `400 Bad Request` | validation error | Invalid email format |
| `429 Too Many Requests` | rate limit error | More than 3 requests/minute |

**Important:** Always display the same success message to the user regardless of the response. Do not show different UI for "email found" vs "email not found".

---

### 4.8 Reset Password

Called when the user clicks the reset link in their email. The link format is:

```
https://yiiva.co.za/auth/reset-password?token=<rawToken>
```

Your page at `/auth/reset-password` should extract the `token` query parameter, show a new password form, and call this endpoint on submit.

After a successful reset, **all sessions on all devices are revoked**. The user must log in again.

```
POST /auth/reset-password
```

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | from query param |
| `password` | string | yes | min 8 chars, uppercase, lowercase, digit |

```json
{
  "token": "b4c2d8e1a7f93201...",
  "password": "NewSecurePass1"
}
```

**Success response — `200 OK`**

```json
{
  "message": "Password reset successful. Please log in with your new password."
}
```

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `400 Bad Request` | `"Invalid or expired reset token"` | Token not found in DB or has expired (1 hour expiry) |
| `400 Bad Request` | validation errors array | Weak password |
| `429 Too Many Requests` | rate limit error | More than 5 requests/minute |

After a successful reset, clear any existing auth state and redirect to `/login` with a success message.

---

### 4.9 Get Current User

Returns the full profile for the currently authenticated user. Use this to hydrate your auth context on page load (after a silent token refresh).

**Requires authentication.**

```
GET /auth/me
Authorization: Bearer <accessToken>
```

**No request body.**

**Success response — `200 OK`**

This response includes more fields than the login/verify-email response, including the user's store if one exists.

```json
{
  "id": "clxyz123",
  "email": "jane@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "role": "BUYER",
  "avatarUrl": null,
  "phone": null,
  "emailVerified": true,
  "phoneVerified": false,
  "accountStatus": "ACTIVE",
  "createdAt": "2026-03-01T10:00:00.000Z",
  "store": null
}
```

The `store` field reflects the user's current position in the merchant onboarding lifecycle. The simplified examples below show only `id` and `status` for routing clarity — the full shape also includes `displayName`, `slug`, `logoUrl`, and `rejectionReason` (see the field table below):

```json
"store": null                                                // BUYER — no store application started
"store": { "id": "clxyz456", "status": "DRAFT" }             // started application, not submitted
"store": { "id": "clxyz456", "status": "PENDING_REVIEW" }    // submitted, awaiting first admin review
"store": { "id": "clxyz456", "status": "APPROVED" }          // approved — full merchant dashboard access, not yet live to buyers
"store": { "id": "clxyz456", "status": "PENDING_GO_LIVE" }   // go-live request submitted, awaiting second admin review
"store": { "id": "clxyz456", "status": "ACTIVE" }            // store is live and visible to buyers
"store": { "id": "clxyz456", "status": "SUSPENDED" }         // store suspended by admin
"store": { "id": "clxyz456", "status": "CLOSED" }            // store closed
```

Use `user.store?.status` together with `user.role` and `user.store?.rejectionReason` to determine which screen to show on any session, any device.

**Full user profile shape**

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `email` | string | |
| `firstName` | string | |
| `lastName` | string | |
| `role` | `"BUYER"` \| `"MERCHANT"` \| `"ADMIN"` | |
| `avatarUrl` | string \| null | |
| `phone` | string \| null | |
| `emailVerified` | boolean | |
| `phoneVerified` | boolean | |
| `accountStatus` | `"ACTIVE"` \| `"SUSPENDED"` \| `"DEACTIVATED"` \| `"PENDING_VERIFICATION"` | |
| `createdAt` | ISO 8601 datetime string | |
| `store` | `{ id, displayName, slug, status, logoUrl, rejectionReason } \| null` | `null` if no store application exists. `rejectionReason` is non-null when an admin has rejected an initial review or go-live request — display it prominently so the merchant knows what to fix. See `auth-module-api.md` for exact field types. |

**Error responses**

| Status | Message | Cause |
|---|---|---|
| `401 Unauthorized` | `"Authentication required"` | Missing access token |
| `401 Unauthorized` | `"Access token has expired"` | Attempt silent refresh, then retry |
| `401 Unauthorized` | `"Account is inactive or does not exist"` | Account was suspended after token was issued |

This endpoint uses the global rate limit (100 req/60s) — no stricter per-route limit.

---

## 5. Auth Flows

---

### 5.1 Registration Flow

```
User fills form → POST /auth/register
       │
       ├─ 409 → "Email already registered" → show inline error
       ├─ 400 → show field-level validation errors
       └─ 201 → show "Check your email" screen
                     │
                     └─ User does not receive email?
                           → provide a "Resend verification" option
                             (call POST /auth/forgot-password is NOT the right flow here —
                              implement a separate resend endpoint if needed in future,
                              or ask user to register again with same email if expired)
```

**What to show:**
- On `201`: Show a confirmation screen: *"We've sent a verification link to jane@example.com. Click the link in the email to activate your account."*
- Verification tokens expire after **24 hours**. Make this clear to the user.

---

### 5.2 Email Verification Flow

```
User clicks link in email → your /auth/verify-email?token=xxx page loads
       │
       └─ Page mounts → extract token from query param → POST /auth/verify-email
              │
              ├─ 400 "Invalid or expired verification token"
              │      → show error: "This link is invalid or has expired."
              │        Offer option to request a new one.
              │
              └─ 200 → store accessToken in memory
                        set refreshToken httpOnly cookie
                        redirect to dashboard / home based on role
```

**What to show:**
- While the request is in-flight: show a loading state ("Verifying your email...")
- On success: brief success message before redirect
- On error: clear message with a way to get a new link

---

### 5.3 Login Flow

```
User fills login form → POST /auth/login
       │
       ├─ 401 "Invalid credentials"
       │      → show: "Incorrect email or password"
       │
       ├─ 403 "Please verify your email before logging in"
       │      → show: "Please check your email and verify your account before logging in."
       │
       ├─ 403 "Your account has been suspended..."
       │      → show the message returned by the backend
       │
       ├─ 403 "This account has been deactivated."
       │      → show the message returned by the backend
       │
       └─ 200 → store accessToken in memory
                 set refreshToken httpOnly cookie
                 redirect based on user.role:
                   BUYER    → customer app home
                   MERCHANT → merchant dashboard
                   ADMIN    → admin panel
```

---

### 5.4 Token Refresh Flow

This should happen silently, without the user knowing. Implement this as an interceptor.

```
Any API call returns 401 "Access token has expired"
       │
       └─ Call POST /auth/refresh (via Next.js API route, with httpOnly cookie)
              │
              ├─ Error (401 or 403)
              │      → refresh token is invalid, expired, or account suspended
              │        clear all auth state
              │        redirect to /login
              │        optionally: show "Your session has expired. Please log in again."
              │
              └─ 200 → update accessToken in memory
                        update refreshToken cookie
                        retry original request with new accessToken
```

**On app load / page refresh:**
- The access token in memory is gone (page refresh clears JS memory)
- Immediately call `POST /auth/refresh` silently on app init
- If it succeeds → restore auth state, proceed normally
- If it fails → user is not logged in, redirect to login if the page requires auth

---

### 5.5 Logout Flow

```
User clicks "Logout" → POST /auth/logout (with accessToken + refreshToken)
       │
       └─ Any response (200 or error) →
              clear accessToken from memory
              clear refreshToken cookie
              redirect to /login
```

Do not wait for a successful response before clearing local state. Logout should feel instant to the user. The server-side revocation is a security measure — the local cleanup always happens.

---

### 5.6 Forgot Password Flow

```
User enters email → POST /auth/forgot-password
       │
       ├─ 400 → invalid email format → show validation error
       │
       └─ 200 (always, regardless of whether email exists)
              → show: "If an account with that email exists,
                       a password reset link has been sent.
                       Check your inbox."
```

**Never** show different messages for "email found" vs "email not found". Always display the same success message. The reset link expires after **1 hour**.

---

### 5.7 Reset Password Flow

```
User clicks link in email → your /auth/reset-password?token=xxx page loads
       │
       └─ Show new password form
              │
              └─ User submits → POST /auth/reset-password
                     │
                     ├─ 400 "Invalid or expired reset token"
                     │      → show: "This reset link is invalid or has expired.
                     │               Request a new one."
                     │        Provide link back to forgot-password page
                     │
                     ├─ 400 (validation) → weak password → show field error
                     │
                     └─ 200 → clear all local auth state
                               redirect to /login
                               show success: "Password updated. Please log in with your new password."
```

After a successful reset, **all sessions are revoked** by the backend. Any existing logged-in sessions on other devices will be logged out automatically on their next token refresh.

---

## 6. Error Handling Reference

### Standard error response shape

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

For validation errors (`400`), `message` is an array of strings:

```json
{
  "statusCode": 400,
  "message": [
    "password must be longer than or equal to 8 characters",
    "password must contain at least one uppercase letter, one lowercase letter, and one number"
  ],
  "error": "Bad Request"
}
```

### Status code summary

| Status | Meaning | What to do |
|---|---|---|
| `200` | Success | Handle response |
| `201` | Created | Handle response |
| `400` | Validation error or bad token | Show field errors or token error message |
| `401` | Unauthenticated | Check message — expired token triggers silent refresh, otherwise redirect to login |
| `403` | Forbidden | Show the message from the backend (account status issue) |
| `409` | Conflict | Email already registered — show inline error |
| `429` | Rate limited | Show: "Too many attempts. Please wait a moment and try again." |
| `500` | Server error | Show generic: "Something went wrong. Please try again." |

### The three distinct 401 messages

These come from different layers and should be handled differently:

| Message | Source | Action |
|---|---|---|
| `"Authentication required"` | No token sent | Redirect to login |
| `"Access token has expired"` | Token expired | Attempt silent refresh |
| `"Invalid access token"` | Token malformed or tampered | Clear auth state, redirect to login |
| `"Account is inactive or does not exist"` | Account suspended mid-session | Clear auth state, redirect to login, show message |

---

## 7. Rate Limits

Requests exceeding the limit return `429 Too Many Requests`.

| Endpoint | Limit |
|---|---|
| `POST /auth/register` | 3 requests / minute |
| `POST /auth/forgot-password` | 3 requests / minute |
| `POST /auth/verify-email` | 5 requests / minute |
| `POST /auth/login` | 5 requests / minute |
| `POST /auth/logout` | 5 requests / minute |
| `POST /auth/logout-all` | 5 requests / minute |
| `POST /auth/reset-password` | 5 requests / minute |
| `POST /auth/refresh` | 10 requests / minute |
| `GET /auth/me` | 100 requests / minute (global default) |

When you receive a `429`, show the user a brief message and disable the submit button temporarily. Do not automatically retry — let the user trigger the next attempt.

---

## Appendix — User Roles

The `role` field on the user object determines which interface the user should see after login.

| Role | Description | Redirect after login |
|---|---|---|
| `BUYER` | Customer — browses and purchases | Customer app home |
| `MERCHANT` | Brand owner — manages store, products, orders | Merchant dashboard |
| `ADMIN` | YIIVA staff — platform moderation and management | Admin panel |

A user's role is encoded in the JWT access token and enforced on the backend. Do not use the role on the frontend for anything security-critical — only use it to determine which UI to show.
