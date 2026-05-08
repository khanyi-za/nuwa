# YIIVA — The Employee Journey

> **Audience:** Frontend engineers, product, and design working on the merchant web app.
> **Scope:** The end-to-end experience of a YIIVA store **employee** — a person invited by a merchant to help manage their store. Organized chronologically by user journey, not API module.
>
> **How to use this doc:** read once for the human arc, then reach for the module-level flows docs (referenced throughout) when building specific screens.
>
> **Companion docs:**
> - [`auth-frontend-flows.md`](./auth-frontend-flows.md) — auth screens (the employee uses these for register/sign-in)
> - [`store-frontend-flows.md`](./store-frontend-flows.md) — invite recipient + employee-list screens
> - [`product-frontend-flows.md`](./product-frontend-flows.md) — product editing surfaces (employees use these like merchants)
> - [`merchant-journey.md`](./merchant-journey.md) — the merchant who invited them
> - [`admin-journey.md`](./admin-journey.md) — YIIVA staff (forthcoming)

---

## Table of Contents

1. [Persona snapshot](#1-persona-snapshot)
2. [The journey at a glance](#2-the-journey-at-a-glance)
3. [Phase 1 — Receiving the invite](#3-phase-1--receiving-the-invite)
4. [Phase 2 — The authentication path](#4-phase-2--the-authentication-path)
5. [Phase 3 — Accepting the invite](#5-phase-3--accepting-the-invite)
6. [Phase 4 — Day-to-day operations](#6-phase-4--day-to-day-operations)
7. [Phase 5 — Returning sessions](#7-phase-5--returning-sessions)
8. [Edge moments across the journey](#8-edge-moments-across-the-journey)
9. [Cross-module touchpoints](#9-cross-module-touchpoints)
10. [Drop-off risks and UX responses](#10-drop-off-risks-and-ux-responses)
11. [UX and copy guidance specific to the employee](#11-ux-and-copy-guidance-specific-to-the-employee)

---

## 1. Persona snapshot

### Who the YIIVA employee is

A person the merchant trusts enough to invite into their dashboard. In practice, the employee is usually:

- The merchant's **co-founder or sibling** helping run the brand
- A **freelance social-media manager** who handles content and product listings
- A **part-time staffer or virtual assistant** packaging orders and managing inventory
- A **friend with photography skills** uploading product images

The employee is *not* an internal YIIVA employee, and *not* a separate brand — they're embedded in someone else's store. They're operational labour, **often serving more than one merchant**: a freelance Instagram manager might run uploads for several brands, a VA might package orders for two or three creators, a friend-with-camera might handle photography for multiple stores in their network. Multi-store employment is normal in the SA creative-economy use case and the frontend must support it from v1.

> **Important framing:** the employee is not a separate YIIVA persona for legal or business purposes. From YIIVA's database point of view they are a `BUYER` user with a `StoreEmployee` record linking them to one store. From their daily work point of view, they are *"a team member at BOLD Streetwear"*. The frontend has to bridge this gap — see [§11 UX and copy guidance](#11-ux-and-copy-guidance-specific-to-the-employee).

### Their relationship to the merchant

It's a **personal relationship**, not a corporate one. The merchant typed in this person's email by hand. The employee knows the merchant by name. There's existing trust before YIIVA enters the picture.

This shapes the UX in two ways:
1. The employee will likely **trust the invite email is real** (they're expecting it)
2. The employee will likely **forgive UX rough edges** because they're doing a favour for someone they know

Don't take this for granted, but it's why the employee journey can be a bit lighter on persuasion than the merchant journey. The hard work has already been done — the merchant convinced them to help.

### Their tech-savvy level

Comparable to the merchant, sometimes a notch higher (especially the freelance social-media managers). Like the merchant, treat them as a non-technical small-business operator. Same UI principles apply: no jargon, no internal codes, clear recovery copy.

### What they want

- *"Just tell me what to do for {merchant} and let me do it."*
- *"Don't make me create another account if I already have one."*
- *"Let me know which store I'm working on at all times."*

### Their success metric

The employee's success metric is **doing the work the merchant invited them to do**, with as little friction as possible. They don't need a celebration moment when they accept the invite — they need to land in the store dashboard, see what the merchant has set up, and start being useful.

---

## 2. The journey at a glance

### The five phases

```
Phase 1: Receiving the invite      (real-time after merchant sends)
   ↓
Phase 2: Authentication path        (1–10 minutes)
   ↓
Phase 3: Accepting the invite       (30 seconds)
   ↓
Phase 4: Day-to-day operations      (ongoing)
   ↓
Phase 5: Returning sessions         (ongoing — every login)
```

### Estimated time from invite-clicked to first-action-in-dashboard

| Path | Duration | Notes |
|---|---|---|
| Existing YIIVA account, right email | ~1 minute | Sign in → accept → in dashboard |
| Existing YIIVA account, wrong email | ~2 minutes | Sign out → sign in with right account → accept |
| New user, no YIIVA account | ~5–10 minutes | Register → verify email → return → accept |

### Where employees typically drop off

| Drop-off moment | Risk level | Cause |
|---|---|---|
| Email never arrives | Medium | Spam folder, typo on merchant's side |
| Invite expired | Medium | More than 7 days passed before they clicked |
| Wrong-account friction | Low–medium | They're already signed in as a different YIIVA account |
| Returning-session disorientation | **Medium-high** | `/auth/me` returns `null` store on subsequent logins — see [§5 Returning sessions](#7-phase-5--returning-sessions) |

The **single highest-risk moment** is the returning session — the day after acceptance, when the employee logs back in and the system has no built-in way to know they're an employee. The localStorage workaround [§7](#7-phase-5--returning-sessions) is critical infrastructure for this.

### What's intentionally absent

The employee journey has **no celebration milestones**. Unlike the merchant (first approval, first product, going live), there's no big moment to mark for the employee. Acceptance is a transactional action — they got an invite, they accepted, they're working. Don't manufacture confetti where none belongs; just put them efficiently into the work.

---

## 3. Phase 1 — Receiving the invite

### What's happening

The merchant clicks "Invite teammate" → enters an email → backend creates a `StoreEmployee` record + sends an invite email via Resend. The email arrives at the recipient's inbox with a 7-day-valid link.

### What the employee feels

If they're expecting it, they open the email and click the link. If they're not, they pause: *"Am I being added to something?"* The email's tone determines whether they trust it.

### The email itself (out of scope for the frontend, but worth noting)

The invite email is sent server-side via the email service. The merchant web app doesn't render it. But the link the email contains is your concern:

```
{MERCHANT_APP_URL_BASE}/invites/accept?token=<rawToken>
```

The frontend's invite-recipient surface picks up at this URL.

> **Note on email lookups:** the email subject and body are templated server-side. If a frontend-facing concern surfaces (e.g., the email's wording feels off, or the link points to the wrong path), coordinate with backend rather than try to handle it in-app. The frontend's job is to make the landing page lovely; the email is the email-team's surface.

### Phase-1 success looks like

- The recipient receives the email within a few minutes of the merchant clicking Invite
- They click the link

### Failure modes

- **Spam folder.** Real risk. The merchant's frontend should make this clear when the invite is sent: *"If they don't see it, ask them to check their spam folder."* See [store flows §4.1](./store-frontend-flows.md#41-send-invite).
- **Typo'd email on the merchant side.** The invite gets sent to nobody. Recovery: the merchant uses [resend invite](./store-frontend-flows.md#43-resend-invite) after correcting (which currently requires deleting the wrong record and re-inviting, since the `email` is the unique key per store — flag if this becomes friction).
- **Email delivery failure.** Backend logs the failure but doesn't surface it loudly. The merchant can use Resend.

---

## 4. Phase 2 — The authentication path

### What's happening

The recipient clicks the invite link and lands on the public invite-validation page. They see store branding (logo, displayName), the email the invite was sent to, and contextual CTAs depending on their auth state.

### What the employee feels

*"Is this real?"* — quickly resolved by seeing the store's logo and name.
*"Do I already have a YIIVA account?"* — the next question they ask themselves.

### Screens involved

- [Auth flows §2.8 Invite landing — public, pre-auth](./auth-frontend-flows.md#28-invite-landing--public-pre-auth) — the validation + branded landing
- [Auth flows §2.4 Login](./auth-frontend-flows.md#24-login--login) — for existing YIIVA users
- [Auth flows §2.1 Registration](./auth-frontend-flows.md#21-registration--register) and §2.3 (verification) for new users

### The journey moments

#### Path A — Existing YIIVA user (most common for SA creators)

The recipient is already on YIIVA — they may be a buyer, or they themselves may run another store.

**The flow:**
1. Click invite link → validate token → see the branded landing
2. Click *"Sign in to accept"* → land on `/login?returnUrl=/invites/accept?token=...`
3. Sign in → on success, the auth flow redirects them back to the invite-accept page
4. The page now shows the [accept-invite UI](#5-phase-3--accepting-the-invite)

**Edge case — wrong account:** the user is signed in as a different email than the invite was sent to.

The invite-landing page (post-validation) detects the mismatch:

```
This invite was sent to thabo@gmail.com, but you're
signed in as lerato@example.com.

[ Sign out and use the right account ]
```

This is a **specific UX path** — see [auth flows §2.8](./auth-frontend-flows.md#28-invite-landing--public-pre-auth) for the four-state primary-action table. Frontend should detect this state proactively, before the user clicks "Accept" and gets a 400.

#### Path B — New YIIVA user

The recipient has no account.

**The flow:**
1. Click invite link → validate token → see the branded landing
2. Click *"Create a YIIVA account"* → land on `/register?email=<invite.email>&returnUrl=/invites/accept?token=...`
3. **Email field is pre-populated** with the invite's email
4. They register → check-email handoff → click verification link → auto-login
5. The auth flow redirects them back to `/invites/accept?token=...`
6. The page now shows the accept-invite UI

> **Pre-populating the email field is critical.** If the new user types a different email by accident, they end up with the wrong-account problem. The pre-fill should be explicit but not locked — they can change it (some users have multiple emails and may want to use a different one with the *same recipient identity*). A small helper note: *"This email matches the invite. You can change it if you'd rather use a different account."*

### Phase-2 success looks like

- Existing user: signed in with the right account, ready to accept
- New user: registered with the invite email, verified, signed in, ready to accept
- Either way, the user is at the accept-invite UI within 1–10 minutes

### Failure modes

- **Token expired (7 days).** The validate call returns 400. Show:

  ```
  This invite is no longer valid

  Invitations expire after 7 days. Ask {firstName} to send
  you a new one.

  (No support button — this is between the merchant and the recipient.)
  ```

- **Wrong account.** Covered above. Make sure the recovery is "sign out and use the right account" — not "sign up again" (which creates duplicate accounts).
- **Verification email delays for new users.** Same recovery path as the merchant: support contact (no resend endpoint in v1).

---

## 5. Phase 3 — Accepting the invite

### What's happening

The user is now authenticated with the right email. They see the accept-invite UI. They optionally enter an employee number and click "Join {storeDisplayName}". Backend updates the `StoreEmployee` record (sets `userId`, `acceptedAt`, clears `inviteToken`). The employee is now an active team member.

### What the employee feels

A brief sense of arrival. *"OK, I'm in."* They want to start working.

### Screens involved

- [Auth flows §2.9 Invite acceptance — authenticated](./auth-frontend-flows.md#29-invite-acceptance--authenticated) — the accept screen
- [Store flows §5 Employee invite — recipient screens](./store-frontend-flows.md#5-employee-invite--recipient-screens) — store-side overview

### The journey moments

**The accept screen:**

```
You're invited to manage BOLD Streetwear

[logo]

This invite was sent to thabo@gmail.com.

Employee number  (optional)
[___________]    "Some teams track teammates by employee numbers.
                  You can leave this blank."

[ Join BOLD Streetwear ]
```

The store branding (logo, displayName) is prominent. The employee should feel like they're entering BOLD Streetwear, not a generic system surface.

**Critical action after success:**

When `POST /employees/invites/accept` returns 200 with `{ store: { id, displayName, slug } }`:

1. **Append the store summary to a localStorage array** under a stable key (e.g. `yiiva_employee_stores_${userId}`). Each entry: `{ id, displayName, slug, lastAccessedAt }`. The array supports employees who work for multiple merchants — a single-store value would force overwriting on every new acceptance.
2. **If the same `store.id` already exists in the array, update the existing entry** (refresh `lastAccessedAt`) rather than creating a duplicate.
3. **Navigate to the merchant dashboard** for that `store.id`. Set `lastAccessedAt` to now.
4. **Show a brief, low-key confirmation**: *"Welcome to {displayName}!"* — a toast or banner, not a celebration modal. Acceptance is transactional, not milestone-worthy.

**Why this localStorage shape matters:** see [§7 Returning sessions](#7-phase-5--returning-sessions). The array structure (rather than a single ID) is what makes the multi-store case work without breaking single-store users.

### Phase-3 success looks like

- Employee accepts within 30 seconds of seeing the accept screen
- They land in the store dashboard ready to work
- Their `store.id` is persisted client-side

### Failure modes

- **Token consumed in another tab.** Rare, but possible. The accept call returns 400. Show: *"This invite has already been accepted. You should already have access to {storeName}."* with a link to the dashboard.
- **Network failure mid-accept.** Show retry; don't lose the invite token from local state.

---

## 6. Phase 4 — Day-to-day operations

### What's happening

The employee is in the merchant dashboard for the store they're employed at. They start doing work — adding products, editing descriptions, uploading images, managing collections.

### What the employee feels

This is the meat of the journey. They want to be useful. The dashboard should make it clear:
- Which store they're working on (always)
- What they can do (the actions they have permission for)
- What they can't do (and why, if surfaced)

### Screens involved

- [Store flows §3 Address management](./store-frontend-flows.md#3-address-management) — addresses (employees can manage)
- [Store flows §4 Employee management (owner-side)](./store-frontend-flows.md#4-employee-management-owner-side) — they can VIEW the team list but not manage it
- [Product flows §2–§9](./product-frontend-flows.md) — full product surface (employees have full access here)

### What the employee can do

| Action | Allowed? | Notes |
|---|---|---|
| View store dashboard | yes | Same dashboard the merchant sees |
| Edit store details (description, story, contact) | yes | `canManageStore` allows this |
| Upload logo/banner | yes | Same as merchant |
| Add/edit/delete addresses | yes | Including the last-address rule |
| **Edit bank details** | yes (currently — gap) | Design intent says owner-only, but the current contract permits employees via `PATCH /stores/:id` (the bank fields are accepted in `UpdateStoreDto`, which uses `canManageStore` for authz). See note below. |
| Add/edit/activate/archive products | yes | Full product surface |
| Add/edit/delete variants, images, tags, categories | yes | Full sub-resource access |
| Manage collections | yes | Full access |
| View team list | yes | Read-only — no action buttons |
| Invite/resend/deactivate/remove other employees | **no** | Owner only — backend enforces via `isStoreOwner` |
| Submit store for review | **no** | Owner only |
| Request go-live | **no** | Owner only |
| Delete the store | **no** | No DELETE endpoint exists at all in v1 |

> **Backend follow-up needed for bank details:** `store-module-fundamentals_v2.md` (the design doc) says *"Edit bank/payout details | Owner only"*, but the current `update()` service uses `canManageStore` (allowing both owner and employee). The backend should split the bank fields into an owner-only authz path (e.g. a separate endpoint, or a service-level role check on those fields). Until that ships, **the frontend hides the bank-details section from employees as a stop-gap** — but treat this as a known security gap, not a solved problem. A determined employee could call `PATCH /stores/:id` directly with bank fields and the backend would accept it. Track for backend remediation before going live with multi-employee stores at scale.

### The store-context indicator (always-visible)

Because the employee may also have their own buyer activity on the consumer mobile app, it's important the merchant web app makes it **unmistakable** which store they're working on:

- A **persistent header strip** showing the store's logo + displayName, e.g.:

  ```
  ┌───────────────────────────────────────────────────────┐
  │ [logo] Working on: BOLD Streetwear            {avatar}│
  └───────────────────────────────────────────────────────┘
  ```

- The user's avatar in the corner shows their own profile (they're still `Thabo`, not `BOLD Streetwear`)
- This reinforces the bridge between *"I am Thabo, the user"* and *"I'm working on BOLD Streetwear, the store"*

### Owner-only action collisions

The frontend renders the same dashboard for owners and employees. Some actions are owner-only (per the table above). UX rules:

- **Hide owner-only buttons entirely from employees.** Don't show disabled "Submit for review" / "Invite teammate" / "Request go-live" buttons — the empty-disabled state is more confusing than absence.
- **Hide the bank-details section entirely** even though the backend doesn't enforce it. Treat this as a frontend-side policy decision aligned with design intent.
- **If the employee somehow triggers an owner-only action** (deep link, stale UI), the backend returns 403 with a specific message (*"Only the store owner can ..."*). Surface this as a brief toast rather than a full-screen takeover — it's a recoverable confusion, not an emergency.

### Phase-4 success looks like

- The employee feels productive within their first session
- They never feel uncertain about which store they're working on
- They never see disabled buttons that say "owner only" — those buttons aren't there for them

### Failure modes

- **Confusion about identity.** *"Am I logged in as Thabo or as BOLD Streetwear?"* Mitigation: the persistent store-context header.
- **Hitting an owner-only wall.** *"Why can't I submit the store?"* Mitigation: the buttons aren't there; if they ask the merchant directly, the merchant clarifies.
- **Stale dashboard state.** If the merchant deactivates the employee mid-session, their next API call returns 403. Frontend should clear localStorage and route them per the buyer matrix. See [§8.1](#81-employee-deactivated-or-removed-mid-session).

---

## 7. Phase 5 — Returning sessions

### What's happening

The employee logs back in days or weeks after accepting. They expect to land in the store they were working on. The system has no `/auth/me` field telling the frontend they're an employee — `/auth/me` returns `role: BUYER` and `store: null` (which is the *owned* store, which they don't have).

This is the **most fragile UX moment in the employee journey**.

### What the employee feels

*"Wait, where's BOLD Streetwear?"* Confusion if not handled.

### Screens involved

- [Auth flows §2.4 Login](./auth-frontend-flows.md#24-login--login) — the login screen
- [Auth flows §3 Post-login routing matrix](./auth-frontend-flows.md#3-post-login-routing-matrix) — would normally route a `BUYER` with `null` store to onboarding, which is wrong for an employee
- [Store flows §5 Employee invite — recipient screens](./store-frontend-flows.md#5-employee-invite--recipient-screens) — describes the workaround

### The localStorage workaround

This is the v1 mechanism that makes the returning-session experience work. It was set up at acceptance time (Phase 3) and is consulted on every login.

**Flow on each login:**

```
1. Login succeeds → /auth/me returns { role: BUYER, store: null }
2. Read localStorage[yiiva_employee_stores_${userId}]
   → array of { id, displayName, slug, lastAccessedAt }

3. If array has 0 entries:
   a. Route per the buyer matrix (likely "Apply to sell" onboarding,
      with a "Were you invited?" link as a recovery escape hatch)

4. If array has exactly 1 entry:
   a. Use the cached store summary for dashboard chrome
   b. Navigate to /merchant/{storeId}
   c. Call GET /stores/{storeId}/employees to confirm still active
   d. On 200, render the dashboard, update lastAccessedAt
   e. On 403, prune this entry from the array, restart from step 3
      (array now has 0 entries → buyer matrix)

5. If array has 2+ entries:
   a. Show a "Which store are you working on today?" picker
      (cards with logo, displayName, lastAccessedAt;
       sorted by lastAccessedAt descending)
   b. After user picks, follow the verify-then-render flow from 4b–4e
   c. On 403 for the chosen store, prune just that entry (keep the others)
      and re-show the picker
   d. The dashboard chrome includes a small "Switch store" dropdown
      so the user can jump between their stores without going back through
      the picker
```

The verification call in step 4c / 5b is critical — without it, a deactivated or removed employee could land in the dashboard for a moment before hitting their first authz failure. The verification call (which uses `canManageStore`) is the right gate because it returns 403 if the user is no longer an active accepted employee.

### Step 4 disambiguation — "what to do if there's no localStorage entry"

A user with `role: BUYER`, `store: null`, and no localStorage entry could be:
- A genuine new buyer who registered on the merchant web app (rare; they should be on the consumer app)
- An employee whose localStorage was cleared (cookies wiped, new browser, etc.)

The frontend can't tell which without an API. Two options:

**Option A — Default to onboarding.** Route them to the "Start a store" screen. If they're an employee with cleared localStorage, they'll be confused. Recovery: they ask the merchant for a fresh invite link from their email or via `/invites/accept?token=...`.

**Option B — Add a small text link** on the onboarding screen: *"Were you invited to a store? Find your invite email."* — gives confused employees a path back without awkwardness.

**Recommendation:** Option B. Costs nothing; helps the displaced employee.

### What when the store goes through status changes

The employee's experience isn't really affected by store status changes (`APPROVED` → `PENDING_GO_LIVE` → `ACTIVE`). They keep their access throughout. Their UI signals this change passively (the store-context header may show a small badge: "Live", "Under review for go-live", etc.) but they don't get explicit notifications.

### Phase-5 success looks like

- The employee logs back in and lands in the store dashboard within ~2 seconds
- They never see the merchant onboarding screen (which is for would-be store owners)
- Their work continues uninterrupted

### Failure modes

- **localStorage cleared** (cookies wiped, new browser, private/incognito session) — the array is empty, the user routes to buyer onboarding, the "Were you invited?" link is the recovery escape hatch.
- **Single store gets removed** (employee deactivated/removed by that owner) — the verify-then-render flow's 403 catches this and prunes just that entry; if other stores remain, the user continues with those.
- **All stores get removed** — array drops to 0 entries, user routes per the buyer matrix on next login. Same recovery as cleared-localStorage.
- **Stale `displayName` or `logoUrl` cached** — the entry's cached summary may not match the latest server state (the merchant renamed their store). The post-render fetch from the dashboard refreshes this; the picker is briefly out of date but corrects itself. Acceptable for v1.

---

## 8. Edge moments across the journey

### 8.1 Employee deactivated or removed mid-session

The owner deactivates or removes the employee while they're working in another tab. Their next API call returns:

- `403 "You do not have permission to manage this store"` — for any sub-resource action

**UX:**
- Treat this as recoverable, not catastrophic
- Show a banner: *"Your access to {storeName} has been removed. If you think this is a mistake, contact {merchantFirstName}."* — no support contact (this is between the employee and the merchant)
- Clear localStorage entry for this store
- After 5 seconds or on user click, route to `/login` (sign them out cleanly)

**Why we don't treat this as a takeover:** the user is still an authenticated `BUYER` on YIIVA. They just no longer have store access. They might still want to use the consumer app on mobile.

### 8.2 Owner suspends the store

Currently aspirational — backend has no endpoint to suspend a store ([store flows §2.9](./store-frontend-flows.md#29-suspended--closed--read-only-states)). When it ships, the store dashboard goes read-only for everyone (owner and employee). The employee sees the same suspension screen as the owner: *"This store is suspended. Contact support."*

### 8.3 Forgotten password mid-acceptance

The new user (Path B in Phase 2) registers, gets the verification email, but forgets their password before completing the flow. They go through forgot-password → reset → log back in.

- The invite token is still valid (within 7 days, not yet accepted)
- They navigate back to `/invites/accept?token=...`
- The validate call returns 200 (still valid)
- They accept normally

**Important:** the invite token is **independent of the user's password reset**. The employee doesn't lose the invite by going through password recovery.

### 8.4 Multi-tab during acceptance

Tab A is on the accept-invite page. Tab B is on the buyer onboarding (because the user clicked an old link). Tab A submits accept first → 200. Tab B's local state is now stale.

**Mitigation:** the invite token is single-use after acceptance. Tab B's accept call would 400. Surface the same "already accepted" message as in Phase 3 failure modes.

### 8.5 Employee tries to invite another employee

They click "Invite teammate" (which shouldn't be visible, per [§6 owner-only collisions](#owner-only-action-collisions)). The backend rejects with 403 "Only the store owner can invite employees".

If this happens, it's a frontend bug — the button shouldn't have been rendered. Treat as a guard for the bug:
- Toast: *"Only the store owner can invite teammates. Ask {merchantFirstName}."*
- Log the event for engineering follow-up

### 8.6 Invite link lost / shared

The invite link contains a one-time token. If the employee forwards it to someone else, that other person could potentially try to accept (assuming they have the right email).

**Backend protection:** the accept endpoint verifies that the authenticated user's email matches the invite email. So forwarding the link to a different email account fails.

**Edge case:** the employee shares their YIIVA login with another person. That's a credential-sharing problem, not an invite-flow problem. Not specifically addressable in this journey doc.

---

## 9. Cross-module touchpoints

### 9.1 Auth × Store: the "no employments" `/auth/me` gap

The most consequential cross-module touchpoint. `/auth/me` doesn't tell the frontend the user is an employee. Workaround: localStorage. Future fix: a backend `/auth/me/employments` (or equivalent) endpoint that lists store memberships, removing the workaround.

This is documented as a backend follow-up across all the flows docs ([auth flows §1 callout](./auth-frontend-flows.md#1-context), [store flows §5](./store-frontend-flows.md#5-employee-invite--recipient-screens)). The employee journey is the persona most affected by this gap.

### 9.2 Store × Product: full access for employees

Once an employee is active, their access to the product module is **identical to the merchant's**. The product module's authz is `canManageStore`, which returns `true` for both owner and active employee. So the entire product surface (inventory, editor, activation, archive, collections) is available to the employee.

This was a deliberate code change earlier in this session — see the product module review where we removed the `@Roles(MERCHANT)` guards from product controllers. Without that fix, employees (who are `BUYER`) would have been blocked from the entire product surface.

### 9.3 Auth × Store: the role mismatch

The employee's `role` is `BUYER` even though they work on a merchant store. This means:
- Their JWT says `BUYER`
- `/auth/me` returns `role: BUYER`
- Frontend role-based routing logic must NOT use `role === MERCHANT` as the gate for "can see merchant dashboard"; it must use the localStorage-backed employment-context gate

If your frontend has any code that gates merchant-dashboard rendering on `role === MERCHANT`, employees will be locked out. The gate should be:

```
canSeeMerchantDashboard = (
  role === MERCHANT ||
  (role === BUYER && hasStoredEmployment)
)
```

---

## 10. Drop-off risks and UX responses

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Email never received | 1 | Medium | Merchant-side resend flow; "check spam" prompt on the merchant's invite-sent UI |
| Invite expired (>7 days) | 2 | Medium | Clear "this invite is no longer valid" recovery copy; merchant resends |
| Wrong-account sign-in | 2 | Low–medium | Detect mismatch on validate; "sign out and switch" CTA |
| Verification delay (new users) | 2 | Medium | Same as merchant's: support contact (until backend resend ships) |
| Returning-session disorientation | **5** | **Medium-high** | localStorage workaround; "were you invited?" link on the onboarding screen |
| Multi-store employee disorientation | 5 | Medium | Support N stores from v1 — array-based localStorage + picker on multi-store login + dashboard switcher dropdown ([§7](#7-phase-5--returning-sessions)) |
| Hitting owner-only wall | 4 | Low (mitigated by hiding) | Hide owner-only buttons entirely; toast as a guard if it triggers |
| Mid-session deactivation | 8 | Low | Banner + clean sign-out; mention the merchant by first name |

---

## 11. UX and copy guidance specific to the employee

### Voice and tone

The employee is a teammate, not a customer. Talk to them like a colleague.

**Do:**
- *"Welcome to BOLD Streetwear, {firstName}."* — at acceptance
- *"Working on BOLD Streetwear"* — store-context header
- *"Ask {merchantFirstName} for a fresh invite."* — when an invite expires

**Don't:**
- *"You have been granted access to the store."*
- *"Your employee role is active."*
- *"Resource access denied."*

### Bridge the role-vs-context gap

The employee's `role` is `BUYER`. Their working context is *"team member at BOLD Streetwear."* Don't expose the system role anywhere in the UI:

| Don't say | Say instead |
|---|---|
| *"Logged in as: BUYER"* | *"Working on: BOLD Streetwear"* |
| *"Your role doesn't permit this."* | *"Only the store owner can do this."* |
| *"Account type: Buyer + Employee link"* | (don't expose this at all — show their name and the store) |

### Avoid celebration moments

Unlike the merchant, the employee doesn't get milestone celebrations. Acceptance is acknowledged with a brief toast (*"Welcome to BOLD Streetwear!"*) and a fast transition into the dashboard. Don't manufacture confetti. The employee is here to work, not to be congratulated.

### Always-visible store context

The store-context header (logo + displayName) should be **always visible** on every screen of the merchant dashboard. The employee may switch between this app and Instagram, between this store and another (if multi-employed), between work tabs and personal tabs. The header is their constant orientation.

### Recovery copy when they hit an ownership wall

If the employee somehow triggers an owner-only action (frontend bug, deep link, etc.), the recovery copy should:
- Name the action they tried
- Name the merchant who can do it
- Suggest contacting the merchant directly (not YIIVA support)

Example: *"Only {merchantFirstName} can submit the store for review. Ask them when you next chat."*

This frames the system as the merchant's tool, with the employee operating inside it. Nobody needs to call YIIVA for this.

### Configuration values used in copy

The example copy in this doc references `support@yiiva.co.za` as the support contact, `{MERCHANT_APP_URL_BASE}` as the invite-link domain, and merchant first names like `{merchantFirstName}`. **Treat the support email and `MERCHANT_APP_URL_BASE` as placeholders** — same pattern as the other flows docs ([auth flows §1](./auth-frontend-flows.md#1-context), [store flows §1](./store-frontend-flows.md#1-context), [merchant journey §12](./merchant-journey.md#configuration-values-used-in-copy)). Pull from frontend config (e.g. `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_MERCHANT_APP_URL_BASE`).

The merchant first name comes from API responses (e.g. the `acceptInvite` response includes store + inviting context). Make sure your client-side state has the merchant's name available for the recovery copy to use.

---

## Closing note

The employee journey is the merchant journey's quieter cousin — fewer phases, fewer milestones, fewer screens, but with one critical fragility (the localStorage-dependent returning session) that has to be handled correctly or the whole experience breaks.

Evaluate every employee-journey UX decision against:

**Does this make the employee feel like a useful teammate, or like a confused stranger in someone else's account?**

The answer should always be the former.
