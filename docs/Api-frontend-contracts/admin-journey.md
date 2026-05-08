# YIIVA — The Admin Journey

> **Audience:** Frontend engineers, product, and design building the admin surfaces of the merchant web app.
> **Scope:** The end-to-end experience of a YIIVA admin — internal staff who curate the marketplace by reviewing store applications, approving go-live requests, and managing the platform's category taxonomy.
>
> **How to use this doc:** read once for the human arc and the editorial considerations, then reach for the module-level flows docs (referenced throughout) when building specific admin screens.
>
> **Companion docs:**
> - [`auth-frontend-flows.md`](./auth-frontend-flows.md) — auth screens
> - [`store-frontend-flows.md`](./store-frontend-flows.md) — admin queues and review screens (store)
> - [`product-frontend-flows.md`](./product-frontend-flows.md) — admin category management (product)
> - [`merchant-journey.md`](./merchant-journey.md) — the merchant whose store the admin is reviewing
> - [`employee-journey.md`](./employee-journey.md) — invited team members

---

## Table of Contents

1. [Persona snapshot](#1-persona-snapshot)
2. [The work at a glance](#2-the-work-at-a-glance)
3. [Phase 1 — Onboarding (out-of-band)](#3-phase-1--onboarding-out-of-band)
4. [Phase 2 — First-review queue (the daily core)](#4-phase-2--first-review-queue-the-daily-core)
5. [Phase 3 — Go-live review queue](#5-phase-3--go-live-review-queue)
6. [Phase 4 — Category management (occasional)](#6-phase-4--category-management-occasional)
7. [Edge moments across the work](#7-edge-moments-across-the-work)
8. [Cross-module touchpoints](#8-cross-module-touchpoints)
9. [Decision-quality risks and UX responses](#9-decision-quality-risks-and-ux-responses)
10. [UX and copy guidance specific to the admin](#10-ux-and-copy-guidance-specific-to-the-admin)

---

## 1. Persona snapshot

### Who the YIIVA admin is

A YIIVA staff member responsible for the **curation quality** of the marketplace. They make the calls that decide which brands get on the platform and which don't. They write the feedback that determines whether a rejected merchant fixes-and-resubmits or quietly disappears. They own the platform's category taxonomy.

In a smaller team, this might be a single founder or operations lead. As YIIVA scales, it becomes a small dedicated curation team — possibly 2–4 people. For now, treat the admin role as **one logical persona** with the same UI for everyone with `role: ADMIN`.

### Their relationship to the platform

The admin is **not a customer of YIIVA** — they are an operator. The merchant web app's admin surfaces are **internal tools**. This is the most important framing distinction in this entire doc.

Internal-tool UX has different priorities from customer UX:
- **Efficiency over polish.** A 1-second delay on a queue-load screen is a real cost — the admin opens that screen 50 times a day.
- **Information density** is welcome. Admins want as much relevant data on screen as possible. Cramped is fine; obscured is not.
- **No marketing tone.** Direct, factual copy. *"47 pending"* not *"You have 47 wonderful brands waiting!"*
- **Decision support over delight.** What helps the admin make a *better* decision faster is the right thing to ship, even if it's visually plain.

### Their tech-savvy level

Higher than the merchant or employee. The admin operates a curation tool every day — they will get fluent with whatever interface we ship. Internal jargon (status names, IDs visible for debugging) is acceptable here in a way it isn't elsewhere. Don't go full developer-tool, but you can show `PENDING_REVIEW` as a status pill instead of *"Under review"* — admins prefer canonical names.

### What they want

In admin's words:
- *"Show me the queue. Let me work through it."*
- *"Don't make me dig for the info I need to decide."*
- *"When I reject, give me templates I can adapt."*
- *"I shouldn't be guessing whether someone's already reviewed this."*

In product terms:
- A **work queue** that's fast and clear
- A **detail screen** that surfaces every relevant signal at-a-glance
- **Decision support** (templates, hover tooltips, history)
- **Confidence in their own actions** (clear consequences in confirmation modals, no ambiguous silent saves)

### Their emotional state

Mostly **routine**. The admin opens the queue, processes work, closes the laptop. There's no excitement arc, no journey from intent to outcome. The emotional dimensions that DO matter:

- **Decision pressure** — every approve/reject affects a real merchant's livelihood. Admins can feel the weight, especially on borderline calls.
- **Compassion fatigue** when writing rejection copy repeatedly. The first rejection of the day is well-crafted; the tenth tends toward template-default.
- **Vigilance** — an admin who approves a fraudulent or low-quality store damages the marketplace. They have to stay sharp.

The UX response to these is to **support the admin's decision-making** rather than glamorise it. Templates reduce compassion fatigue. Information density supports vigilance. Confirmation modals slow down only the destructive actions, not routine ones.

### Their success metric

Two metrics, both measured by the platform:
- **Time-to-decision** per submitted store (shorter is better, within reason — quality matters too)
- **Resubmission rate after rejection** (high is good — means the rejection copy was actionable)

Admins won't see these dashboards in the v1 admin tool, but the design choices throughout this doc are aimed at improving both.

---

## 2. The work at a glance

### The four work surfaces

The admin's day rotates between four surfaces:

```
First-review queue     ←→  Go-live queue          (the two queues)
       ↓                          ↓
Review-store detail    ←→  Review-go-live detail  (per-application work)
                ↓
        Approve / Reject

Category management                                (occasional, separate)
```

There is no linear "journey" the way the merchant has — admins return to the queue throughout the day, work an item, return, work the next.

### Frequency of each surface

| Surface | Frequency | Notes |
|---|---|---|
| First-review queue | Many times per day | The default landing page after admin login |
| First-review detail screen | Many times per day | One per application reviewed |
| Go-live queue | Daily | Lower volume than first-review (only post-approved merchants reach this) |
| Go-live detail screen | Daily | More content to inspect (banner, products, story) |
| Category management | Weekly–monthly | Mostly stable taxonomy; rare changes |

### Volume expectations (rough orders of magnitude, pre-data)

Pre-launch we don't have real numbers. Order-of-magnitude guesses:

- 10–50 store applications per week at launch
- 5–25 go-live requests per week (most approved stores eventually request go-live)
- 1–5 category-management actions per month after the initial taxonomy is seeded

These are **starting hypotheses** — track real volumes after launch and adjust UX (e.g. introduce search, filters, batch actions) once the queue size makes them necessary.

### What's intentionally absent in v1

The admin tool is **deliberately minimal** for v1:

- **No audit log of decisions.** The current schema doesn't track decision history per admin. Rejection reasons are overwritten on each cycle. The admin community is small enough that informal accountability suffices for v1.
- **No bulk actions.** Admins approve/reject one store at a time. Bulk approve doesn't exist.
- **No search across queues.** The queues are paginated and sortable, but there's no text-search filter.
- **No internal commenting / collaboration.** Two admins can't leave notes for each other on a pending store.
- **No notifications-to-admin** when a new application arrives. Admins manually check the queue.

Each of these is a v2+ candidate. None of them block launch. Track each as backend/frontend follow-up if real usage shows them needed.

### Admin team coordination is out-of-band

The admin tool itself has no in-app collaboration features in v1 — no commenting, no presence indicators, no shared notes. Admin team coordination happens **out-of-band**, via the team's existing channels (e.g. Slack). The doc references "Slack" as shorthand throughout; substitute whatever channel the admin team actually uses. The point is: the admin tool stays focused on the curation work itself, not the conversation around it.

---

## 3. Phase 1 — Onboarding (out-of-band)

### What's happening

Admin users are **seeded directly into the database** by the YIIVA dev team. There is no self-registration flow for admins — the contract has no `/auth/admin/register` endpoint, and the merchant web app doesn't expose an admin signup form.

The admin's first-time arrival on the platform is:
1. Engineering / ops team creates the admin user via Prisma (e.g. `prisma/seed.ts` or a one-off SQL insert)
2. The new admin gets their email + temporary password from the team out-of-band (Slack, email, in-person)
3. They log in via the standard `/login` screen
4. **Once authenticated**, the post-login routing matrix sends them to the admin panel

Admins use the standard auth flows for password reset (`/forgot-password` → `/reset-password`). The all-sessions-revoke side effect (see [auth flows §4.4](./auth-frontend-flows.md#44-reset-passwords-revoke-all-sessions-side-effect)) applies — they'll be signed out on other tabs after a reset. This is expected security behaviour, same as for merchant resets, and not a v1 limitation.

### What the admin feels

It's a workday tool. They don't have a "first-time delight" moment. They want to see the queue and start working.

### Phase-1 success looks like

- The admin logs in and lands on the admin panel within a few seconds
- They don't have to navigate to find their work — the queue is the default landing
- The temporary password from setup gets changed quickly (via the standard reset flow)

### Failure modes

- **Forgotten temporary password.** Standard recovery via `/forgot-password`.
- **Admin user not seeded yet.** They get *"Invalid credentials"* — the recovery is a Slack message to engineering.
- **Account suspended/deactivated.** Same as the [auth flows §4.1 mid-session takeover](./auth-frontend-flows.md#41-account-suspendeddeactivated-mid-session). Should not happen often for admins; if it does, it's an internal-team issue, not an external recovery.

---

## 4. Phase 2 — First-review queue (the daily core)

### What's happening

The admin opens the merchant web app, lands on the admin panel's first-review queue, and processes pending store applications one at a time. Each application is a merchant who clicked "Submit for review" and is now waiting.

### What the admin feels

Routine focus. The queue is their workload — a stack of applications to work through. Each one is a different brand; the admin's job is to make a clear decision quickly.

### Screens involved

- [Store flows §6.1 Initial review queue](./store-frontend-flows.md#61-initial-review-queue) — the queue list
- [Store flows §6.2 Review-a-store detail screen](./store-frontend-flows.md#62-review-a-store-detail-screen) — the per-application work screen
- [Store flows §6.3 Approve a store](./store-frontend-flows.md#63-approve-a-store)
- [Store flows §6.4 Reject a store (with copy guidance)](./store-frontend-flows.md#64-reject-a-store-with-copy-guidance)

### The work cycle

A typical admin morning:

```
Open queue → see N pending → click "Review" on the oldest →
inspect detail screen → approve or reject → return to queue →
queue now shows N-1 → click next → ...
```

Repeat until the queue is empty or the admin's session ends.

### Working from the queue list

The queue list shows oldest-first by default (FIFO — work the queue in submission order). Each row gives the admin enough at-a-glance info to prioritise:

- Store logo + brand name (visual recognition, fraud signals at a glance)
- Owner name + email
- Submission timestamp (relative + absolute)
- **Implicit signals** — a missing logo, suspicious phone number format, etc., are immediately visible

The admin clicks "Review" on a row → opens the detail screen.

### Working from the detail screen

The detail screen is the admin's actual decision surface. It shows everything the merchant submitted — brand identity, contact, business registration, bank details, owner profile.

**Critical UX patterns** (already in [store flows §6.2](./store-frontend-flows.md#62-review-a-store-detail-screen)):

- **Bank account number masked by default**, click-to-reveal. Even admins shouldn't see account numbers in casual view; reveal is an explicit action.
- **All fields read-only** — admins can't edit a merchant's data.
- **Logo and banner thumbnails open lightboxes** for full-size verification.
- **Submission timeline** at the bottom: when submitted, whether previously rejected.
- **Two action buttons** — Approve and Reject — both prominent at the bottom, sticky if the page is long.

### The decision moment

The admin clicks Approve or Reject. Each opens a confirmation modal that **states the consequence clearly**:

For approval:
> Approving will:
> - Upgrade {firstName}'s account to MERCHANT
> - Move the store to APPROVED status
> - Send {firstName} an email with next steps
>
> The store won't be visible to buyers yet — that's the next gate (go-live review).

For rejection:
> The merchant will be notified by email and can edit and resubmit. Be specific so they know what to fix.

The admin can include an optional welcome note on approval (gets sent in the approval email — *"Love the brand. Welcome to YIIVA!"*), or must write a 10+ character rejection reason.

### Rejection-reason templates — the most important admin UX feature

Writing rejection copy is the admin's emotionally-heaviest task. They write the same kind of feedback over and over: *"logo too low resolution"*, *"bank details couldn't be verified"*, *"description too brief"*. Without templates, admins write the same sentences from scratch every time and quality degrades through the day.

The reject modal includes a **Templates dropdown** with pre-written examples (per [store flows §6.4](./store-frontend-flows.md#64-reject-a-store-with-copy-guidance)):

| Template | Pre-fill |
|---|---|
| Logo quality | *"The logo image quality is too low. Please upload a higher resolution version (at least 500×500 pixels) so it looks sharp on buyer screens."* |
| Banking details | *"Your bank account details couldn't be verified. Please double-check your account number and branch code, then resubmit."* |
| Business registration | *"We couldn't find your CIPC registration number. Please check it for typos and resubmit."* |
| Description too brief | *"Your description is too brief. Tell buyers more about what you sell..."* |

The admin picks a template, edits to fit the specific case, hits Reject. **This single feature is the difference between consistent merchant feedback and degrading quality through the day.**

### Phase-2 success looks like

- The admin can process a typical application in 3–5 minutes (read details + decide + write/click rejection or approval)
- They never feel they're missing critical information
- Rejection copy quality stays high throughout the day (templates make this possible)

### Failure modes

- **Decision paralysis on borderline stores.** A store with mostly-OK details and one suspicious signal. Admins might sit on it. Mitigation (out of scope for v1): a "send to a colleague for second opinion" feature. v1: admins discuss in Slack and one of them makes the call.
- **Compassion fatigue degrading rejection quality.** Templates are the primary mitigation. A secondary option: a small text reminder *"Be specific — they need to know what to fix"* visible while writing the reason.
- **Accidental approval/rejection.** Mitigation: the confirmation modals are non-trivially dismissible. The admin must read at least the modal heading before clicking. Don't make these one-click — the consequence is real.
- **Stale queue (admin reviewed in another tab).** The queue list refetches on tab focus; if a store was just acted on by another admin, it disappears from the queue. The current admin sees the count drop. Acceptable.

---

## 5. Phase 3 — Go-live review queue

### What's happening

A second queue, structurally identical to first-review but with different inspection priorities. Stores in this queue have already been approved at the first gate — the admin verified they're a legitimate brand. Now the admin is verifying they're **ready to be seen by buyers**.

### What the admin feels

Slightly different from first-review. The merchant has been working toward this moment for weeks. A rejection here lands harder. The admin should know the merchant has invested significant effort by this point.

### Screens involved

- [Store flows §6.5 Go-live review queue](./store-frontend-flows.md#65-go-live-review-queue)
- [Store flows §6.6 Review-go-live detail screen](./store-frontend-flows.md#66-review-go-live-detail-screen)
- [Store flows §6.7 Approve go-live](./store-frontend-flows.md#67-approve-go-live)
- [Store flows §6.8 Reject go-live](./store-frontend-flows.md#68-reject-go-live)

### The differences from first-review

**Queue rows show readiness signals at a glance:**
- Active product count (e.g. *"12 active products"*)
- Address count (e.g. *"1 location"*)
- Banner ✓ / Story ✓

These let the admin skim the queue and form a hunch about each store's readiness without opening every detail page.

**Detail screen surfaces the *new* content:**
- Banner image at full size — buyers will see this as the brand's hero
- Story rendered in full (not truncated) — admins should read it
- A horizontal scroll preview of the first 6–8 active products
- Bank/payout section is collapsed by default — already verified at first review

The admin's focus shifts from *"is this a legitimate brand?"* to *"is this store ready for the spotlight?"*

### Approval — the third merchant milestone

When the admin approves a go-live request, the store goes `ACTIVE` and becomes visible to buyers. From the merchant's perspective, this is the **biggest milestone of their journey** ([merchant journey §7](./merchant-journey.md#7-phase-5--go-live-request-and-final-review)).

The admin should know they're powering this milestone. The confirmation modal makes the consequence vivid:

> Approving will:
> - Move the store to ACTIVE status
> - Make the store visible to buyers immediately
> - Send {firstName} a celebratory email with their public URL

There's no admin-side celebration of approving the go-live (it's their job, after all), but it's worth a moment of mental acknowledgement: *"This person's brand is going live because of my click."*

### Rejection — the harder rejection to write

Go-live rejection is harder than first-review rejection for everyone:
- The merchant has spent weeks building toward this
- They need feedback specific enough to act on
- The admin must frame it as *"not yet, here's what to polish"* not *"not good enough"*

The rejection-reason templates for go-live ([store flows §6.8](./store-frontend-flows.md#68-reject-go-live)) focus on launch readiness rather than legitimacy:

| Template | Pre-fill |
|---|---|
| Banner quality | *"Your banner image quality is too low. Please upload a banner with minimum 1500×500 pixels..."* |
| Product photography | *"Your product photos vary in quality and style..."* |
| Story too brief | *"Your brand story is short. Tell buyers more about your journey..."* |
| More products needed | *"Your store has 7 active products which meets the minimum, but a stronger launch has 12+..."* |

The admin picks a template, edits to the specific store, sends.

### Phase-3 success looks like

- Most go-live requests are approved on the first review (the per-product activation contract did most of the readiness work; only store-level polish remains)
- Rejection copy stays specific and constructive
- Time per go-live review is ~5–8 minutes (slightly longer than first-review because of the product preview and story reading)

### Failure modes

- **Inspecting products is slow.** The detail screen has a horizontal scroll of products, not a dedicated catalog browser. If the admin wants to inspect every product carefully, they'd need to click through to each. Mitigation: the activation contract already filters out products without images / categories / valid prices, so inspection at this gate is more about consistency than completeness. v1 accepts this.
- **No quick way to compare against previously-approved stores.** *"Was this store's banner quality the same as the one I approved yesterday?"* Mitigation: subjective consistency is what builds the curation team's editorial sense over time. v1 doesn't tooling this; it's a v2+ candidate (e.g., a "recently approved" reference panel).

---

## 6. Phase 4 — Category management (occasional)

### What's happening

The admin manages the platform-wide category taxonomy — Fashion, Streetwear, Hoodies, etc. They create new categories, edit existing ones, occasionally delete unused ones.

This is **not daily work**. The taxonomy is mostly stable after the initial setup. Most days no category-management happens.

### What the admin feels

Light touch. This is editorial / structural work, not throughput. Mistakes here have wider impact (a renamed category affects every product linked to it), so admins should move carefully but not anxiously.

### Screens involved

- [Product flows §10 Admin — platform categories](./product-frontend-flows.md#10-admin--platform-categories)

### The work surfaces

**Tree view** — the admin sees the entire category hierarchy:

```
▾ Fashion (24 products)
  ▾ Streetwear (12 products)
    Hoodies (4 products)                  [Edit] [×]
    T-Shirts (5 products)                 [Edit] [×]
    Caps (3 products)                     [Edit] [×]
  ▾ Formal (10 products)
    Suits (8 products)                    [Edit] [×]
    Shirts (2 products)                   [Edit] [×]
  Vintage (2 products)                    [Edit] [×]
▾ Beauty (15 products)
```

Per-node product count is critical context. *"Fashion has 24 products linked"* tells the admin instantly whether deleting that category is safe (it isn't).

### The four common operations

**1. Create a category.** Admin clicks "+ New category" → fills name, optional description, optional image, picks a parent (or leaves empty for root) → submits. Slug auto-generates platform-wide.

**2. Rename a category.** Edit modal pre-fills with current values. Admin changes the name, submits. The slug **does not change** automatically (per contract — slug is fixed at creation). Helper text reminds them of this.

**3. Reparent a category** (move it under a different parent). Edit modal includes a parent picker. The admin selects a new parent. Cycle prevention is active — the admin cannot select a descendant of the category being moved (frontend pre-disables those options; backend would 400 if they slipped through).

**4. Delete a category.** Confirmation modal opens. If the category has children, linked products, or store associations, the modal **swaps to an explanation** of why deletion is blocked, with recovery actions (e.g. *"Re-categorise these N products first"*).

### Phase-4 success looks like

- Adding a new category takes under a minute
- Reparenting cycle prevention catches mistakes before submission (no 400 surprises)
- Delete-blocked recovery flows give the admin a clear path forward

### Failure modes

- **Slug-rename limitation.** Renaming a category does **not** change its slug — slugs are fixed at creation. The edit-modal helper text should make this explicit: *"The URL slug `{slug}` is permanent and won't change when you rename this category."*

  For empty categories the admin could theoretically delete and recreate with the desired name. **For any non-empty category, this isn't practical** — deletion is blocked when the category has children, products, or store associations (per the contract's three blocked-by reasons). A popular category like "Hoodies" with 47 products linked would require re-categorising every product onto a temp category, deleting the old "Hoodies", creating a new one with the desired slug, and re-categorising every product back — a multi-hour operation for what should be a 30-second rename.

  > **Backend follow-up:** if slug-rename becomes a real need (legal name change, rebranding), add an admin endpoint to update the slug while preserving children, products, and store associations. Not blocking for v1 — track if real demand surfaces.

- **Accidental reparent breaking discovery.** Admin moves "Hoodies" out from under "Streetwear" by mistake. Buyers browsing Streetwear no longer see Hoodies. Recovery: admin reparents back; v1 has no undo, but the operation is reversible by another reparent.

- **Delete-block confusion.** The three different blocked-by reasons (children, products, stores) might initially confuse a new admin. Mitigation: each blocked path's recovery copy spells out the *specific* fix, not a generic *"this category has dependencies."*

---

## 7. Edge moments across the work

### 7.1 Two admins acting on the same store

Admin A and Admin B both open the same pending store at the same time. Admin A approves first. Admin B's approve/reject call returns 400 *"Only stores in PENDING_REVIEW status can be reviewed"* (the store has moved to APPROVED).

**UX:** Admin B sees a toast: *"This store has already been reviewed."* The detail screen refetches to show the latest state (now approved). Admin B can move on to the next item in their queue.

**Worth tracking:** if this happens often, it's a signal that admins aren't coordinating. v2+ could add real-time queue updates (websockets) so an item disappears from one admin's queue when another opens it. v1 accepts the rare collision.

### 7.2 Reviewing a previously-rejected store

A merchant who was rejected, fixed the feedback, and resubmitted will appear in the queue again. The admin **may or may not be the same admin** who rejected last time.

**UX:** the detail screen should show:

```
Submission timeline:
  Submitted: 8 May 2026, 14:23 (just now)
  Previously rejected: 5 May 2026 (3 days ago)
  Previous rejection reason: "Logo image quality is too low..."
```

This is critical for the admin to provide consistent feedback — they shouldn't reject for the same reason that was already addressed, and they shouldn't introduce conflicting reasons.

> **Backend follow-up:** the current backend overwrites `rejectionReason` on each cycle. The previous rejection reason is **not preserved** anywhere. The admin can't see what the previous admin said. This is a real gap for editorial consistency. Track for backend remediation — a `StoreReview` audit table per the design doc would solve it. v1 admins coordinate via Slack.

### 7.3 Admin signs out mid-review

The admin has the detail screen open, hasn't yet approved or rejected. They close their laptop. Tomorrow, they sign back in.

- The store is still in `PENDING_REVIEW` (no action was taken)
- The admin lands back on the queue
- The store is still there to be reviewed
- No work is lost

### 7.4 Admin's account is suspended

Out-of-band incident — an admin user's account is deactivated by another team member. Their next API call returns 401 *"Account is inactive or does not exist"*.

UX: the standard [auth flows §4.1 mid-session takeover](./auth-frontend-flows.md#41-account-suspendeddeactivated-mid-session). Internal-team issue — recovery is via reaching out to engineering / HR, not YIIVA support.

### 7.5 An admin reviewer disagrees with a previous decision

Admin A approves Brand X. Admin B (or even Admin A on reflection) thinks *"this shouldn't have been approved."* What can they do?

**Nothing — in v1.** Once a store is `APPROVED` (or further, `ACTIVE`), there is **no admin endpoint to reverse the decision**. `POST /stores/:id/review` only operates on `PENDING_REVIEW` stores; `POST /stores/:id/review-go-live` only on `PENDING_GO_LIVE`. There is no "un-approve", "demote to draft", or "force-suspend" endpoint in the contract.

Practically: a store approved by mistake is **stuck approved** until the merchant themselves takes some action — which they won't, because they got what they wanted. The only recourse is direct database manipulation by the engineering team, treated as an exceptional incident.

> **Backend follow-up needed:** an admin moderate / force-suspend endpoint that transitions an `ACTIVE` (or `APPROVED` / `PENDING_GO_LIVE`) store to `SUSPENDED`. The schema supports `SUSPENDED` already (see [store flows §2.9](./store-frontend-flows.md#29-suspended--closed--read-only-states)) — the endpoint just doesn't exist. Pair with the `StoreReview` audit table (already flagged in §7.2 / §9) so the moderation action is logged.

Until that ships: admins coordinate via the team's out-of-band channel (see [§2 Admin team coordination is out-of-band](#admin-team-coordination-is-out-of-band)) and engineering steps in for the rare incident. Acceptable for launch with a small admin team; risky at scale.

### 7.6 Off-hours coverage

Stores submit at all hours. The queue doesn't sleep. If admins work standard hours, applications pile up overnight.

This is an **operational concern, not a UX concern** — the admin tool just shows whatever's in the queue regardless of when it arrived. The merchant's *"2–3 business days"* expectation copy is what manages their patience. v1 is fine; v2+ might add staggered notifications or queue priorities.

---

## 8. Cross-module touchpoints

### 8.1 Auth × Store: the ADMIN role gate

All admin endpoints are gated by the `RolesGuard` + `@Roles(UserRole.ADMIN)` decorator chain. We **wired this up earlier in the session** when we identified that the store controller's `@Roles(...)` decorators were no-ops without `@UseGuards(RolesGuard)`. With the guard in place, only `ADMIN` users can hit:

- `GET /stores/admin/pending`
- `GET /stores/admin/pending-go-live`
- `POST /stores/:id/review`
- `POST /stores/:id/review-go-live`
- `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id`

Frontend rule: **the admin nav and the admin URLs should only be reachable** for users with `role: ADMIN`. The post-login routing matrix sends ADMIN users to `/admin/*`; non-admins navigating to admin URLs directly should be soft-redirected to their persona's home with a brief toast (*"This area is for YIIVA staff only."*) rather than a full 403 takeover.

### 8.2 Store × Notifications

Approval and rejection emails to merchants are sent **server-side via Resend** ([store flows §6.3](./store-frontend-flows.md#63-approve-a-store)). The admin doesn't see them. They appear in the merchant's inbox.

If the email fails to send, the approval/rejection still stands (the database is updated regardless). The admin's UI doesn't reflect email-send failures — those are a backend logging concern. Don't surface email failures in the admin UI; it would be alarming and not actionable.

### 8.3 Store × Product

Indirect touchpoint: at first review, admins typically don't inspect the merchant's products (none should exist yet — the store is still in `DRAFT` going to `PENDING_REVIEW`, before product creation is unlocked). At go-live review, admins **do** inspect a sample of active products (banner quality, photography consistency, etc.) but only at the readiness level, not the per-product approval level (products self-publish via the activation contract).

The admin tool doesn't include a deep product-review surface. If the admin wants to inspect a specific product carefully, they currently click through to the public product detail (assuming the store is `ACTIVE` already, which it isn't pre-go-live). For go-live review, the horizontal product preview + the merchant's product summary is the inspection surface.

### 8.4 Category management × Product × Store

When an admin creates or modifies a category, the change ripples through the platform:
- Existing products linked to the category are unaffected (just their category's name/slug changes)
- Buyers browsing by category see the updated tree on their next fetch
- Merchants linking products to categories see the updated picker

The admin's actions don't ripple back into their own tool — the product counts in the tree refresh on next page-load, not via real-time updates.

---

## 9. Decision-quality risks and UX responses

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Decision paralysis on borderline stores | 2 / 3 | Medium | Slack-discuss in v1; escalation feature in v2+ |
| Compassion fatigue → poor rejection copy | 2 / 3 | High | Rejection templates; reminder copy *"be specific"*; tone guidance ([store flows §6.4](./store-frontend-flows.md#64-reject-a-store-with-copy-guidance)) |
| Accidental approval/reject click | 2 / 3 | Low | Confirmation modals with consequence-clear copy |
| Inconsistent feedback across admins | 2 / 3 | Medium | Templates; Slack coordination; the missing-prev-rejection-history gap is a real risk |
| Stale queue (concurrent admin actions) | 2 / 3 | Low | Refetch on tab focus; brief toast on collision |
| Slug-rename confusion | 4 | Low | Helper text in edit modal explaining slug-fixed-at-creation |
| Reparent cycle attempts | 4 | Low | Frontend pre-filters cycle-creating options in the parent picker |
| Delete-block confusion | 4 | Low | Specific recovery copy per blocked-by reason |
| **No audit log of admin decisions** | All | **Medium-high (post-launch)** | **Backend follow-up — `StoreReview` table per design doc**. v1 accepts the gap. |
| **Previous rejection reason not preserved across cycles** | 2 / 3 | **Medium** | Backend follow-up — same audit-log work as above. |

The two **medium-or-higher backend gaps** (audit log + rejection history) are tracked together. They're related — both solved by adding the `StoreReview` audit table.

---

## 10. UX and copy guidance specific to the admin

### Voice and tone

The admin tool is a **workplace tool**, not a marketplace surface. Copy is direct, factual, and free of marketing voice. Use canonical status names. Show counts and timestamps prominently. Don't decorate.

**Do:**
- *"47 pending"*
- *"PENDING_REVIEW"*
- *"Submitted 3 days ago · 6 May 2026, 14:23"*
- *"Approving will upgrade {firstName} to MERCHANT and send them an email."*

**Don't:**
- *"You have 47 wonderful brands waiting!"*
- *"Under fabulous review"*
- *"Three days have passed since the brand reached out"*
- *"Are you sure you want to continue with this important action?"*

### Copy *for* merchants — the editorial responsibility

The admin **writes copy that goes directly to merchants**. Specifically: rejection reasons, optional approval welcome notes. The admin tool's copy guidance to the admin matters here:

- The reject-modal includes templates ([store flows §6.4](./store-frontend-flows.md#64-reject-a-store-with-copy-guidance)). The admin picks one and adapts.
- A small reminder visible in the textarea: *"This message goes directly to the merchant. Be specific."*
- Character count visible (10 minimum, 500 soft max).
- No grammar/spell-check in v1, but worth adding a v2+ candidate — admins under fatigue make typos that land in production emails.

### Information density is a feature, not a bug

The admin tool can pack more onto a screen than a customer-facing surface. Pre-launch instinct will be to "design down" toward whitespace; resist this for the admin tool. A queue row should fit:
- Logo thumbnail
- Brand + company name
- Owner name + email
- Submission timestamp (relative + absolute)
- Status indicator (if multiple statuses are visible)
- Action button

…all on one row, scannable. The admin will read 50 of these in a sitting.

### Confirmation modal patterns

| Action | Modal style |
|---|---|
| Approve a store | Standard confirmation, list consequences plainly, optional welcome-note field |
| Reject a store | Required reason field (10+ chars), templates dropdown, character count |
| Approve a go-live | Standard confirmation, list consequences plainly, optional welcome-note field |
| Reject a go-live | Required reason field, *different* templates focused on readiness, character count |
| Delete a category (when allowed) | Standard confirmation |
| Delete a category (when blocked) | **Non-actionable explanation modal** with the specific blocked-by reason and recovery path |
| Reparent a category | Inline edit, no separate confirmation (low-stakes if reversible) |
| Rename a category | Inline edit with helper text about slug not changing |

### What to NOT show in the admin tool (v1)

Resist the temptation to add these in v1:
- Real-time presence indicators (*"Admin Sarah is reviewing this now"*)
- Per-admin metrics (*"You've reviewed 23 stores this week"*)
- Predictive AI suggestions (*"This store looks similar to one previously rejected"*)
- Bulk actions
- Cross-admin commenting

Each of these is a v2+ candidate. Shipping v1 lean keeps the curation team focused on the curation work itself, not the tool.

### Configuration values used in copy

The example copy in this doc references `support@yiiva.co.za` as the support contact. Treat as a placeholder per the same convention as the other flows docs ([auth flows §1](./auth-frontend-flows.md#1-context), [store flows §1](./store-frontend-flows.md#1-context), [merchant journey §12](./merchant-journey.md#configuration-values-used-in-copy), [employee journey §11](./employee-journey.md#11-ux-and-copy-guidance-specific-to-the-employee)).

The admin tool itself doesn't surface the support email much — admins are the support. Internal escalation (e.g. *"Slack #curation-team"*) is the admin's recovery channel, but that's a YIIVA-internal config that doesn't belong in the customer-facing copy this doc governs.

---

## Closing note

The admin doesn't have a journey arc. They have a daily workflow. The single question to evaluate every admin-tool UX decision against:

**Does this help the admin make a better, faster, more consistent decision — without decorating their work?**

If yes, ship it. If it adds delight that doesn't help the decision, leave it for the consumer-facing surfaces. The admin's success is measured in throughput and decision quality; the tool should serve those, not perform for them.
