# YIIVA Store — Frontend Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA merchant web app (Next.js).
> **Scope:** Screen-level flows, state-driven UX, copy, and edge cases for **all store-related user journeys** in the merchant web app — merchant onboarding through go-live, address and employee management, and admin review queues.
>
> **Companion docs:**
> - [`store-module-api.md`](./store-module-api.md) — endpoint shapes, request/response, error tables. Source of truth for the API contract.
> - [`auth-frontend-flows.md`](./auth-frontend-flows.md) — covers post-login routing into the screens described here.
> - [`auth-module-api.md`](./auth-module-api.md) — `/auth/me` shape (returns the `store` object that drives routing in this doc).
>
> This doc focuses on **what each persona sees and how they move through the store lifecycle**. Cross-reference the contract for endpoint specifics; do not duplicate them here.

---

## Table of Contents

1. [Context](#1-context)
2. [Merchant flows](#2-merchant-flows)
   - [2.1 Onboarding handoff (BUYER → "Start a store")](#21-onboarding-handoff-buyer--start-a-store)
   - [2.2 Store setup wizard (DRAFT)](#22-store-setup-wizard-draft)
   - [2.3 Submission and validation feedback](#23-submission-and-validation-feedback)
   - [2.4 First-review waiting state (PENDING_REVIEW) + rejection recovery (DRAFT + rejectionReason)](#24-first-review-waiting-state-and-rejection-recovery)
   - [2.5 Approved — preparing for go-live](#25-approved--preparing-for-go-live)
   - [2.6 Request go-live](#26-request-go-live)
   - [2.7 Final-review waiting state (PENDING_GO_LIVE) + go-live rejection recovery](#27-final-review-waiting-state-and-go-live-rejection-recovery)
   - [2.8 ACTIVE — live store](#28-active--live-store)
   - [2.9 SUSPENDED / CLOSED — read-only states](#29-suspended--closed--read-only-states)
3. [Address management](#3-address-management)
   - [3.1 Add an address](#31-add-an-address)
   - [3.2 Edit an address](#32-edit-an-address)
   - [3.3 Delete an address](#33-delete-an-address)
4. [Employee management (owner-side)](#4-employee-management-owner-side)
   - [4.1 Send invite](#41-send-invite)
   - [4.2 View team list](#42-view-team-list)
   - [4.3 Resend invite](#43-resend-invite)
   - [4.4 Deactivate / reactivate](#44-deactivate--reactivate)
   - [4.5 Remove (hard delete)](#45-remove-hard-delete)
5. [Employee invite — recipient screens](#5-employee-invite--recipient-screens)
6. [Admin flows](#6-admin-flows)
   - [6.1 Initial review queue](#61-initial-review-queue)
   - [6.2 Review-a-store detail screen](#62-review-a-store-detail-screen)
   - [6.3 Approve a store](#63-approve-a-store)
   - [6.4 Reject a store (with copy guidance)](#64-reject-a-store-with-copy-guidance)
   - [6.5 Go-live review queue](#65-go-live-review-queue)
   - [6.6 Review-go-live detail screen](#66-review-go-live-detail-screen)
   - [6.7 Approve go-live](#67-approve-go-live)
   - [6.8 Reject go-live](#68-reject-go-live)
7. [Edge cases & coordination](#7-edge-cases--coordination)
   - [7.1 Role-upgrade JWT timing](#71-role-upgrade-jwt-timing)
   - [7.2 RejectionReason banner persistence](#72-rejectionreason-banner-persistence)
   - [7.3 Image upload — cloud storage first, PATCH the URL second](#73-image-upload--cloud-storage-first-patch-the-url-second)
   - [7.4 Multi-tab merchant setup](#74-multi-tab-merchant-setup)
   - [7.5 Employee dashboard discovery limitation](#75-employee-dashboard-discovery-limitation)
8. [UX patterns & copy guidance](#8-ux-patterns--copy-guidance)
9. [Testing checklist](#9-testing-checklist)

---

## 1. Context

### Three personas (recap)

This doc continues from [`auth-frontend-flows.md`](./auth-frontend-flows.md#1-context) — once a user is authenticated, they enter the store-module screens described here.

| Persona | Role | Their store-module surface |
|---|---|---|
| **Merchant** | `MERCHANT` | The full lifecycle: onboarding wizard, submission, approval, go-live, ACTIVE-state operations |
| **Employee** | `BUYER` | Read store data, edit store details, manage addresses (owner gates: invite/remove employees, submit, request go-live, edit bank details) |
| **Admin** | `ADMIN` | Two review queues (initial + go-live), review-a-store detail screen, approve/reject actions |

### The merchant onboarding lifecycle

This is the journey every merchant takes from their first "I want to sell" click to a live store visible to buyers. The store has a `status` field that drives every screen in the journey.

```
BUYER + no store
   ↓ creates store
DRAFT
   ↓ fills required fields, submits
PENDING_REVIEW
   ↓ admin approves                            ↓ admin rejects
APPROVED  ←──────────────── DRAFT + rejectionReason
   ↓ adds banner, story, address, 7 active products, requests go-live
PENDING_GO_LIVE
   ↓ admin approves                            ↓ admin rejects
ACTIVE  ←──────────────── APPROVED + rejectionReason
```

> **Two-gate review is deliberate.** First gate (`PENDING_REVIEW` → `APPROVED`) verifies brand legitimacy (real company, real bank details). Second gate (`PENDING_GO_LIVE` → `ACTIVE`) verifies launch readiness (products, story, banner, location). Each gate produces a distinct UX with its own waiting screen, rejection banner placement, and recovery flow.

### Auth-relevant prerequisites

The screens in this doc all assume the user is authenticated and has been routed in by the [post-login routing matrix](./auth-frontend-flows.md#3-post-login-routing-matrix). If the routing matrix sends a user to "Onboarding" or "Store setup wizard" or "Application under review", they land in the corresponding section here.

### `:storeId` is the store's ID, not slug

All merchant endpoints in the contract use `:storeId` — the store's ID. The frontend gets it from `GET /stores/me` (Step 7) or the `/auth/me` `store.id` field. The slug is for public-facing URLs only (consumer mobile app, not in scope here).

---

## 2. Merchant flows

### 2.1 Onboarding handoff (BUYER → "Start a store")

**Entry:** the post-login routing matrix has sent a `BUYER` with `store === null` to onboarding (see [auth flows §3.2](./auth-frontend-flows.md#32-first-time-user-onboarding) for the screen design).

**The hand-off action:** when the user clicks **"Start my store"**, fire `POST /stores` with the minimum payload (companyName + displayName, plus any optional fields collected in the onboarding form).

**API call:** `POST /stores` ([contract](./store-module-api.md#post-stores))

**Success path (201):**
- Store is created in `DRAFT` status
- The user's `role` stays `BUYER` — the upgrade only happens on first admin approval
- Push the new `store.id` into your client state, then navigate to the [setup wizard](#22-store-setup-wizard-draft)

**Error paths:**

| Response | UX |
|---|---|
| `409 "You already have a store"` | This means the routing matrix lied. Force-refetch `/auth/me` and re-route — the user already has a store and shouldn't be on the onboarding screen. |
| `409 "A store with that company name already exists"` | Inline error on companyName field: *"This company name is already taken. Try a different one."* |
| `409 "A store with that display name already exists"` | Inline error on displayName field: *"This brand name is already taken. Try a different one."* |
| `400` validation array | Map errors to fields (companyName 2–150, displayName 2–100, etc.) |

> **Naming clarity for the merchant.** SA businesses often have a registered legal name (CIPC) different from their trading name. Make the difference obvious in the form labels: *"Registered company name (from CIPC)"* and *"Brand name (what buyers will see)"*. Don't make this a guessing game.

---

### 2.2 Store setup wizard (DRAFT)

**Entry:** any of:
- Just created store (continuing from §2.1)
- Routing matrix sent the user here because `store.status === 'DRAFT'`
- Returning user navigated to "Edit store" from the dashboard

This is the largest single UX surface in the merchant onboarding journey. The merchant fills in everything required for first submission, plus the optional fields they want to add now.

#### Required-vs-optional matrix

The wizard groups fields by purpose. Mark required-for-submission fields clearly; the merchant should know what they have to do versus what they can defer.

| Section | Field | Required for submission? | Required for go-live? |
|---|---|---|---|
| **Brand identity** | `companyName` | yes | yes |
| | `displayName` | yes | yes |
| | `description` | yes | yes |
| | `story` | no | **yes** |
| | `logoUrl` | yes | yes |
| | `bannerUrl` | no | **yes** |
| | `websiteUrl` | no | no (stays optional through go-live) |
| **Contact** | `contactEmail` | yes | yes |
| | `contactPhone` | yes | yes |
| **Business registration** | `businessRegNo` | yes | yes |
| | `vatNumber` | no | no (only required for SA businesses with R1m+ annual turnover) |
| **Payout** | `bankName` | yes | yes |
| | `bankAccountNo` | yes | yes |
| | `bankBranchCode` | yes | yes |
| | `bankAccountType` | yes | yes |

11 required fields for first submission. **Address records and active products are NOT required for first submission** — those are go-live requirements (see §2.5).

#### Recommended layout

A **section-based single-page form** with sticky-side navigation (one `<a href="#section">` per group), not a multi-step wizard with forced linear progression. Reasons:

- The merchant might have all bank details ready but no logo, or vice versa. Linear forces an arbitrary order.
- Returning users editing a single field (e.g., updating `description`) shouldn't have to navigate through 4 steps.
- Each section can show its own required-fields-completion indicator at-a-glance.

Layout:

```
┌──────────────────────┬──────────────────────────────────────┐
│ Section nav (sticky) │ Active section                       │
│                      │                                      │
│ • Brand identity (3/4) │ ┌───────────────────────────────┐ │
│ • Contact (2/2) ✓     │ │ Brand identity                │ │
│ • Business reg (1/2)  │ │                               │ │
│ • Payout (4/4) ✓      │ │ Company name *                │ │
│ • Media               │ │ [_______________________]     │ │
│                      │ │                               │ │
│ Submit for review →   │ │ Display name *                │ │
│ (disabled until ready)│ │ [_______________________]     │ │
│                      │ │ ...                           │ │
└──────────────────────┴──────────────────────────────────────┘
```

The "Submit for review" CTA is sticky in the side nav. It is **disabled** until all 11 required fields are complete AND `store.status === 'DRAFT'`. Hover/tap shows the missing-field count.

#### Save behaviour — autosave per section

The contract is partial-update friendly (`PATCH /stores/:id` accepts any subset of fields). Use this:

- **Autosave on field blur** for short text fields (companyName, displayName, contactPhone, banking fields).
- **Autosave on debounced 800ms** for longer text fields (description, story).
- **Show a small "Saved" indicator** next to the section title for ~2 seconds after each successful save. Show "Saving…" while in flight. Show "Save failed — retry" with a retry button on error.
- **Never block the user with a confirmation dialog before letting them leave the page.** Autosave is doing the work.

This matches how creators are used to working on Instagram, Notion, etc. — no "Save changes?" prompts.

#### Per-field UX details worth getting right

**`companyName` and `displayName`:**
- Validation: 2–150 / 2–100 chars
- Uniqueness is checked server-side. On 409, surface the conflict immediately as an inline error: *"This name is already taken."*
- Consider warning the user that `displayName` becomes their public-facing brand name and the URL slug — once submitted, changing it later is allowed but might disorient buyers. A small helper text under the field: *"This is the name buyers will see. Choose carefully."*

**`description` (max 500):**
- Live character count below the textarea: `247 / 500`
- Helper text: *"A short summary of what your brand sells. Think Instagram bio."*

**`story` (max 2000):**
- Live character count
- Helper text: *"Tell buyers about your brand. Where you started, what you stand for, what makes you different. Optional now, required at go-live."*
- This is a YIIVA-specific field — the platform leans into brand storytelling. Don't make it feel like a chore.

**Image fields (`logoUrl`, `bannerUrl`):** see [§7.3 Image upload pattern](#73-image-upload--cloud-storage-first-patch-the-url-second). The wizard shows them as drop-zones with preview, not URL text inputs.

**Bank details:** see [§8 UX patterns — Bank details masking](#bank-details-masking-and-confirm-on-edit) for how to handle account number masking, confirm-on-edit, and the security tone.

**`websiteUrl` (optional throughout):**
- Helper text: *"Optional. Many SA brands sell only through YIIVA and Instagram — no website needed."*
- Validation: valid URL format if provided. If user types `boldstreetwear.co.za` (no protocol), prepend `https://` automatically before sending.

**`businessRegNo`:**
- Helper text: *"Your CIPC registration number. We use this to verify your business is legitimate."*
- No validation pattern enforced at backend — accept any string. Frontend can soft-warn if the format doesn't look like a typical CIPC number (e.g. `YYYY/NNNNNN/NN`) but don't block submission.

**`vatNumber` (optional):**
- Helper text: *"Optional. Only required if your business is VAT-registered (R1 million+ annual turnover)."*

#### "Discard store" exit path

A small text link at the bottom of the wizard: *"Cancel and remove this application"* — this would call... actually, **there is no `DELETE /stores/:id` endpoint**. A merchant who wants to bail can either let the DRAFT sit (no harm) or contact support. Don't promise a delete action that doesn't exist. Just don't show the option.

---

### 2.3 Submission and validation feedback

**Trigger:** the merchant clicks "Submit for review" in the wizard's sticky side nav.

**Pre-submit confirmation:** show a modal:

```
Title:  Submit your store for review?
Body:   Once you submit, you won't be able to edit your store
        until the review is complete. Reviews usually take
        2–3 business days.
        Make sure your details are accurate — especially your
        bank account info (we use it to pay you out).
Action: [ Cancel ]   [ Submit for review ]
```

The "wait until review complete" framing is important — `PATCH /stores/:id` is blocked while in `PENDING_REVIEW`. Don't surprise the merchant with this constraint.

**API call:** `POST /stores/:id/submit` ([contract](./store-module-api.md#post-storesidsubmit))

**Success path (200):**
- Store is now `PENDING_REVIEW`
- Refetch `/auth/me` to update the routing-matrix-relevant store data
- Navigate to the [under-review status page](#24-first-review-waiting-state-and-rejection-recovery)

**Error path that matters most: `400 "The following fields are required before submission: <list>"`**

This is the **missing-fields recovery loop**. The backend returns *every* missing field in one error so the frontend can fix everything in one pass. Frontend should:

1. **Parse the comma-separated list** from the error message (or — better — have backend return a structured `{ missing: string[] }` field; flag this as a backend follow-up if it doesn't).
2. **Highlight each missing field in the wizard** with a red border + inline error: *"Required for submission."*
3. **Scroll to the first missing field** automatically.
4. **Show a top-of-page banner** summarising: *"X required fields are still missing. We've highlighted them below."*
5. **Don't navigate away from the wizard.** The merchant fixes inline and clicks Submit again.

> **Backend follow-up suggestion (not blocking):** the missing-fields error is currently a single string formatted as `"The following fields are required before submission: description, logoUrl, bankName"`. A structured array (`{ statusCode: 400, missing: ["description", "logoUrl", "bankName"], message: "..." }`) would be cleaner for the frontend to parse. Worth flagging when we hand off.

**Other error paths:**

| Response | UX |
|---|---|
| `403 "You do not have permission to submit this store"` | Force-refetch `/auth/me`. The user is no longer the owner somehow. Re-route per matrix. |
| `404 "Store not found"` | Same as above. |
| `400 "Store has already been submitted for review"` | The user got here twice. Refetch `/auth/me` and route to the under-review status page. |
| `400 "Store is already active"` / `"Store cannot be submitted in its current status"` | Refetch and re-route. The wizard shouldn't have shown the submit button. |

---

### 2.4 First-review waiting state and rejection recovery

This section covers two related states: `PENDING_REVIEW` (waiting for admin) and `DRAFT + rejectionReason` (rejected, awaiting merchant changes).

#### `PENDING_REVIEW` — under review

**What the merchant sees:**

```
┌───────────────────────────────────────────────────┐
│                                                   │
│              [ illustration / icon ]              │
│                                                   │
│       Your store is under review                  │
│                                                   │
│   We're checking that everything is in order.     │
│   Reviews usually take 2–3 business days.         │
│   We'll email you as soon as we have an answer.   │
│                                                   │
│   Submitted: 2 days ago                           │
│   Submitted at: 6 May 2026, 14:23                 │
│                                                   │
│   [ View what you submitted (read-only) ]         │
│                                                   │
└───────────────────────────────────────────────────┘
```

Key UX rules for this screen:

- **Read-only.** The wizard fields are visible (so the merchant can review what they sent) but not editable. The contract blocks `PATCH` in `PENDING_REVIEW` (returns 400) — disable the inputs to prevent the merchant from typing into a frozen form and being surprised by the error.
- **Reduce anxiety.** The "2–3 business days" line sets expectation. Without it, merchants will repeatedly refresh `/auth/me`.
- **No "Cancel submission" action.** The backend has no endpoint to undo a submission — a submitted store stays in `PENDING_REVIEW` until an admin acts on it.
- **Show submission timestamp** prominently — relative ("2 days ago") plus absolute ("6 May 2026, 14:23") so the merchant doesn't have to do mental math.

**Polling / live updates:**

Don't poll `/auth/me` aggressively (the user might leave this tab open all day). Refetch `/auth/me` on:
- Tab focus (user comes back to the tab) — once
- Pull-to-refresh / explicit "Refresh status" button
- After ~2 minutes of continuous focus

When the status flips to `APPROVED` or `DRAFT + rejectionReason`, transition the screen smoothly.

#### `DRAFT + rejectionReason` — rejection recovery

**What the merchant sees:**

The wizard screen returns, but with a **prominent rejection banner** at the top:

```
┌───────────────────────────────────────────────────┐
│ ⚠️ Your application needs changes                 │
│                                                   │
│ Why we couldn't approve it yet:                   │
│ "{rejectionReason}"                               │
│                                                   │
│ Make the changes below and resubmit.              │
└───────────────────────────────────────────────────┘
```

Key UX rules:

- **Banner is persistent until the merchant edits the store.** The contract specifies that `rejectionReason` auto-clears on any DRAFT edit. So as soon as the merchant types into ANY field and the autosave fires, the banner disappears. Match that — the banner should react to the local store state, not be manually dismissed.
- **Display the full `rejectionReason` text verbatim.** The admin wrote it specifically for this merchant. Don't truncate or paraphrase.
- **Tone in the surrounding copy is constructive.** "Application needs changes," not "Application denied." YIIVA wants this merchant to succeed.
- **Re-enable the wizard.** The merchant can edit any field. The submit button should be available once required fields are still complete.
- **No file:emoji in production.** I've used `⚠️` above for visual punch in this doc; in real implementation use an SVG icon, not an emoji.

**Edge: the merchant edits a field and the banner disappears, then they navigate away and come back.** Now `rejectionReason` is null in the database. They've lost the admin's feedback. Suggest: when first showing the banner, **also persist a copy in localStorage keyed by store.id**. If the user wants to re-read the original rejection after editing, they can click a small text link *"View original feedback"* that pulls from localStorage. This is a small kindness, not strictly required.

---

### 2.5 Approved — preparing for go-live

**Entry:** routing matrix has sent a `MERCHANT` with `store.status === 'APPROVED'` here.

This is **the longest phase of the merchant journey**. Approved merchants spend days or weeks adding products, refining their branding, and building toward go-live readiness. The dashboard's job is to give them clear next steps.

> **Two distinct sub-states to handle:**
> - `APPROVED` with `rejectionReason: null` — fresh approval, never tried go-live
> - `APPROVED` with `rejectionReason: <text>` — go-live was requested and rejected (see §2.7)
>
> The dashboard layout is the same. The rejection banner only differs.

#### Layout

A merchant dashboard with a prominent **go-live readiness checklist** front and centre:

```
┌─────────────────────────────────────────────────────────┐
│  Get ready to go live                                   │
│                                                         │
│  Complete these before you can launch:                  │
│                                                         │
│  ✓ Brand basics (logo, description, contact)            │
│  ✓ Bank details                                         │
│  ✓ Business registration                                │
│  ☐ Banner image                          [Add banner]  │
│  ☐ Brand story                          [Write story]  │
│  ☐ At least one location                [Add location] │
│  ☐ At least 7 active products (3 / 7)   [Add products] │
│                                                         │
│  [ Request go-live ]  (disabled until all complete)     │
└─────────────────────────────────────────────────────────┘
```

Below the checklist: the rest of the merchant dashboard — product list (defer to product flows), order list (defer to order flows when written), store settings, team management.

#### Each checklist item

Item 1–3 (brand basics, bank, business reg) are derived from `GET /stores/me`. If complete, show ✓ + section name. If a sub-field is missing, show ☐ + a "Complete now" link that scrolls to the relevant section in the store-edit wizard.

Item 4–5 (banner, story) are individual fields. ☐ + "Add banner" / "Write story" CTA → opens an inline modal or scrolls to the store-edit wizard's media/story section.

Item 6 (location) — uses `addresses.length`. ☐ + "Add location" CTA → opens the [add-address modal](#31-add-an-address).

Item 7 (active products) — uses `_count.products` from `GET /stores/me` (which counts ALL products including drafts) **OR** a separate count of active products. **Important: `_count.products` from `/stores/me` includes drafts.** The 7-active-product check is enforced server-side in `requestGoLive`.

> **Why the gap matters for the merchant:** if the checklist reads from the unfiltered count, a merchant with 5 active and 7 draft products sees `12 / 7 ✓` and assumes they're past the gate — then their `request-go-live` call fails with `"at least 7 active products (currently has 5)"`. They've been told they're ready when they aren't. The checklist must use the **active-only** count, not the total.

For the checklist UI, show progress: `3 / 7` — but this requires either:

- (a) a backend tweak to `/stores/me` to also include `_count.activeProducts: number`, or
- (b) a separate call to `GET /stores/:storeId/products?status=ACTIVE&limit=1` and reading the `meta.total` field.

Option (b) is fine for v1 — flag (a) as a backend nice-to-have.

#### When all 7 items are complete, the "Request go-live" button activates

Don't auto-fire the request — the merchant should click. Some merchants will want to time their launch (marketing push, social posts, etc.) and shouldn't have it triggered automatically.

#### Editing in APPROVED works normally

Unlike `PENDING_REVIEW`, the `APPROVED` state allows full editing. The merchant can update any store field via `PATCH`. Reflect this in the UI — the edit-store wizard is fully functional alongside the readiness checklist.

---

### 2.6 Request go-live

**Trigger:** the merchant clicks "Request go-live" in the readiness checklist.

**Pre-submit confirmation modal:**

```
Title:  Request to go live?
Body:   Once you submit, you won't be able to edit your store
        until the review is complete. Final reviews usually take
        2–3 business days.
        We'll email you as soon as we have an answer.
Action: [ Cancel ]   [ Request go-live ]
```

> Same edit-is-blocked rule as first submission: per the [contract](./store-module-api.md#patch-storesid), `PATCH /stores/:id` rejects edits in `PENDING_REVIEW`, `PENDING_GO_LIVE`, `SUSPENDED`, and `CLOSED`. Make the "no edits during review" constraint explicit in the modal so the merchant doesn't try to edit and hit a confusing 400.

**API call:** `POST /stores/:id/request-go-live` ([contract](./store-module-api.md#post-storesidrequest-go-live))

**Success path (200):**
- Store is now `PENDING_GO_LIVE`
- Any prior `rejectionReason` from a previous go-live attempt is cleared (backend does this)
- Refetch `/auth/me`
- Navigate to the [final-review status page](#27-final-review-waiting-state-and-go-live-rejection-recovery)

**Error path that matters most: `400 "Cannot request go-live. Missing requirements: <list>"`**

If the merchant somehow clicked the button while requirements were unmet (race condition, stale local state, or backend re-evaluating server-side), the backend lists everything missing in one error.

UX:
- Stay on the dashboard
- Show the missing items inline in the checklist (the checklist UI was already there — re-render with the missing-items pattern)
- Banner at top: *"A few things still need attention before you can go live."*
- Refetch `/stores/me` to sync local state with the server's view

**Other error paths:**

| Response | UX |
|---|---|
| `403 "You do not have permission to request go-live..."` | Refetch `/auth/me` and reroute. |
| `404 "Store not found"` | Refetch and reroute. |
| `400 "Your store must be approved before requesting to go live..."` | Status-mismatch — backend says it's not `APPROVED`. Refetch and reroute (matrix will handle it). |
| `400 "Your store is already in the go-live review queue."` | Refetch and reroute to the final-review status page. |
| `400 "Your store is already live."` | Refetch and reroute to the live store dashboard. |

---

### 2.7 Final-review waiting state and go-live rejection recovery

#### `PENDING_GO_LIVE` — final review

Almost identical to the [first-review waiting state (§2.4)](#24-first-review-waiting-state-and-rejection-recovery), but the copy reflects this is the *final* gate:

```
┌───────────────────────────────────────────────────┐
│              [ illustration / icon ]              │
│                                                   │
│      Your store is in final review                │
│                                                   │
│   We're checking that your store is ready to be   │
│   seen by buyers. Reviews usually take 2–3        │
│   business days. As soon as we approve, your      │
│   store will go live.                             │
│                                                   │
│   Requested: 1 day ago                            │
│   Requested at: 7 May 2026, 09:15                 │
│                                                   │
│   [ View what you submitted (read-only) ]         │
└───────────────────────────────────────────────────┘
```

Same rules as §2.4: read-only, no cancel action, refetch on focus / explicit refresh.

#### `APPROVED + rejectionReason` — go-live rejection recovery

The merchant returns to the [APPROVED dashboard (§2.5)](#25-approved--preparing-for-go-live), but with a rejection banner:

```
┌───────────────────────────────────────────────────┐
│ ⚠️ Your store wasn't quite ready to go live       │
│                                                   │
│ Feedback from our team:                           │
│ "{rejectionReason}"                               │
│                                                   │
│ Make changes and request go-live again when ready.│
└───────────────────────────────────────────────────┘
```

> **Critical UX rule** (different from first-review rejection!): in `APPROVED`, **edits do NOT auto-clear the `rejectionReason`**. The reason is only cleared when the merchant calls `request-go-live` again (which moves the store to `PENDING_GO_LIVE` and clears the field). See [contract](./store-module-api.md#the-rejectionreason-field) and [§7.2](#72-rejectionreason-banner-persistence).
>
> The merchant edits their banner, the autosave fires, the field updates — **but the rejection banner stays visible**. They might be confused: *"I fixed the banner, why is the warning still there?"*
>
> Surface this directly in the banner copy:
>
> *"This message will go away when you request go-live again."*

This sets expectation. The user knows the path forward: edit → request go-live → banner disappears, status flips to `PENDING_GO_LIVE`.

---

### 2.8 ACTIVE — live store

**Entry:** routing matrix has sent a `MERCHANT` with `store.status === 'ACTIVE'` here.

> **This section is intentionally thin.** The bulk of "what an ACTIVE merchant does" — manage products, fulfil orders, view analytics — lives in the product and order modules' frontend-flows docs (forthcoming). This section covers only the **store-module concerns** for an ACTIVE merchant.

#### One-time go-live celebration

The first time a merchant lands on the dashboard after their store transitions to `ACTIVE`, show a one-time confirmation toast or modal:

```
Title:  Your store is live
Body:   Buyers can now find {displayName} on YIIVA.
        Share your store URL: {PUBLIC_STORE_URL_BASE}/{slug}
        [ Copy link ]   [ Got it ]
```

> The exact public-URL pattern depends on whether YIIVA serves a buyer-facing web experience or only the consumer mobile app (where the link would be a deep link). Confirm with the team and pull the base URL from frontend config (e.g. `NEXT_PUBLIC_PUBLIC_STORE_URL_BASE`). See [§8 Configuration values used in copy](#configuration-values-used-in-copy).

Track that this has been seen (e.g. localStorage key `seen_go_live_celebration_${store.id}`) so it doesn't show on every login.

#### Day-to-day store-module surface for ACTIVE merchants

- **Edit store details** — `PATCH /stores/:id` works normally (DRAFT, APPROVED, ACTIVE all allow edits)
- **Manage addresses** — see [§3](#3-address-management)
- **Manage employees (owner only)** — see [§4](#4-employee-management-owner-side)
- **Public store URL** — show prominently with a "Copy link" button (use the store slug)

Everything else (products, orders, analytics) is out of scope here.

---

### 2.9 SUSPENDED / CLOSED — read-only states

> **Reachability note:** as of writing, no admin endpoint transitions a store into `SUSPENDED` or `CLOSED`. These states are reserved for a future moderation feature. The screens are still worth designing for completeness, but you cannot QA them end-to-end against the current backend.

#### `SUSPENDED`

```
┌───────────────────────────────────────────────────┐
│ Your store is suspended                           │
│                                                   │
│ This store has been temporarily suspended by      │
│ YIIVA. While suspended, your store isn't visible  │
│ to buyers and you can't make changes.             │
│                                                   │
│ If you think this is a mistake or you want to     │
│ resolve the issue, please contact support.        │
│                                                   │
│ [ Contact support ]                               │
└───────────────────────────────────────────────────┘
```

- Read-only across the entire dashboard
- Disable all action buttons (edit store, add product, manage employees, etc.)
- Show the support contact prominently

#### `CLOSED`

Similar layout but framed as final:

```
This store has been closed. If you'd like to reopen
it or start fresh, please contact support.
```

---

## 3. Address management

Addresses are managed inline in the merchant dashboard's **Locations** section (or as part of the go-live checklist for new merchants). They appear on the public store profile as Instagram-style location tags.

> **Permissions:** owner OR active accepted employee. Edit/Delete/Add are all permitted for both. Validated by the backend — see [contract](./store-module-api.md#post-storesstoreidaddresses).

### 3.1 Add an address

**Entry:** "Add location" CTA in:
- Go-live checklist (§2.5) — if no addresses yet
- Locations section of merchant dashboard

**What the user sees:** a modal or inline form:

```
Add a location

Street number *           Building or complex
[__________]              [______________________]

Street name *
[___________________________________]

City *                    Postal code *
[_______________]         [_______]

[ Cancel ]   [ Save location ]
```

**Validation timing:**
- All required fields: on submit
- Postal code format: on blur (warn if not 4-digit numeric, but allow non-standard since the backend just enforces 4–10 chars)

**API call:** `POST /stores/:storeId/addresses` ([contract](./store-module-api.md#post-storesstoreidaddresses))

**Success path (201):**
- Push the new address into local state
- Close the modal
- Show a brief toast: *"Location added"*

**Error paths:**

| Response | UX |
|---|---|
| `403 "You do not have permission to manage this store"` | Refetch `/auth/me`, reroute, show a banner explaining the user lost permissions. |
| `400 "Cannot add addresses to a closed store"` | The store transitioned to `CLOSED` mid-session. Refetch and reroute. |
| `400` validation array | Inline field errors (street number too long, city too short, etc.). |

---

### 3.2 Edit an address

**Entry:** "Edit" button on an address card in the Locations section.

**What the user sees:** the same modal as Add, pre-populated. Same fields, all optional in the API but the modal still treats required fields as required.

**API call:** `PATCH /stores/:storeId/addresses/:addressId` ([contract](./store-module-api.md#patch-storesstoreidaddressesaddressid))

**Success path (200):**
- Update local state
- Close modal
- Brief toast: *"Location updated"*

**Error paths:**

| Response | UX |
|---|---|
| `404 "Address not found"` | Address was deleted in another tab/device. Refetch addresses, close modal, show a toast: *"This location no longer exists."* |
| `403` | Same recovery as Add. |
| `400` | Inline field errors. |

---

### 3.3 Delete an address

**Entry:** "Delete" button on an address card.

**Confirmation modal:**

```
Title:  Remove this location?
Body:   {streetNumber} {streetName}, {city}
        This won't be visible on your store profile anymore.
Action: [ Cancel ]   [ Remove ]
```

**API call:** `DELETE /stores/:storeId/addresses/:addressId` ([contract](./store-module-api.md#delete-storesstoreidaddressesaddressid))

**Success path (200):**
- Remove from local state
- Close confirmation
- Brief toast: *"Location removed"*

**Error paths:**

| Response | UX |
|---|---|
| `404 "Address not found"` | Already deleted elsewhere. Refetch and quietly remove from local state. |
| `400 "Cannot delete the last address. Approved stores must have at least one location."` | This is the **last-address rule** — `APPROVED`, `PENDING_GO_LIVE`, and `ACTIVE` stores must keep at least one address. UX:<br>**Replace the confirmation modal with an explanation:** *"You can't remove your last location. Approved stores need at least one. Add another location first, or close this dialog."* with a single CTA: *"Add another location"* (which opens the Add Address modal). |
| `403` | Same recovery as Add. |

---

## 4. Employee management (owner-side)

> **Visibility:** the team list (§4.2) is visible to **owner OR active accepted employee**. All other actions in this section (invite, resend, deactivate, reactivate, remove) are **owner-only**.

This UI lives in a "Team" section of the merchant dashboard. It's surfaced to the merchant after they reach `APPROVED` (since invites are blocked before then per the [contract](./store-module-api.md#post-storesstoreidemployees)).

### 4.1 Send invite

**Entry:** "Invite teammate" button in the Team section.

**What the user sees:** a small modal:

```
Invite a teammate

We'll send them an email with a link to join your team.
They'll need to sign up or log in to YIIVA to accept.

Email *
[___________________________________]

[ Cancel ]   [ Send invite ]
```

**Validation timing:** on blur for email format.

**API call:** `POST /stores/:storeId/employees` ([contract](./store-module-api.md#post-storesstoreidemployees))

**Success path (201):**
- Push the new pending invite into the local team list (it appears with `acceptedAt: null`, `user: null`)
- Close modal
- Toast: *"Invite sent to {email}"*

**Error paths:**

| Response | UX |
|---|---|
| `403 "Only the store owner can invite employees"` | Refetch `/auth/me` — current user lost owner status somehow. Reroute. |
| `400 "You can only invite employees once your store has been approved"` | Refetch and reroute — the store regressed to a pre-APPROVED state. |
| `409 "This person is already an employee of your store"` | Inline error on email field: *"They're already on your team."* |
| `409 "An invite has already been sent to this email..."` | Inline error: *"You've already sent an invite to this email. Use 'Resend' on the team list if it didn't arrive."* (Show a small inline link: *"Find them in your team list →"* that closes the modal and scrolls to that pending invite row.) |
| `400` validation | *"That doesn't look like a valid email."* |

---

### 4.2 View team list

**Entry:** the Team section of the merchant dashboard. **Visible to owner AND active accepted employees.**

**What the user sees:** a list with rows for each employee + pending invite, ordered oldest first (matches backend default).

```
Team                                           [ + Invite teammate ]

┌─────────────────────────────────────────────────────────────┐
│ Thabo Mthembu    EMP001    Active     [Deactivate] [Remove] │
│ thabo@gmail.com  Joined 20 March 2026                       │
├─────────────────────────────────────────────────────────────┤
│ Lerato (pending) (no employee number)  [Resend] [Cancel]    │
│ lerato@gmail.com  Invited 5 May 2026 — expires 12 May 2026  │
├─────────────────────────────────────────────────────────────┤
│ Sipho Dlamini    EMP002    Deactivated  [Reactivate] [Remove]│
│ sipho@gmail.com  Joined 2 February 2026                     │
└─────────────────────────────────────────────────────────────┘
```

**Three visual states for each row** (driven by `acceptedAt` + `isActive`):

| `acceptedAt` | `isActive` | Visual treatment | Action buttons (owner only) |
|---|---|---|---|
| `null` | `true` | "Pending" pill, italic email, expiry date shown | Resend, Cancel (= Remove) |
| ISO date | `true` | Standard row, "Active" pill | Deactivate, Remove |
| ISO date | `false` | Greyed-out row, "Deactivated" pill | Reactivate, Remove |

**Active employees only see action buttons that they can actually perform.** Per the contract:
- An active employee can view the team list but cannot perform any team-management action.
- For non-owners, hide the action buttons entirely. Don't show disabled buttons — that's confusing.

**API call (initial load):** `GET /stores/:storeId/employees` ([contract](./store-module-api.md#get-storesstoreidemployees))

**Empty state:** if the team list is empty (only the owner exists, no invites sent), show a friendly empty state:

```
        [ illustration ]

   Build your team

   Invite teammates to help you manage your store —
   add products, edit your story, respond to orders.

   [ Invite teammate ]
```

**Error path:**

| Response | UX |
|---|---|
| `403 "You do not have permission to manage this store"` | Refetch `/auth/me`. The user lost access. Reroute. |

---

### 4.3 Resend invite

**Entry:** "Resend" button on a pending-invite row.

**Optional confirmation:** for a single-tap action this isn't strictly needed, but if you have one, keep it brief:

```
Resend invite to {email}? We'll generate a new link
that expires in 7 days. The previous link will stop working.
[ Cancel ]   [ Resend ]
```

**API call:** `POST /stores/:storeId/employees/:employeeId/resend` ([contract](./store-module-api.md#post-storesstoreidemployeesemployeeidresend))

**Success path (200):**
- Update the row's "expires" date to 7 days from now
- Toast: *"Invite resent to {email}"*

**Error paths:**

| Response | UX |
|---|---|
| `403` | Same as Invite. |
| `404 "Employee not found"` | The record was deleted elsewhere. Refetch the team list. |
| `400 "This invitation has already been accepted"` | The recipient just accepted in another tab. Refetch — the row will now show as "Active". |

---

### 4.4 Deactivate / reactivate

**Entry:** "Deactivate" / "Reactivate" button on a row.

**Confirmation for Deactivate:**

```
Title:  Deactivate {firstName} {lastName}?
Body:   They'll lose access to your store immediately. You can
        reactivate them later if you change your mind.
Action: [ Cancel ]   [ Deactivate ]
```

**No confirmation needed for Reactivate** — it's a low-stakes restoration.

**API calls:**
- `POST /stores/:storeId/employees/:employeeId/deactivate` ([contract](./store-module-api.md#post-storesstoreidemployeesemployeeiddeactivate))
- `POST /stores/:storeId/employees/:employeeId/reactivate` ([contract](./store-module-api.md#post-storesstoreidemployeesemployeeidreactivate))

**Success path (200):**
- Update `isActive` in local state
- Re-render the row with the new visual treatment
- Toast: *"{firstName} deactivated"* / *"{firstName} reactivated"*

**Error paths:**

| Response | UX |
|---|---|
| `403`, `404` | Same recovery patterns as elsewhere — refetch, reroute or remove from local state. |
| `400 "Employee is already deactivated"` / `"Employee is already active"` | Refetch the team list — local state was stale. |

---

### 4.5 Remove (hard delete)

**Entry:** "Remove" button on any row.

**Confirmation modal:**

```
Title:  Remove {firstName} {lastName} from your team?
Body:   This permanently deletes their team record. If they had
        access, they'll lose it immediately.
        If you might want to restore access later, deactivate
        them instead.
Action: [ Deactivate instead ]  [ Cancel ]  [ Remove ]
```

The "Deactivate instead" tertiary action gives the owner the safer option without forcing them to close and reopen the dialog.

**API call:** `DELETE /stores/:storeId/employees/:employeeId` ([contract](./store-module-api.md#delete-storesstoreidemployeesemployeeid))

**Success path (200):**
- Remove the row from local state
- Toast: *"{firstName} removed from your team"*

**Error paths:** standard (`403`, `404`).

> **Edge — removing a pending invite:** the "Cancel" button on a pending-invite row should also call `DELETE` (it's the same operation as Remove for accepted employees). Don't build a separate "cancel invite" endpoint — there isn't one.

---

## 5. Employee invite — recipient screens

The recipient-side flow (validate token → accept invite) is documented in [auth flows §2.8 and §2.9](./auth-frontend-flows.md#28-invite-landing--public-pre-auth). Read those first.

This section covers what happens **after** the recipient accepts the invite — entering the store dashboard for the first time.

### Post-acceptance landing

After `POST /employees/invites/accept` returns 200 (which includes `{ store: { id, displayName, slug } }`), the recipient is now an active employee. UX flow:

1. Show a brief celebration state: *"Welcome to {store.displayName}!"*
2. **Persist `store.id` in localStorage** — see [§7.5](#75-employee-dashboard-discovery-limitation) for why this is critical (`/auth/me` doesn't tell employees their store).
3. Navigate to the merchant dashboard for that `store.id`.

### Returning employee (next session)

When an employee logs in on a subsequent session:
- `/auth/me` returns `role: BUYER`, `store: null` (their owned store, which they don't have)
- The frontend cannot determine from `/auth/me` alone that this user is an employee
- **Read `store.id` from localStorage** (persisted at acceptance time)
- If found: navigate to the dashboard for that store and call `GET /stores/:storeId/employees` to verify the user is still an active employee. If the call returns 403, clear the localStorage entry and route per the buyer matrix (which would send them to onboarding).
- If not found: route per the buyer matrix.

> This is a workaround until backend ships an `/auth/me/employments` (or equivalent) endpoint that lists store memberships. Track the workaround in your codebase with a TODO comment so it's easy to clean up later.

---

## 6. Admin flows

> **Audience:** YIIVA staff. Admins are the gatekeepers of marketplace quality — both review queues are part of their daily workflow.

### 6.1 Initial review queue

**Entry:** routing matrix for `ADMIN` users, OR navigation from the admin home.

**What the admin sees:** a list of stores in `PENDING_REVIEW`, ordered oldest first (FIFO):

```
First-review queue                                     47 pending

[ Sort: Oldest first ▾ ]                              [ Search ... (future) ]

┌─────────────────────────────────────────────────────────────────┐
│ [logo] BOLD Streetwear                                          │
│        Khanyi Mthamo · khanyi@gmail.com                         │
│        Submitted 3 days ago · 6 May 2026, 14:23                 │
│                                                       [ Review ]│
├─────────────────────────────────────────────────────────────────┤
│ [logo] Lerato Skincare                                          │
│        Lerato Mokoena · lerato@example.co.za                    │
│        Submitted 2 days ago · 7 May 2026, 09:45                 │
│                                                       [ Review ]│
└─────────────────────────────────────────────────────────────────┘

[ ← Previous ]   Page 1 of 3   [ Next → ]
```

**Each row shows:**
- Store logo thumbnail (`logoUrl`) — if no logo, show a placeholder; this is the merchant's first impression so the admin should be able to scan logos quickly
- Display name (the brand name)
- Owner first + last name + email — the admin might recognize repeat applicants
- "Submitted X ago" relative + absolute timestamp
- "Review" button → navigates to the [detail screen](#62-review-a-store-detail-screen)

**Sort control:**
- Default: oldest first (FIFO — work the queue in order)
- Toggle: newest first (admin who wants to see what just came in)

**API call:** `GET /stores/admin/pending` with `page`, `limit`, `sortOrder` ([contract](./store-module-api.md#get-storesadminpending))

**Empty state:**

```
        [ illustration ]

   You're all caught up

   No store applications waiting for review.
   Check the go-live queue for any final reviews →
```

A direct link to the go-live queue keeps the admin productive.

**Pagination:** standard previous/next + page counter. Default limit 20, max 50.

> **Live updates:** new submissions land continuously. Don't poll aggressively — refetch on tab focus and provide a manual "Refresh" button. A small unobtrusive indicator if new items have arrived since the page loaded would be nice but not required for v1.

---

### 6.2 Review-a-store detail screen

**Entry:** "Review" button from the queue.

**Layout:** a full-page detail view with all submitted information, organised so the admin can scan and decide quickly. Goal: enable a thorough review in 3–5 minutes.

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back to queue                          Review · BOLD Streetwear│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ [ Brand identity ]                                              │
│ Display name:    BOLD Streetwear                                │
│ Slug:            bold-streetwear                                │
│ Company name:    Khanyi Creative Ventures (Pty) Ltd             │
│ Description:     Premium streetwear inspired by JHB urban culture│
│ Story:           "We started in a garage in Soweto in 2019..."  │
│ Logo:            [thumbnail with link to full-size]             │
│ Banner:          [thumbnail or "not yet uploaded"]              │
│ Website:         https://boldstreetwear.co.za                   │
│                                                                 │
│ [ Owner ]                                                       │
│ Khanyi Mthamo                                                   │
│ khanyi@gmail.com · +27 63 448 9940                              │
│ Account created: 1 March 2026                                   │
│                                                                 │
│ [ Contact (the brand's public-facing) ]                         │
│ Email: hello@boldstreetwear.co.za                               │
│ Phone: +27 63 448 9940                                          │
│                                                                 │
│ [ Business registration ]                                       │
│ CIPC registration: 2024/123456/07                               │
│ VAT: not provided                                               │
│                                                                 │
│ [ Bank / payout ]                                               │
│ Bank: FNB                                                       │
│ Account: 6281 **** **** 5678  ← masked, click to reveal         │
│ Branch: 250655                                                  │
│ Type: Cheque                                                    │
│                                                                 │
│ [ Submission timeline ]                                         │
│ Submitted: 6 May 2026, 14:23 (3 days ago)                       │
│ Previously rejected: never                                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│              [ Reject application ]    [ Approve ]              │
└─────────────────────────────────────────────────────────────────┘
```

**Key UX rules:**
- **Bank account number is masked by default.** Show `last 4`. The admin can click to reveal — log this client-side for audit if you have any tracking. Even admins shouldn't have account numbers in casual view.
- **All fields are read-only.** Admins cannot edit the merchant's data.
- **Logo and banner thumbnails are clickable** — open in a lightbox for full-size verification.
- **Show "Previously rejected" history** when the merchant has been rejected before. Use a small *"View previous feedback"* link that reveals the previous `rejectionReason` (if you can — currently the backend overwrites this on each cycle, so you may not have it; flag as a backend follow-up if review history matters).
- **The two action buttons (Approve / Reject) are the only CTAs.** Place them prominently at the bottom of the screen, sticky if the page is long.

**API call (page load):** call `GET /stores/admin/pending?page=...` is the queue endpoint; for the detail screen, you can either:
- (a) Pass the full store object via state from the queue (cheapest),
- (b) Add a backend endpoint `GET /stores/admin/:id` for fresh data (not yet exists — flag if needed)

For v1, option (a) is fine. The store object is small and the queue already returns everything.

> **Limitation of (a):** direct-URL access (page refresh, sharing the detail-page URL with another admin) won't have queue state and will need to fall back to navigating the queue and finding the store. Acceptable for v1 — admins typically work from the queue. If sharing review URLs becomes useful internally, flag a backend follow-up for `GET /stores/admin/:id`.

---

### 6.3 Approve a store

**Entry:** "Approve" button on the detail screen.

**Confirmation modal:**

```
Title:  Approve {displayName}?
Body:   Approving will:
        • Upgrade {firstName}'s account to MERCHANT
        • Move the store to APPROVED status
        • Send {firstName} an email with next steps
        The store won't be visible to buyers yet — that's the
        next gate (go-live review).

[ Optional: Add a personal welcome note ]
[_____________________________________]

Action: [ Cancel ]   [ Approve ]
```

The optional welcome note maps to the contract's `reason` field on `APPROVE` (which is allowed but not required). Useful for warm onboarding — *"Love the brand. Welcome to YIIVA!"*

**API call:** `POST /stores/:id/review` with `{ decision: "APPROVE", reason?: string }` ([contract](./store-module-api.md#post-storesidreview))

**Success path (200):**
- Show a celebration toast: *"Approved {displayName}. {firstName} will receive an email."*
- Navigate back to the queue (which will no longer include this store)
- The queue counter should decrement

**Error paths:**

| Response | UX |
|---|---|
| `404 "Store not found"` | The store was deleted somehow. Toast: *"This store no longer exists."* Navigate back to queue. |
| `400 "Only stores in PENDING_REVIEW status can be reviewed"` | The store status changed (another admin acted on it, or the merchant did something). Toast: *"This store has already been reviewed."* Refetch the queue. |

---

### 6.4 Reject a store (with copy guidance)

**Entry:** "Reject application" button on the detail screen.

**Reject dialog:**

```
Title:  Reject {displayName}'s application

The merchant will be notified by email and can edit and
resubmit. Be specific so they know what to fix.

Reason (visible to the merchant) *
[_______________________________________________________]
[_______________________________________________________]
[_______________________________________________________]

Min 10 characters · 0 / 500 typed

[ Templates ▾ ]                  [ Cancel ]   [ Reject ]
```

**Templates dropdown** (frontend-side helpers, not stored anywhere):

The admin can pick a template to start from, then customise:

| Template label | Pre-filled text |
|---|---|
| Logo quality | "The logo image quality is too low. Please upload a higher resolution version (at least 500×500 pixels) so it looks sharp on buyer screens." |
| Banking details | "Your bank account details couldn't be verified. Please double-check your account number and branch code, then resubmit." |
| Business registration | "We couldn't find your CIPC registration number. Please check it for typos and resubmit." |
| Description too brief | "Your description is too brief. Tell buyers more about what you sell — a few sentences about your products and what makes your brand special." |

After picking a template, the admin can edit the text. The 10-character minimum is enforced by the backend; the 500-char soft cap is a UX choice (longer reasons may overwhelm the merchant; rare cases can copy-paste).

**Validation:**
- Reason ≥ 10 characters: enforced by backend, also enforce client-side. Disable the "Reject" button until ≥10.
- Live character count below the textarea.

**API call:** `POST /stores/:id/review` with `{ decision: "REJECT", reason: string }` ([contract](./store-module-api.md#post-storesidreview))

**Success path (200):**
- Toast: *"Rejected. {firstName} will receive an email with your feedback."*
- Navigate back to the queue
- The store is no longer in the queue (it's now `DRAFT`)

**Error paths:**

| Response | UX |
|---|---|
| `400 "A rejection reason is required and must be at least 10 characters"` | Should be prevented client-side. If it slips through, surface as inline error on the textarea. |
| `404` / `400` status mismatch | Same as approve — toast + return to queue. |

#### Copy guidance for rejection reasons

What you write goes directly to the merchant as the `rejectionReason` — they see it as a banner on their dashboard and as the body of the rejection email. Tone matters.

**Do:**
- Address the specific issue: *"The logo image quality is too low — please upload a higher-resolution version."*
- Be actionable: *"Please upload a banner with minimum 1500×500 pixels."*
- Stay neutral and forward-looking: *"...and resubmit."*

**Don't:**
- Be vague: *"Logo doesn't meet our standards."* (The merchant doesn't know what to fix.)
- Be punitive: *"Application denied."* (We want them to fix and resubmit.)
- Mention internal jargon: *"Failed legitimacy check."*

---

### 6.5 Go-live review queue

Structurally identical to [§6.1 (initial review queue)](#61-initial-review-queue). Differences:

- **Endpoint:** `GET /stores/admin/pending-go-live` ([contract](./store-module-api.md#get-storesadminpending-go-live))
- **Each row additionally shows readiness signals:** active product count, address count
- **Empty state copy** points back at the first-review queue

**Per-row visual:**

```
┌─────────────────────────────────────────────────────────────────┐
│ [logo] BOLD Streetwear                                          │
│        Khanyi Mthamo · khanyi@gmail.com                         │
│        12 active products · 1 location · Banner ✓ · Story ✓    │
│        Requested 1 day ago · 7 May 2026, 09:15                  │
│                                                       [ Review ]│
└─────────────────────────────────────────────────────────────────┘
```

The readiness signals (product count, location count, banner ✓/✗, story ✓/✗) come from the queue endpoint's enriched response. They let the admin scan readiness at a glance without opening every detail page.

---

### 6.6 Review-go-live detail screen

Same layout as [§6.2 (initial review detail)](#62-review-a-store-detail-screen) with three additions:

1. **Active product preview** — a horizontal scroll of the first 6–8 active products (image + title + price), with a "View all 12 products" link to a deeper view (which would call `GET /stores/:storeId/products?status=ACTIVE`).
2. **Banner image** displayed prominently at full intended size (this is what buyers will see).
3. **Story** rendered in full (not truncated) — admins should read it.

The bank/payout section can be **collapsed by default** for go-live review (it was already verified at first review). The admin focuses on what's *new* since first approval: products, banner, story, addresses.

---

### 6.7 Approve go-live

**Entry:** "Approve go-live" button on the detail screen.

**Confirmation modal:**

```
Title:  Approve {displayName} to go live?
Body:   Approving will:
        • Move the store to ACTIVE status
        • Make the store visible to buyers immediately
        • Send {firstName} a celebratory email with their public URL

[ Optional: Add a personal note ]
[___________________________________]

Action: [ Cancel ]   [ Approve and go live ]
```

**API call:** `POST /stores/:id/review-go-live` with `{ decision: "APPROVE", reason?: string }` ([contract](./store-module-api.md#post-storesidreview-go-live))

**Success path (200):**
- Toast: *"{displayName} is now live."*
- Navigate back to the go-live queue

**Error paths:** same patterns as §6.3.

---

### 6.8 Reject go-live

Same UX as [§6.4 (reject a store)](#64-reject-a-store-with-copy-guidance), with two key differences:

1. **Different copy in the modal subtitle:**
   ```
   The merchant's store will return to APPROVED. They'll keep
   their dashboard access and MERCHANT role — they just need to
   address your feedback before they can request to go live again.
   ```

2. **Different rejection-reason templates** (focused on launch readiness rather than legitimacy):

| Template label | Pre-filled text |
|---|---|
| Banner quality | "Your banner image quality is too low. Please upload a banner with minimum 1500×500 pixels so it looks great on buyer screens." |
| Product photography | "Your product photos vary in quality and style. Please use consistent lighting and a similar background across all product images for a more professional look." |
| Story too brief | "Your brand story is short. Tell buyers more about your journey, what you stand for, and what makes your brand special — at least 200 words." |
| More products needed | "Your store has 7 active products which meets the minimum, but a stronger launch has 12+ products. Consider adding a few more before going live." |

**API call:** `POST /stores/:id/review-go-live` with `{ decision: "REJECT", reason: string }` ([contract](./store-module-api.md#post-storesidreview-go-live))

**Success path:** toast + back to queue.

> **Critical reminder for the admin:** the merchant doesn't lose anything on go-live rejection. They keep their MERCHANT role and dashboard access. They just need to polish for launch. Frame the rejection as "not yet ready" rather than "not good enough."

---

## 7. Edge cases & coordination

### 7.1 Role-upgrade JWT timing

**Scenario:** the admin approves a store. The merchant's `role` flips from `BUYER` to `MERCHANT` in the database. But the merchant's currently-issued access token still has `role: BUYER` in the JWT payload (signed at last login or refresh).

**Backend behaviour:** good news — `JwtStrategy.validate()` reads the `role` from the database on every request, not from the JWT payload (`auth.service.ts:22-33` per design doc Option B). The `request.user.role` is always the current DB value. This means **the backend's authz checks (e.g., `@Roles(MERCHANT)`) will work correctly** as soon as the DB flips.

**What the frontend has to do:** the frontend's local `user.role` (in React context / Zustand) is still `BUYER` because the access token says so. **Refetch `/auth/me` to update local state** whenever the merchant might have just had their role upgraded. Specifically:

- After `POST /stores/:id/review` succeeds (admin approved) — the admin's frontend doesn't need to refetch; the merchant's frontend does.
- The merchant's frontend can't know the moment the admin clicks Approve. Two strategies:
  1. **Refetch `/auth/me` on tab focus** while in `PENDING_REVIEW` — sufficient for v1.
  2. **Optional: aggressive periodic refetch** (e.g., every 60s) on the under-review status page — more responsive but uses more network. Skip for v1.

When `/auth/me` returns the upgraded role + new `store.status`, smoothly transition the merchant's UI from "under review" to the APPROVED dashboard. Show a one-time celebration toast: *"You're approved!"*

### 7.2 RejectionReason banner persistence

| Scenario | Banner displayed? | Cleared by | Where to show |
|---|---|---|---|
| Store in `DRAFT`, just rejected | Yes | Any edit (autosaved field change), submission, or admin approval | Top of setup wizard |
| Store in `APPROVED`, just rejected at go-live | Yes | **Only by `request-go-live` again or admin go-live approval** — edits do NOT clear it | Top of merchant dashboard (above the readiness checklist) |
| Store edited after rejection (DRAFT) | No (auto-cleared) | — | — |
| Store edited after rejection (APPROVED) | **Still yes — banner stays** | See above | Top of dashboard |

The asymmetry between DRAFT and APPROVED is the most important UX subtlety in this module. **Surface it directly in the APPROVED rejection banner copy:** *"This message will go away when you request go-live again."* (See [§2.7](#27-final-review-waiting-state-and-go-live-rejection-recovery).)

### 7.3 Image upload — cloud storage first, PATCH the URL second

**The backend does not handle file uploads.** `logoUrl` and `bannerUrl` are plain URL strings in the database. The frontend handles the entire upload flow against cloud storage (S3, Cloudinary, etc., per the project's chosen provider) and then sends the resulting URL to the backend.

**Pattern:**

```
1. User picks an image in the file input
2. Frontend validates: file size, type, dimensions
3. Frontend uploads to cloud storage (or to a Next.js API route that proxies to cloud storage)
4. Cloud storage returns the public URL
5. Frontend calls PATCH /stores/:id with { logoUrl: <url> } (or bannerUrl)
6. Backend stores the URL
```

**UX during this flow:**

- Show an in-progress preview using `URL.createObjectURL(file)` while upload is in flight
- Show upload progress (percentage or indeterminate) — uploads can be slow on mobile networks
- On upload failure (network, file too large, invalid type) — surface a retry option
- Only after `PATCH` returns 200, mark the section as "saved"

**Validation rules** (frontend-side before upload):

| Field | Recommended dimensions (soft) | File limits (hard) |
|---|---|---|
| Logo | Square (1:1), at least 500×500 | max 5MB, JPG/PNG/WebP |
| Banner | Wide (3:1 or similar), at least 1500×500 | max 10MB, JPG/PNG/WebP |

**Dimensions are soft warnings, not hard rejections.** If a logo is below 500×500 or non-square, **surface a warning** (*"This logo might look pixelated on buyer screens — try a higher-resolution version"*) but allow the upload to proceed. Many SA brands don't have studio-quality assets at hand; blocking submission on dimensions creates an unnecessary drop-off point.

**File size and format are hard limits** (enforced by the storage provider) — surface clear errors when those fail. The backend just stores the URL, so it doesn't validate dimensions; the frontend is the only gate, and the gate should be lenient on quality and strict only on transport (size, format).

> **Coordination note for the team:** the merchant's expectation is "I picked an image and it's saved." The split between "uploaded to storage" and "URL stored in backend" is invisible to them. If either step fails, the user-facing error should just be *"Image upload failed — try again."* Don't expose cloud-provider error details in the UI.

### 7.4 Multi-tab merchant setup

**Scenario:** the merchant has the setup wizard open in two tabs. Tab A autosaves a change to `description`. Tab B's local state is now stale.

**Risk:** tab B autosaves later with its stale `description`, overwriting tab A's change.

**Mitigation options:**

- (a) **Use `BroadcastChannel('yiiva-store-edit')` to sync edits across tabs.** When tab A successfully PATCHes a field, broadcast `{ type: 'field-saved', storeId, field, value }`. Tab B updates its local state. Sophisticated but adds complexity.
- (b) **Refetch `/stores/me` on tab focus.** Simpler. When tab B regains focus, refetch and overwrite local state. The user might lose unsaved changes in tab B if they had typed without losing focus, but this is rare for an autosaving form.
- (c) **No coordination.** Last write wins. Acceptable for v1 — the user is unlikely to edit the same field in two tabs at the same time, and autosave fires within seconds of typing stopping.

**Recommended: (b) for v1.** Refetch on tab focus is cheap, simple, and covers the common case. Document the "last write wins" caveat.

### 7.5 Employee dashboard discovery limitation

> Already documented in [auth flows §1 Known v1 limitation](./auth-frontend-flows.md#note-on-employees) and [§5 above](#5-employee-invite--recipient-screens). Recap of the workaround:

- At invite acceptance, persist `store.id` in `localStorage[yiiva_employee_store_id_<userId>]` (or similar key).
- On every login as a `BUYER` whose `store === null`, check localStorage.
- If a stored `store.id` exists, navigate to that store's dashboard and call `GET /stores/:storeId/employees` (the auth check) to verify the user is still an active employee.
- If the call returns 200, render the dashboard.
- If it returns 403 (the employee was deactivated/removed), clear the localStorage entry and route per the buyer matrix.

**Future cleanup:** once backend ships an `/auth/me/employments` endpoint, remove the localStorage workaround. Mark the code with a TODO so the cleanup is easy to find.

---

## 8. UX patterns & copy guidance

### Multi-step wizard vs single-page form

Section-based single-page form with sticky side nav (described in [§2.2](#22-store-setup-wizard-draft)) is recommended over a multi-step wizard for the merchant store setup. Reasons covered there.

**Use a multi-step wizard** only for genuinely sequential flows where step N depends on the output of step N-1. The store setup is parallel — no field depends on another field.

### Autosave behaviour and feedback

For all merchant-side editing (store details, addresses):

- Autosave on blur for short fields, debounced 800ms for long fields
- Per-section "Saved" indicator visible for ~2s after each save
- "Saving…" indicator while in flight
- "Save failed — retry" with a retry button on error
- Never block navigation with a confirmation dialog ("are you sure you want to leave with unsaved changes?") — autosave handles it

### Empty-state copy

Always provide a friendly empty state, never a blank screen:

| Where | Copy |
|---|---|
| No applications in admin first-review queue | *"You're all caught up. No store applications waiting for review. Check the go-live queue →"* |
| No applications in go-live queue | *"No go-live requests waiting. Check the first-review queue →"* |
| No employees yet | *"Build your team. Invite teammates to help you manage your store. [ Invite teammate ]"* |
| No locations yet | *"Add a location. Tell buyers where you're based. [ Add location ]"* |
| No active products yet (on the go-live readiness checklist) | *"You need at least 7 active products to go live. [ Add a product ]"* |

### Status page copy and tone

For waiting states (`PENDING_REVIEW`, `PENDING_GO_LIVE`):

- **Set expectations.** "2–3 business days" reduces anxiety.
- **Calm, present-tense framing.** *"Your store is under review."* Not *"Your store has been submitted and is awaiting admin action."*
- **No false urgency.** Don't show countdowns or pressure language.
- **Show submission timestamp** so the user knows when the clock started.

### Rejection-banner placement

| State | Banner location | Persistence |
|---|---|---|
| `DRAFT + rejectionReason` | Top of setup wizard, above the section nav | Until any field edit (autosave clears it) |
| `APPROVED + rejectionReason` | Top of merchant dashboard, above the go-live readiness checklist | Until `request-go-live` succeeds |

In both cases:
- Use a warm-but-firm visual style (yellow or amber background, not red — red feels punitive)
- Quote the `rejectionReason` verbatim
- Surrounding copy is constructive ("here's what to do") not blaming ("you got this wrong")

### Bank details masking and confirm-on-edit

Bank account info is the most sensitive data the merchant enters. UX rules:

- **Display masking.** When showing the existing account number (in the wizard, on a "review what you submitted" page, in admin detail screens), mask all but the last 4 digits: `**** **** **** 5678`.
- **Click-to-reveal.** A small text link *"Show"* reveals the full number. **Re-mask when the field loses focus or the user navigates away from the section** — don't auto-mask on a timer. Merchants often pause to compare numbers against their bank app or a paper statement; a timer-based auto-mask interrupts that work and feels surveillance-y.
- **Confirm-on-edit.** When editing the account number from masked → editable, require the merchant to click an explicit "Edit" button first that confirms intent. Don't make the masked field directly editable on focus.
- **Tone:** *"We use these details to pay out your earnings. Make sure they're accurate."*

Admins viewing a merchant's bank details should see the same masking by default. Reveal logged for audit (if you have any audit infrastructure; if not, that's a follow-up).

### Tone matrix per persona

| Persona | Tone | Example |
|---|---|---|
| Merchant — onboarding | Warm, reassuring | *"Welcome — let's get your brand on YIIVA."* |
| Merchant — under-review | Calm, expectation-setting | *"We're checking that everything is in order."* |
| Merchant — rejected | Constructive, forward-looking | *"Your application needs changes."* |
| Merchant — approved | Celebratory, action-pointing | *"Approved! Time to add your products."* |
| Merchant — live | Brief, milestone | *"Your store is live."* |
| Merchant — suspended | Factual, supportive | *"Your store is suspended. Contact support to resolve."* |
| Admin — queue | Functional, neutral | *"47 pending"* |
| Admin — review action | Clear-consequence | *"Approving will upgrade {firstName} to MERCHANT…"* |
| Admin — empty state | Productive | *"You're all caught up."* |

### Configuration values used in copy

The example copy throughout this document uses `support@yiiva.co.za` as the support contact. Treat this as a **placeholder**. Confirm the live address with the team and pull it from frontend config (e.g. `NEXT_PUBLIC_SUPPORT_EMAIL`) rather than hardcoding it across screens.

The public store URL pattern (`yiiva.co.za/store/{slug}`) is also illustrative — confirm with the team and pull from config.

---

## 9. Testing checklist

Manual UX checks per flow. Run on a real device whenever store-module code changes.

### Store creation and setup
- [ ] Onboarding "Start my store" CTA → `POST /stores` → 201 → land in setup wizard with the store ID populated
- [ ] Try creating with a duplicate companyName → 409 inline error on the right field
- [ ] Try creating with a duplicate displayName → 409 inline error
- [ ] Wizard autosave fires on blur for short fields, debounced for textareas
- [ ] "Saving…" / "Saved" indicators visible per section
- [ ] Save failure (force network error) shows retry option
- [ ] Logo upload: pick a file → preview shows → upload progress → `PATCH` fires → "Saved" indicator
- [ ] Logo upload: try a file > 5MB → friendly error before upload starts
- [ ] Logo upload: try a non-image file → friendly error
- [ ] Bank account number is masked on display, "Show" reveals, auto-masks after 30s
- [ ] "Edit" required to start editing a masked bank account number

### Submission and validation feedback
- [ ] Click Submit with required fields missing → 400 with full list → wizard scrolls to first missing, all missing highlighted, top banner shows count
- [ ] Click Submit with all required fields → 200 → reroute to under-review status page
- [ ] Try clicking Submit twice rapidly → second click gets 400 "already submitted" → reroute and show toast

### First-review waiting state and rejection
- [ ] PENDING_REVIEW status page renders with submission timestamp, "2–3 business days" copy
- [ ] Wizard fields are read-only (disabled) on this screen
- [ ] Refetch `/auth/me` on tab focus
- [ ] Admin rejects → next refetch shows DRAFT + rejectionReason → banner appears at top of wizard
- [ ] Edit any field → autosave fires → banner disappears (DRAFT auto-clear)
- [ ] After banner cleared, "View original feedback" link still shows it from localStorage

### Approved and go-live preparation
- [ ] Admin approves → merchant's next refetch shows MERCHANT role + APPROVED status
- [ ] Approval celebration toast shown once
- [ ] Go-live readiness checklist shows current progress (✓/☐ per item)
- [ ] Adding banner / story / address / products updates checklist progress live
- [ ] Active product count reflects products with `status=ACTIVE` only
- [ ] "Request go-live" button stays disabled until all 7 items complete
- [ ] Click Request go-live with one item missing (force a race) → 400 with missing list → checklist re-renders accurately

### Final review and go-live rejection
- [ ] PENDING_GO_LIVE status page renders with "final review" copy and timestamp
- [ ] Read-only — no edits
- [ ] Admin rejects → APPROVED + rejectionReason → banner appears on dashboard
- [ ] Edit a field → autosave fires → **banner stays** (APPROVED does NOT auto-clear)
- [ ] Banner copy says "This message will go away when you request go-live again"
- [ ] Click Request go-live (after fixing) → 200 → banner clears, status flips to PENDING_GO_LIVE

### Live store
- [ ] Admin approves go-live → next refetch shows ACTIVE
- [ ] One-time celebration toast / modal with public URL and Copy Link
- [ ] Toast doesn't show on subsequent logins
- [ ] Public URL is correct: `yiiva.co.za/store/{slug}`

### Address management
- [ ] Add a location → 201 → appears in list
- [ ] Edit location → 200 → list updates
- [ ] Delete a location → 200 → list updates
- [ ] Try to delete the only location of an APPROVED store → 400 → modal swaps to "add another first"
- [ ] DRAFT store can have all addresses deleted
- [ ] Address deleted in another tab/device → 404 on subsequent edit → quietly remove from local state

### Employee management (owner)
- [ ] Send invite to a new email → 201 → row appears in team list as "Pending"
- [ ] Try to invite an already-active employee → 409 inline error
- [ ] Try to invite an already-pending email → 409 with link to existing pending row
- [ ] Resend invite → 200 → "expires" date updates to +7 days
- [ ] Deactivate active employee → 200 → row visual updates to "Deactivated"
- [ ] Reactivate → 200 → row visual updates to "Active"
- [ ] Remove (hard delete) → confirmation modal → 200 → row gone
- [ ] Remove modal offers "Deactivate instead" tertiary action

### Employee management (active employee, not owner)
- [ ] Team list visible
- [ ] No action buttons rendered for the employee
- [ ] No invite button visible

### Employee invite recipient
- [ ] Click valid invite while logged out → store branding shown + sign-in/sign-up CTAs (auth flows)
- [ ] After accept → `store.id` persisted in localStorage → navigated to store dashboard
- [ ] Returning employee logs in → app reads localStorage → navigates to store dashboard → `GET /employees` confirms still active
- [ ] Returning employee whose access was revoked → 403 → localStorage cleared → routed per buyer matrix

### Admin first-review queue
- [ ] Queue shows oldest-first by default
- [ ] Each row shows logo, brand name, owner name, owner email, submission timestamp
- [ ] Pagination works (page 1, 2, 3)
- [ ] Empty state copy points to go-live queue

### Admin review-store detail
- [ ] All submitted info displayed
- [ ] Bank account masked by default, "Show" reveals, auto-masks
- [ ] Logo and banner thumbnails open lightbox
- [ ] Approve modal shows clear consequences
- [ ] Optional welcome note can be added or skipped
- [ ] Approve → success toast → back to queue → store no longer in queue
- [ ] Reject modal requires ≥10 chars
- [ ] Reject templates dropdown populates the textarea
- [ ] Reject → success toast → back to queue → store no longer in queue

### Admin go-live queue
- [ ] Each row shows readiness signals (active product count, locations, banner ✓, story ✓)
- [ ] Detail screen shows banner at full size, story in full
- [ ] Active products displayed in a horizontal scroll preview
- [ ] Approve / reject same UX as first-review with adjusted copy
- [ ] Reject templates focus on launch readiness, not legitimacy

### Multi-tab and multi-device
- [ ] Two tabs of setup wizard, edit in tab A → tab B refetches on focus
- [ ] Two tabs, admin approves in one → both reflect new state on next focus refetch
- [ ] Merchant approved on Device A → Device B's next focus shows APPROVED state

### Copy and accessibility
- [ ] Every action button is keyboard-reachable
- [ ] Form fields have associated labels (screen readers)
- [ ] Error banners use `role="alert"`
- [ ] Color contrast on rejection banner ≥ 4.5:1
- [ ] Bank-account-reveal action is keyboard-accessible (not click-only)
- [ ] Confirmation modals trap focus inside them
