# YIIVA — Mobile Authentication Guide (Expo / React Native)

This document is written for the frontend engineer implementing authentication in the **YIIVA buyer mobile app** (Expo / React Native). It covers every auth endpoint, the full token lifecycle, storage on-device, the custom HTTP wrapper, deep-link wiring for verification + password-reset, and how to handle every error path.

It is the **mobile companion to `auth-flows.md`** in this same folder. That doc owns the screen-level UX (copy, validation timing, error toasts). This doc owns the wiring — how to actually store tokens, refresh them, attach them to requests, and route deep-link payloads through `expo-router`.

Stack assumptions:
- **Expo** SDK (recent) with the bundled `expo-router`
- **`expo-secure-store`** for refresh-token persistence (no `AsyncStorage` for that)
- **`expo-linking`** for deep-link / universal-link handling
- Custom `fetch`-based HTTP wrapper (not Axios)
- **Zustand** as the auth state store
- React Native `AppState` for lifecycle handling

---

## Table of Contents

1. [Token Storage Recommendation](#1-token-storage-recommendation)
2. [How the Token System Works](#2-how-the-token-system-works)
3. [Making Authenticated Requests](#3-making-authenticated-requests)
4. [API Contract](#4-api-contract)
   - [4.1 Register](#41-register)
   - [4.2 Verify Email](#42-verify-email)
   - [4.3 Login](#43-login)
   - [4.4 Refresh Tokens](#44-refresh-tokens)
   - [4.5 Logout](#45-logout)
   - [4.6 Logout All Devices](#46-logout-all-devices)
   - [4.7 Forgot Password](#47-forgot-password)
   - [4.8 Reset Password](#48-reset-password)
   - [4.9 Get Current User](#49-get-current-user)
   - [4.10 Claim Guest Account](#410-claim-guest-account)
5. [Auth Flows (implementation steps)](#5-auth-flows-implementation-steps)
6. [Error Handling Reference](#6-error-handling-reference)
7. [Rate Limits](#7-rate-limits)
8. [Mobile-Specific Setup](#8-mobile-specific-setup)
9. [App Lifecycle and Tokens](#9-app-lifecycle-and-tokens)
10. [Appendix — User Roles](#appendix--user-roles)

---

## 1. Token Storage Recommendation

The backend issues two tokens on login (and on verify-email, refresh, and claim — anywhere it returns `{ accessToken, refreshToken, user }`):

| Token | Lifetime | Purpose |
|---|---|---|
| `accessToken` | 15 minutes | Sent in `Authorization: Bearer <token>` on every protected request |
| `refreshToken` | 7 days | Used once to rotate into a new access + refresh pair |

### Storage rules

**Access token → memory (Zustand store), never persisted to disk.**
Losing it on app cold-start is fine — the persisted refresh token bootstraps a new one inside the cold-start hydration step before any protected screen renders.

**Refresh token → `expo-secure-store`, key `yiiva.refreshToken`.**
This is the only persisted credential. `expo-secure-store` writes to:
- iOS: Keychain (hardware-backed enclave on supported devices)
- Android: EncryptedSharedPreferences (system-level encryption)

```ts
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'yiiva.refreshToken';

export async function saveRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_KEY, token, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function loadRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearRefreshToken(): Promise<void> {
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
```

**Why `AFTER_FIRST_UNLOCK`:** lets the app read the token after the first device unlock following a reboot. Required so background fetches and notifications can authenticate without the user being prompted.

### Why NOT `AsyncStorage` for the refresh token

`AsyncStorage` is plaintext on disk (filesystem-readable on a jailbroken iOS device or a rooted Android device). The refresh token, in attacker hands, gets them 7 days of authenticated access to the account. The cost difference between `AsyncStorage` and `expo-secure-store` is one import. Use the encrypted store.

### What's safe in `AsyncStorage`

Non-sensitive cache, e.g.:
- The last-known `User` object (for splash-screen UX before refresh resolves)
- Browse history
- Recently-viewed products
- Local cart drafts for unauthenticated users

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

await AsyncStorage.setItem('yiiva.cachedUser', JSON.stringify(user));
```

### The auth Zustand store

A single source of truth for in-memory auth state:

```ts
import { create } from 'zustand';

type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'BUYER' | 'MERCHANT' | 'ADMIN';
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'PENDING_VERIFICATION';
  emailVerified: boolean;
  isGuestAccount: boolean;
};

type AuthState =
  | { status: 'loading' }                    // cold-start, before refresh resolves
  | { status: 'authenticated'; user: User; accessToken: string }
  | { status: 'guest' };                     // signed out or never signed in

type AuthStore = {
  state: AuthState;
  setAuthenticated: (user: User, accessToken: string) => void;
  setGuest: () => void;
  setLoading: () => void;
  updateAccessToken: (token: string) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  state: { status: 'loading' },
  setAuthenticated: (user, accessToken) =>
    set({ state: { status: 'authenticated', user, accessToken } }),
  setGuest: () => set({ state: { status: 'guest' } }),
  setLoading: () => set({ state: { status: 'loading' } }),
  updateAccessToken: (token) =>
    set((s) =>
      s.state.status === 'authenticated'
        ? { state: { ...s.state, accessToken: token } }
        : s,
    ),
}));
```

The Zustand store holds the access token (memory only). The refresh token is **only** in SecureStore — it never enters the JS store. This keeps the refresh token out of memory dumps and JS-side leaks.

---

## 2. How the Token System Works

### Issuance

The backend issues a new pair on:
- `POST /auth/register` (no — returns confirmation only; you call `verify-email` next)
- `POST /auth/verify-email` (✓ yes — auto-login after email verification)
- `POST /auth/login` (✓ yes)
- `POST /auth/refresh` (✓ yes — single-use rotation, see below)
- `POST /auth/claim` (no — returns confirmation only; user signs in afterwards)

When you get `{ accessToken, refreshToken, user }`:
1. Save the refresh token to SecureStore.
2. Put the access token + user in the Zustand store.
3. Transition the app to `authenticated`.

### Rotation (single-use refresh tokens)

Every successful `POST /auth/refresh`:
1. Marks the **old** refresh token as revoked server-side.
2. Issues a **brand new** refresh token (different value, fresh 7d window).
3. Returns the new pair.

**You must immediately overwrite SecureStore with the new refresh token.** If your refresh call succeeds but you don't persist the new token, the next refresh will fail (you'll send the now-revoked token). Treat the rotation as atomic in your code:

```ts
async function refreshTokens(currentRefresh: string): Promise<{ accessToken: string; refreshToken: string; user: User }> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: currentRefresh }),
  });
  if (!res.ok) throw new RefreshFailedError(await res.text());
  const data = await res.json();
  // Persist the new refresh token BEFORE returning, so callers
  // can't accidentally consume the data without the persist happening.
  await saveRefreshToken(data.refreshToken);
  return data;
}
```

### Revocation

The backend revokes refresh tokens on:
- Logout (just this device)
- Logout-all (every refresh token for the user)
- Password reset (every refresh token for the user — security best-practice)
- Account suspension by admin

A revoked refresh token returns `401 "Invalid or expired refresh token"`. Treat as a hard sign-out: clear SecureStore + Zustand, navigate to login.

### Expiry timeline

- **Access token** expires 15 minutes after issuance. Triggers silent refresh.
- **Refresh token** expires 7 days after issuance. Each successful refresh restarts the 7d window (because each refresh issues a new one). A user who opens the app at least once a week stays logged in indefinitely. A user who's away for >7 days will land back on `LoginScreen` on next launch.

---

## 3. Making Authenticated Requests

### The HTTP wrapper

A single module owns every backend call. It attaches `Authorization`, handles `401`/`403` distinctions, and performs silent refresh transparently.

```ts
// src/lib/api.ts
import { useAuthStore } from '../stores/auth';
import { loadRefreshToken, saveRefreshToken, clearRefreshToken } from './secure-storage';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL!;
//   e.g. 'https://api.yiiva.co.za' (production), 'http://localhost:3000' (local)

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class UnauthenticatedError extends Error {}

/**
 * Single-flight guard for refresh. If two requests both 401 simultaneously,
 * the second waits on the first's refresh instead of firing its own (which
 * would consume + revoke the same refresh token).
 */
let refreshInFlight: Promise<string> | null = null;

async function ensureFreshAccessToken(): Promise<string> {
  const stored = useAuthStore.getState().state;
  if (stored.status === 'authenticated' && !isJwtExpired(stored.accessToken)) {
    return stored.accessToken;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = await loadRefreshToken();
    if (!refresh) throw new UnauthenticatedError();
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) {
      await clearRefreshToken();
      useAuthStore.getState().setGuest();
      throw new UnauthenticatedError();
    }
    const data = await res.json();
    await saveRefreshToken(data.refreshToken);
    useAuthStore.getState().setAuthenticated(data.user, data.accessToken);
    return data.accessToken as string;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function isJwtExpired(token: string): boolean {
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(decodeBase64Url(payload));
    // exp is seconds since epoch. Consider it expired if it's within 30s of now —
    // gives us a small margin to refresh before the next request actually fails.
    return decoded.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

// JWTs use base64url (RFC 4648 §5): `-` and `_` instead of `+/`, and padding
// may be omitted. `atob` only accepts standard base64, so translate first.
function decodeBase64Url(input: string): string {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalised.length % 4 === 0 ? '' : '='.repeat(4 - (normalised.length % 4));
  return atob(normalised + pad);
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: 'required' | 'optional' | 'none';
  signal?: AbortSignal;
};

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, auth = 'required', signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth !== 'none') {
    try {
      const token = await ensureFreshAccessToken();
      headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      if (auth === 'required') throw err;
      // 'optional' — fall through with no Authorization header
    }
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await res.text();
  const parsed = text ? safeJson(text) : undefined;

  if (res.ok) return parsed as T;

  // Distinguish 401 message variants — the backend tells us why.
  // Only act on 401s for calls that ASKED for auth. For `auth: 'optional'`
  // and `auth: 'none'`, a 401 means the endpoint required auth we didn't
  // attach — not a session problem to react to.
  if (res.status === 401 && auth === 'required') {
    const msg = (parsed as { message?: string })?.message ?? '';
    if (msg === 'Access token has expired') {
      // Could only happen if our isJwtExpired() check disagreed with the
      // server. Force a refresh and retry once.
      refreshInFlight = null; // re-enter ensureFreshAccessToken
      const token = await ensureFreshAccessToken();
      const retry = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
      if (retry.ok) {
        const retryText = await retry.text();
        return safeJson(retryText) as T;
      }
    }
    // Any other 401 on a required call — hard sign-out.
    await clearRefreshToken();
    useAuthStore.getState().setGuest();
  }

  throw new ApiError(
    res.status,
    parsed,
    (parsed as { message?: string })?.message ?? `HTTP ${res.status}`,
  );
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
```

### Usage

```ts
// Public — no auth header
const stores = await api('/products?sortBy=newest', { auth: 'none' });

// Optional auth — best-effort attach if signed in (e.g. store profile)
const profile = await api(`/stores/${slug}`, { auth: 'optional' });

// Required auth — throws ApiError(401) if no valid session
const cart = await api('/cart');

// POST with body
const newAddress = await api('/addresses', {
  method: 'POST',
  body: { recipientName: 'Test', phone: '+27821234567', /* ... */ },
});
```

### Why this shape vs Axios

- **No external dep** for HTTP. RN's `fetch` is fine; the parts that need wrapping (interceptors, AbortController, error normalisation) are short.
- **Type-safe per call** via the generic `<T>`.
- **Single-flight refresh** is explicit, not implicit. You can see the lifecycle.

---

## 4. API Contract

Every endpoint lives under the API base URL. Production: `https://api.yiiva.co.za`. Local: `http://localhost:3000`.

### 4.1 Register

Creates a new BUYER account. Sends a verification email. The account stays in `PENDING_VERIFICATION` until verified — the user can't log in until then.

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
| `phone` | string | no | SA number (`0XXXXXXXXX` or `+27XXXXXXXXX`) |

```json
{
  "email": "buyer@example.com",
  "password": "SecurePass1",
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "0821234567"
}
```

**Success — `201 Created`**

```json
{ "message": "Account created. Please check your email to verify your account." }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `409` | `"Email already registered"` | Email is taken |
| `400` | validation array | Invalid input |
| `429` | rate-limit error | More than 3/min from this IP |

### 4.2 Verify Email

Triggered when the user taps the verification link in the email (universal link → opens app → `expo-router` routes to `VerifyEmailScreen` with `token` in the URL). The screen extracts `token` and calls this endpoint.

```
POST /auth/verify-email
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `token` | string | yes |

**Success — `200 OK`**

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "8f3e2c1a4b...",
  "user": {
    "id": "ck...",
    "email": "buyer@example.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "BUYER",
    "accountStatus": "ACTIVE",
    "emailVerified": true,
    "isGuestAccount": false
  }
}
```

The user is auto-logged-in. Save the refresh token, populate the Zustand store, navigate to `Home`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired verification token"` | Wrong token, already used, or expired (24h) |
| `429` | rate-limit error | More than 5/min |

### 4.3 Login

```
POST /auth/login
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |
| `password` | string | yes |

**Success — `200 OK`** — same response shape as Verify Email (`accessToken`, `refreshToken`, `user`).

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Invalid credentials"` | Wrong email or wrong password (deliberately conflated) |
| `403` | `"Please verify your email before logging in"` | `PENDING_VERIFICATION` account |
| `403` | `"Your account has been suspended. Contact support."` | Suspended |
| `403` | `"This account has been deactivated."` | Deactivated |
| `429` | rate-limit | More than 5/min |

### 4.4 Refresh Tokens

```
POST /auth/refresh
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes |

**Success — `200 OK`** — same response shape as Login. **The returned refresh token is NEW. Persist it immediately.** The old one is now revoked server-side.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | `"Invalid or expired refresh token"` | Token revoked, expired (7d), or not found |
| `429` | rate-limit | More than 10/min |

### 4.5 Logout

Revokes the current device's refresh token.

```
POST /auth/logout
```

**Auth required.** Send `Authorization: Bearer <access>` and the refresh token in the body.

**Request body**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | yes |

**Success — `200 OK`**

```json
{ "message": "Logged out successfully" }
```

Treat logout as **optimistic** — clear local state immediately, fire this in the background. If the call fails, log it but don't surface to the user.

### 4.6 Logout All Devices

Revokes every refresh token for the user.

```
POST /auth/logout-all
```

**Auth required.** No body.

**Success — `200 OK`**

```json
{ "message": "Logged out of all devices" }
```

### 4.7 Forgot Password

```
POST /auth/forgot-password
```

**Request body**

| Field | Type | Required |
|---|---|---|
| `email` | string | yes |

**Success — `200 OK`** — always returns 200, even if the email doesn't exist (security: never reveal whether an email is registered):

```json
{ "message": "If an account with that email exists, we've sent a password reset link." }
```

**Errors:** `400` validation, `429` rate-limit (>3/min). Never a `404`.

### 4.8 Reset Password

Triggered when the user taps the reset link in their email (universal link → app → `expo-router` to `ResetPasswordScreen` with `token`).

```
POST /auth/reset-password
```

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | from the email |
| `password` | string | yes | min 8 chars, uppercase, lowercase, digit |

**Success — `200 OK`**

```json
{ "message": "Password updated. Please sign in with your new password." }
```

**Important side effect:** all refresh tokens for the user are revoked. The user is **not** auto-logged-in (this endpoint does NOT return `accessToken`/`refreshToken`). Navigate to `LoginScreen` with the email prefilled.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired reset token"` | Wrong / used / expired (1h) |
| `400` | validation array | Weak password |
| `429` | rate-limit | More than 5/min |

### 4.9 Get Current User

```
GET /auth/me
```

**Auth required.** No body.

**Success — `200 OK`**

```json
{
  "id": "ck...",
  "email": "buyer@example.com",
  "phone": "+27821234567",
  "firstName": "Jane",
  "lastName": "Doe",
  "avatarUrl": "https://res.cloudinary.com/...",
  "role": "BUYER",
  "accountStatus": "ACTIVE",
  "emailVerified": true,
  "phoneVerified": false,
  "isGuestAccount": false,
  "createdAt": "2026-01-15T...",
  "store": null
}
```

Call this on app cold-start (after refresh) and after any state-changing action (profile edit, etc.).

**Errors**

| Status | Message | Cause |
|---|---|---|
| `401` | various — see [§6](#6-error-handling-reference) | No / expired / invalid token |

### 4.10 Claim Guest Account

Converts a guest user record (created during guest checkout with `isGuestAccount: true`) into a full account by setting a password.

```
POST /auth/claim
```

**No auth required** — the request itself authenticates by knowing the email of the guest record.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | must match the guest user's email |
| `password` | string | yes | min 8 chars (no uppercase/lowercase/digit requirement here, unlike register) |

**Success — `200 OK`**

```json
{ "message": "Account claimed successfully. You can now log in with your email and password." }
```

**Important:** does NOT return tokens. User is not auto-logged-in — navigate to `LoginScreen` with the email prefilled.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"No account found with this email address."` | No matching guest record |
| `409` | `"This email already belongs to a registered account. Please log in."` | Email is already a real account |
| `400` | validation array | Weak password |
| `429` | rate-limit |

> **Known v1 limitation:** the backend currently sets `emailVerified: true` automatically on claim — no verification email is sent. Will tighten when the Notifications module ships. Document in your UI as "your account is ready" without mentioning email verification.

---

## 5. Auth Flows (implementation steps)

These describe **what your code does at each step.** For the screen-level UX (copy, validation timing, error toasts), see [`auth-flows.md`](./auth-flows.md) in this same folder.

### 5.1 Cold-start hydration

Runs once on app launch, before any protected screen is rendered.

```ts
// app/_layout.tsx or your top-level provider
import { useEffect } from 'react';
import { useAuthStore } from '../src/stores/auth';
import { loadRefreshToken, saveRefreshToken, clearRefreshToken } from '../src/lib/secure-storage';

export function useAuthHydration() {
  useEffect(() => {
    void hydrate();
  }, []);
}

async function hydrate() {
  const { setAuthenticated, setGuest, setLoading } = useAuthStore.getState();
  setLoading();

  const refresh = await loadRefreshToken();
  if (!refresh) {
    setGuest();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) {
      await clearRefreshToken();
      setGuest();
      return;
    }
    const data = await res.json();
    await saveRefreshToken(data.refreshToken);
    setAuthenticated(data.user, data.accessToken);
  } catch {
    // Network error — keep in 'loading' a bit longer, but fall back to guest
    // if we can't reach the API. Optionally retry with backoff.
    setGuest();
  }
}
```

The top-level navigator inspects `state.status`:
- `'loading'` → splash screen
- `'authenticated'` → tab navigator (Home/Search/Cart/Wishlist/Orders)
- `'guest'` → tab navigator but with `(modal)/login` available when an auth-gated action is tapped

### 5.2 Registration flow

```ts
import { api } from '../src/lib/api';

async function register(fields: RegisterFields): Promise<void> {
  await api('/auth/register', {
    method: 'POST',
    auth: 'none',
    body: fields,
  });
  // No tokens returned — navigate to "check your email" screen.
  router.replace({ pathname: '/(auth)/check-email', params: { email: fields.email } });
}
```

### 5.3 Verify-email flow

The verify-email link in the user's inbox is a universal link to `https://yiiva.co.za/auth/verify-email?token=...`. `expo-linking` + `expo-router`'s linking config routes that to your `app/auth/verify-email.tsx` route. The route reads `token` from the URL, fires the API, and on success auto-logs the user in.

```ts
// app/auth/verify-email.tsx
import { useLocalSearchParams, router } from 'expo-router';
import { useEffect } from 'react';
import { api } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/auth';
import { saveRefreshToken } from '../../src/lib/secure-storage';

export default function VerifyEmail() {
  const { token } = useLocalSearchParams<{ token: string }>();

  useEffect(() => {
    if (!token) return;
    void verify(token);
  }, [token]);

  async function verify(t: string) {
    try {
      const res = await api<{ accessToken: string; refreshToken: string; user: User }>(
        '/auth/verify-email',
        { method: 'POST', auth: 'none', body: { token: t } },
      );
      await saveRefreshToken(res.refreshToken);
      useAuthStore.getState().setAuthenticated(res.user, res.accessToken);
      router.replace('/(tabs)');
    } catch {
      // Show error screen — see auth-flows.md §4.3 for copy.
    }
  }

  return /* in-flight / success / error UI */;
}
```

### 5.4 Login flow

```ts
async function login(email: string, password: string): Promise<void> {
  const res = await api<{ accessToken: string; refreshToken: string; user: User }>(
    '/auth/login',
    { method: 'POST', auth: 'none', body: { email, password } },
  );
  await saveRefreshToken(res.refreshToken);
  useAuthStore.getState().setAuthenticated(res.user, res.accessToken);
  router.replace('/(tabs)');
}
```

Error handling — branch on the `ApiError`:

```ts
try { await login(email, password); }
catch (err) {
  if (err instanceof ApiError) {
    if (err.status === 401) showBanner('Incorrect email or password.');
    else if (err.status === 403 && /verify your email/.test(err.message)) {
      // Replace form with "verify your email first" screen
    }
    else if (err.status === 403) showFullScreenTakeover(err.message);
    // ... etc
  }
}
```

### 5.5 Silent-refresh flow

Handled entirely inside `api()` (see [§3](#3-making-authenticated-requests)). Two trigger paths:

1. **Pre-flight expiry check** — `ensureFreshAccessToken()` checks `exp` and refreshes if within 30s of expiry. Avoids the round-trip cost of waiting for the request to 401.
2. **Reactive 401** — if the server says `"Access token has expired"`, the wrapper refreshes and retries once.

The **single-flight guard** (`refreshInFlight` promise) prevents two simultaneous 401s from each consuming the same refresh token (the second would 401 because rotation already revoked it).

### 5.6 Logout flow

Optimistic — clear local state immediately, fire the API call in the background:

```ts
async function logout(): Promise<void> {
  const refresh = await loadRefreshToken();

  // Immediate local cleanup — user lands on guest UI instantly.
  await clearRefreshToken();
  useAuthStore.getState().setGuest();
  router.replace('/(tabs)');

  // Background — best effort, no error surfacing.
  if (refresh) {
    void api('/auth/logout', {
      method: 'POST',
      body: { refreshToken: refresh },
    }).catch((err) => {
      console.warn('[auth] background logout failed', err);
    });
  }
}
```

### 5.7 Forgot-password flow

Universal-link routing identical to verify-email:

```ts
// User-initiated:
await api('/auth/forgot-password', {
  method: 'POST',
  auth: 'none',
  body: { email },
});
// Navigate to "check your inbox" screen regardless of whether the email
// existed — the API always 200s for security.
```

```ts
// app/auth/reset-password.tsx — universal-link target
const { token } = useLocalSearchParams<{ token: string }>();

async function submitReset(password: string) {
  await api('/auth/reset-password', {
    method: 'POST',
    auth: 'none',
    body: { token, password },
  });
  // No tokens returned — go to login with email prefilled.
  router.replace({ pathname: '/(auth)/login', params: { email: prefill, banner: 'reset-success' } });
}
```

### 5.8 Claim flow (guest → real account)

Reached from the post-checkout success screen's "Save my account" CTA. The email is already known (from the guest checkout) and is **locked** in the form:

```ts
async function claim(email: string, password: string): Promise<void> {
  await api('/auth/claim', {
    method: 'POST',
    auth: 'none',
    body: { email, password },
  });
  // No tokens returned. Send to LoginScreen with the email prefilled.
  router.replace({ pathname: '/(auth)/login', params: { email, banner: 'claim-success' } });
}
```

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

### Status-code summary

| Status | Meaning | Mobile action |
|---|---|---|
| `200` / `201` | Success | Handle response |
| `400` | Validation or bad token | Inline field errors, or token-error UI for token endpoints |
| `401` | Unauthenticated | Branch on message — see below |
| `403` | Forbidden | Backend message explains why (account state) — show full-screen takeover |
| `404` | Not found | Resource-specific UX |
| `409` | Conflict | Duplicate state — inline error (e.g. email taken) |
| `429` | Rate-limited | Toast: "Too many attempts. Wait a moment and try again." Disable submit for 60s. |
| `5xx` | Server error | Toast: "Something went wrong. Try again." Optionally retry-with-backoff. |
| Network error (no `res`) | Offline / timeout | Toast: "Couldn't reach YIIVA. Check your connection." |

### The four distinct 401 messages

Critical to handle these distinctly — they come from different layers:

| Message | Source | Mobile action |
|---|---|---|
| `"Authentication required"` | No `Authorization` header | Shouldn't reach a user — your wrapper's `auth: 'required'` should have caught this. If seen, log to error tracker and treat as hard sign-out. |
| `"Access token has expired"` | JWT `exp` past | Silent refresh + retry. Handled inside `api()`. |
| `"Invalid access token"` | Malformed / tampered token | Hard sign-out. Clear SecureStore + Zustand, navigate to login. |
| `"Account is inactive or does not exist"` | Account suspended/deactivated/deleted mid-session | Hard sign-out + full-screen takeover ("Your account is no longer active"). Do NOT retry refresh — it would fail too. |

The wrapper distinguishes "expired" (refresh + retry) from everything else (hard sign-out). Don't lump them together.

### Offline + retry

The wrapper currently propagates network errors as plain `Error`. Wrap calls with retry-with-backoff for non-critical endpoints (e.g., `GET /auth/me` on cold start, `GET /products` background prefetch):

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (err instanceof ApiError) throw err; // don't retry HTTP errors
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}
```

Do NOT retry mutating endpoints (`POST /auth/login`, `POST /auth/refresh`) automatically — let the user trigger the next attempt. Auto-retrying writes can cause duplicate side effects.

---

## 7. Rate Limits

Requests exceeding the limit return `429 Too Many Requests`.

| Endpoint | Limit |
|---|---|
| `POST /auth/register` | 3 / minute |
| `POST /auth/forgot-password` | 3 / minute |
| `POST /auth/verify-email` | 5 / minute |
| `POST /auth/login` | 5 / minute |
| `POST /auth/logout` | 5 / minute |
| `POST /auth/logout-all` | 5 / minute |
| `POST /auth/reset-password` | 5 / minute |
| `POST /auth/refresh` | 10 / minute |
| `POST /auth/claim` | (global default — 100 / minute) |
| `GET /auth/me` | 100 / minute (global default) |

On `429`: show "Too many attempts. Please wait a moment and try again." Disable the submit button for 60 seconds. Do **not** automatically retry — wait for the user to try again.

---

## 8. Mobile-Specific Setup

### Expo configuration — `app.json`

Universal links for verify-email + reset-password (plus the checkout return URLs covered in `checkout-flows.md`):

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

The web team owns:
- `https://yiiva.co.za/.well-known/apple-app-site-association` (iOS Universal Links manifest)
- `https://yiiva.co.za/.well-known/assetlinks.json` (Android App Links manifest)

Both must declare your bundle ID + the path prefixes above. Without them, iOS/Android won't intercept the links — they'll open in a browser instead.

### expo-router linking

`expo-router` automatically wires `app/auth/verify-email.tsx` and `app/auth/reset-password.tsx` to the matching universal-link paths. The token comes through as a route param:

```ts
import { useLocalSearchParams } from 'expo-router';

const { token } = useLocalSearchParams<{ token: string }>();
```

If you need to register additional manual deep-link handling (e.g., for `yiiva://` scheme during dev), use `expo-linking`:

```ts
import * as Linking from 'expo-linking';

const url = await Linking.getInitialURL();
// or:
const subscription = Linking.addEventListener('url', ({ url }) => { /* ... */ });
```

In practice with `expo-router` you rarely need this directly — the route's `useLocalSearchParams` is the canonical access point.

### Environment

Use `EXPO_PUBLIC_*` env vars for anything the client needs (these are baked into the bundle at build time — **do not** put secrets here):

```ini
# .env
EXPO_PUBLIC_API_BASE_URL=https://api.yiiva.co.za
```

```ts
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL!;
```

The mobile app has no place to safely hold secret keys — every constant in `EXPO_PUBLIC_*` ships in the JS bundle and is readable from the device. Anything secret-shaped stays server-side.

### Opening the device's mail client

For the "Check your inbox" screen + reset-password "open mail" prompt:

```ts
import * as Linking from 'expo-linking';

async function openMailApp() {
  try {
    await Linking.openURL('message://');             // iOS
  } catch {
    try { await Linking.openURL('mailto:'); }        // Android fallback
    catch { /* no mail app — hide the button */ }
  }
}
```

---

## 9. App Lifecycle and Tokens

### The `AppState` listener

When the app foregrounds after being backgrounded for a while, the in-memory access token may have expired. Refresh proactively so the user's first tap doesn't pay the round-trip cost.

```ts
// In your top-level provider
import { useEffect } from 'react';
import { AppState } from 'react-native';

export function useForegroundRefresh() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void maybeRefreshOnForeground();
      }
    });
    return () => sub.remove();
  }, []);
}

async function maybeRefreshOnForeground() {
  const { state } = useAuthStore.getState();
  if (state.status !== 'authenticated') return;
  if (!isJwtExpired(state.accessToken)) return; // still fresh, do nothing

  try {
    await ensureFreshAccessToken();
  } catch {
    // Refresh failed — user gets bounced to login on their next protected
    // request. ensureFreshAccessToken already cleared SecureStore + Zustand.
  }
}
```

### Cold-start sequence

```
1. App launches.
2. Top-level layout mounts → useAuthHydration() (§5.1) fires.
3. Zustand state.status = 'loading'.
4. SecureStore read (refresh token).
5a. No refresh token → state.status = 'guest' → tab navigator renders in guest mode.
5b. Refresh token present → POST /auth/refresh →
    - 200 → save new refresh, set accessToken + user, state.status = 'authenticated'.
    - 401 → clear SecureStore, state.status = 'guest'.
    - Network error → state.status = 'guest', user can retry.
6. Top-level layout swaps splash for the appropriate navigator.
```

Total time on the splash screen: usually <300ms when the refresh-token round-trip is fast. If you see consistently slow refresh, consider caching the last-known `User` in `AsyncStorage` and rendering the authenticated UI optimistically while the refresh resolves in the background (mark the state as `'authenticated-stale'` if you want to gate writes).

### Force-close behaviour

iOS / Android may kill the app at any time when backgrounded. The next launch is a cold-start — the hydration sequence above runs again. Refresh token persists; access token doesn't. No special handling needed.

### Memory pressure

Zustand state is in memory only — wiped when the JS context is destroyed. Refresh token in SecureStore survives. The hydration sequence rebuilds the Zustand state from the refresh-token round-trip. This is by design — you don't want the access token to survive a memory-pressure kill.

### Logout cleanup checklist

When logging out (optimistic or post-error hard sign-out):

- [x] Clear SecureStore (`clearRefreshToken()`)
- [x] Zustand `setGuest()`
- [x] Navigate to a guest-safe route (Home tab in guest mode is fine; login screen if mid-flow)
- [ ] Clear any user-specific `AsyncStorage` entries (cached `User` object, recently-viewed)
- [ ] Cancel any in-flight authenticated requests (use an AbortController on the auth store)
- [x] Fire `POST /auth/logout` in the background (don't await)

The Zustand `setGuest()` is the canonical signal — every component that reacts to auth state should subscribe and re-render when this flips.

---

## Appendix — User Roles

The mobile app primarily serves the BUYER role. Users who started as buyers and later became merchants by creating a store retain the `MERCHANT` role but **continue to use the mobile app as buyers** — there is no merchant UX in the mobile app (merchants use the Next.js web dashboard for store management).

| Role | Mobile app behaviour |
|---|---|
| `BUYER` | Full buyer experience — discover, cart, checkout, orders, wishlist |
| `MERCHANT` | Same as BUYER. Merchant-side capabilities are not exposed in mobile. |
| `ADMIN` | Same as BUYER (admins are seeded directly into the DB and use the web admin panel for moderation). No special mobile-side privileges. |

The auth Zustand store doesn't gate any mobile screen on `role` — every authenticated user gets the same UI. The only differentiation is `accountStatus` (suspended/deactivated → full-screen takeover) and `isGuestAccount` (post-checkout claim CTA surfaces while true).
