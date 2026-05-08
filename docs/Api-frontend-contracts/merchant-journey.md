# YIIVA — The Merchant Journey

> **Audience:** Frontend engineers, product, design, and founder-stakeholders involved in the merchant web app.
> **Scope:** The end-to-end experience of a YIIVA merchant — the brand owner — from first registration through running a live store. Organized chronologically by **user journey**, not API module.
>
> **How to use this doc:** read it once, top to bottom, to internalise the merchant's emotional and operational arc. Then reach for the module-level flows docs (referenced throughout) when building specific screens.
>
> **Companion docs:**
> - [`auth-frontend-flows.md`](./auth-frontend-flows.md) — auth screens
> - [`store-frontend-flows.md`](./store-frontend-flows.md) — store-module screens
> - [`product-frontend-flows.md`](./product-frontend-flows.md) — product-module screens
> - [`employee-journey.md`](./employee-journey.md) — invited-teammate experience (forthcoming)
> - [`admin-journey.md`](./admin-journey.md) — YIIVA-staff experience (forthcoming)

---

## Table of Contents

1. [Persona snapshot](#1-persona-snapshot)
2. [The journey at a glance](#2-the-journey-at-a-glance)
3. [Phase 1 — Discovery and signup](#3-phase-1--discovery-and-signup)
4. [Phase 2 — Onboarding to DRAFT](#4-phase-2--onboarding-to-draft)
5. [Phase 3 — Submission and the first review](#5-phase-3--submission-and-the-first-review)
6. [Phase 4 — Approved and building toward go-live](#6-phase-4--approved-and-building-toward-go-live)
7. [Phase 5 — Go-live request and final review](#7-phase-5--go-live-request-and-final-review)
8. [Phase 6 — Live operations (light)](#8-phase-6--live-operations-light)
9. [Edge moments across the journey](#9-edge-moments-across-the-journey)
10. [Cross-module touchpoints](#10-cross-module-touchpoints)
11. [Drop-off risks and UX responses](#11-drop-off-risks-and-ux-responses)
12. [UX and copy guidance specific to the merchant](#12-ux-and-copy-guidance-specific-to-the-merchant)

---

## 1. Persona snapshot

### Who the YIIVA merchant is

A South African creative entrepreneur — fashion designer, beauty brand founder, streetwear creator, ceramicist, jeweller. They sell through Instagram DMs, WhatsApp, sometimes a Shopify store, occasionally at pop-up markets. They make beautiful things. They are **not** technology operators — most don't have a developer, a marketing person, or a logistics manager. It's typically the founder running everything themselves.

They've heard of YIIVA from another creator, a podcast, an Instagram ad, or a friend in the industry. They arrive on the platform with a mix of curiosity and skepticism: *"Is this another tool that's going to take a cut and give me nothing back?"*

The bar to win them over is **trust + simplicity**. They've been let down by platforms before — confusing fee structures, unanswered support tickets, pivots that broke their workflow. YIIVA needs to feel different from the first screen.

### What they want

In the merchant's words:
- *"I just want to sell my product without spending five hours a week chasing logistics."*
- *"I want one place where my orders, payments, and shipping are sorted."*
- *"I want my brand story to matter, not get drowned out by big retailers."*
- *"I want to keep my margins. The fee has to be worth it."*

In product terms, they want:
- A professional sales channel that doesn't require technical setup
- An audience already curated for South African creative brands
- Reliable payments and delivery without juggling multiple tools
- Visibility on their orders and revenue

The thing that makes them choose YIIVA over a Shopify store or staying on Instagram is **discovery + integration**. Shopify gives them a storefront but not buyers. Instagram gives them buyers but not a checkout. YIIVA is supposed to give them both.

### Their tech-savvy level

Treat the merchant as a **non-technical small-business operator**. They are intelligent, motivated, and capable, but they don't know what a "JWT" or "PATCH endpoint" or "cents-as-integer" is. They will not read docs. They expect things to work the way Instagram and Shopify work, because those are their reference points.

This means:
- **No jargon in the UI.** Never show "DRAFT" or "PENDING_REVIEW" status names without translating them ("Setting up", "Under review").
- **No internal codes.** ZAR cents → display as `R 249.00`, never `24900`.
- **No "click here to submit your application for review by the admin team"** — say *"Submit for review."*
- **Errors must be actionable.** Not *"Validation failed for field bankBranchCode"* but *"Branch code is required — find it on your bank's website if you're not sure."*

### Their emotional state on day one

They are a creator about to put their work in front of strangers. Every form field feels like a judgment. The setup wizard is asking them to trust YIIVA with bank details, business registration, brand story. The two-gate review process is asking them to wait while strangers decide if their brand is "good enough."

This emotional reality shapes every UX decision in this journey. **Reassurance, never gatekeeping.** Even when we have to say no (rejection, missing requirements), we say it as a colleague, not as a judge.

### Their success metric

Their success: a **live store with their first order**. Not a perfectly polished profile, not a maximum-features setup — just a live store that's earning them money.

YIIVA's success metric for this persona: **time from registration to first order**. Every screen in the merchant journey should be evaluated against whether it shortens that time or extends it.

---

## 2. The journey at a glance

### The six phases

```
Phase 1: Discovery + signup        (5–10 minutes)
   ↓
Phase 2: Onboarding to DRAFT       (30 minutes – multiple sessions over days)
   ↓
Phase 3: Submission + first review (1 day of effort + 2–3 days waiting)
   ↓
Phase 4: Approved + building       (1–4 weeks — the longest phase)
   ↓
Phase 5: Go-live request + review  (1 day of effort + 2–3 days waiting)
   ↓
Phase 6: Live + ongoing operations (variable — first orders + daily ops)
```

### Estimated time to live store

| Path | Duration | Notes |
|---|---|---|
| Best case | ~7 days | Merchant has all info ready, products photographed, banks themself, no rejections |
| Realistic case | ~3–4 weeks | Real-world: photographing 7 products, refining bio, fixing one rejection, etc. |
| Pessimistic | ~6–8 weeks | Multiple rejections, loss of momentum, life intervening |

The **business cost of long onboarding** is dropout. Every extra day between intent ("I want to sell") and outcome ("I made a sale") increases the chance the merchant abandons the platform. The UX bar is to make every phase as fast as possible without compromising the quality bar that protects buyers.

### Where merchants typically drop off

Based on similar marketplace platforms and the structural points of friction in our flow:

| Drop-off moment | Risk level | Cause |
|---|---|---|
| Mid-setup-wizard | High | Form is long; bank/business reg fields might not be at hand |
| First-review rejection | Medium-high | Feels like a personal "no" if copy is wrong |
| The 7-active-products hurdle | **Very high** | Real photography time, multiple sessions; momentum is critical here |
| Go-live rejection | Medium | They expected to launch; being told "not yet" is deflating |
| Post-go-live with no orders | Medium | The platform owes them discovery — out of scope here, but real |

Section [§11](#11-drop-off-risks-and-ux-responses) covers each in detail.

### The three milestone moments

These are the explicit celebration points in the merchant journey. **Treat them as moments**, not background state changes:

1. **First admin approval** — the BUYER → MERCHANT moment. They've been validated as a legitimate brand on the platform.
2. **First product activated** — they've published their first item. Their store has substance.
3. **Store going live** — they're discoverable to buyers. The actual launch.

Frontend should mark each with a celebratory toast or one-time modal (see the relevant phase below).

---

## 3. Phase 1 — Discovery and signup

### What's happening

The merchant lands on the YIIVA web app via a marketing link, a referral, or a search. They click "Become a seller" or similar. They go through registration, verify their email, and reach the merchant web app for the first time.

**Entry point:** the YIIVA marketing site (out of scope) routes them to the merchant web app with `?intent=sell` or directly to `/register`.

### What the merchant feels

Cautious optimism. They want to know:
- *"Will this take long?"*
- *"What information do they need from me?"*
- *"Can I see what other brands look like before I commit?"*
- *"Is there a free trial / no-commitment way to look around?"*

### Screens involved

Cross-reference: [auth flows §2.1 Registration](./auth-frontend-flows.md#21-registration--register) → [auth flows §2.2 Check your email](./auth-frontend-flows.md#22-check-your-email-handoff) → [auth flows §2.3 Email verification landing](./auth-frontend-flows.md#23-email-verification-landing--authverify-email) → [auth flows §3.2 First-time user onboarding](./auth-frontend-flows.md#32-first-time-user-onboarding).

### The journey moments

**Registration form (5 minutes):**
- The form is short — name, email, password, optional phone. This is deliberately the lightest registration we can build.
- The merchant might pause at "phone" — show that it's optional clearly. They don't want to give it if they don't have to.
- Password rules are visible live. Don't make them guess.

**"Check your inbox" handoff:**
- This is the first place the merchant could lose patience. *"I'm here to sell, why am I waiting for an email?"*
- Provide a clear sense of what comes next ("We've sent a link to {email}. Click it to activate."). Set the 24-hour expectation.
- The known limitation: if the email doesn't arrive, recovery is via support contact (see [auth flows §2.2](./auth-frontend-flows.md#22-check-your-email-handoff)). Surface this gently — don't let them get stuck.

**Email verification landing:**
- One click → they're in. The auto-login pattern is right; make them wait 30 seconds for the redirect to feel like a victory, not a delay.

**First login on the merchant web app:**
- They land as a `BUYER` with no store. The post-login routing matrix sends them to the onboarding screen (see [auth flows §3.2](./auth-frontend-flows.md#32-first-time-user-onboarding)).
- This first impression is critical. Show them YIIVA's value proposition concisely:

  > *"Welcome, {firstName}. Ready to start selling on YIIVA? Set up your store, list your products, and start reaching buyers across South Africa."*

- One primary action: **"Start my store"**. One secondary text link: **"I'm just looking around"** that explains this is the seller dashboard and points buyers to the consumer mobile app.

### Phase-1 success looks like

- The merchant clicks "Start my store" within 1 minute of landing on the onboarding screen.
- They feel: *"OK, this is for me. Let me set things up."*

### Failure modes

- They register but don't verify their email. **Recovery: support contact** (no resend endpoint in v1 — flagged for backend follow-up).
- They land on the onboarding screen and bounce. **Mitigation:** the welcome copy must communicate value before asking for action. Mention the audience ("buyers across South Africa"), the speed ("set up in minutes"), and the brand-led positioning ("home for SA creative brands").

---

## 4. Phase 2 — Onboarding to DRAFT

### What's happening

The merchant clicks "Start my store" and creates the store record. They then enter the **setup wizard** — the longest single screen in the merchant journey. They fill in details across multiple sessions (often 3–7 days from store creation to submission).

### What the merchant feels

A mix of excitement and overwhelm. *"This is real now."* The form is asking for things they may not have at hand:
- Bank details: they need to dig out their account number and branch code
- Business registration: they need their CIPC certificate
- Brand story: they need to write something coherent about their journey

This is the phase where **the merchant most needs the system to be patient with them**. They will save partial progress, leave, come back tomorrow.

### Screens involved

- [Store flows §2.1 Onboarding handoff](./store-frontend-flows.md#21-onboarding-handoff-buyer--start-a-store) — the initial create-store action
- [Store flows §2.2 Store setup wizard](./store-frontend-flows.md#22-store-setup-wizard-draft) — the bulk of this phase

### The journey moments

**Creating the store (1 minute):**
- Two fields: company name + display name. The wizard explains the difference (*"Registered company name (from CIPC)"* vs *"Brand name (what buyers will see)"*). Get this right or merchants get confused later.
- After 201, the user lands inside the setup wizard for that store. No interstitial screen — the transition is immediate.

**The setup wizard — incremental sessions (30+ minutes total, spread over days):**

The wizard is sectioned (Brand identity, Contact, Business registration, Payout, Media). Each section autosaves on blur. The merchant fills in what they have, leaves, comes back to fill in more.

**Per-section emotional reality:**

| Section | Merchant's emotional state |
|---|---|
| Brand identity (companyName, displayName, description, story) | Comfortable — this is their story to tell |
| Contact | Easy — it's their email and phone |
| Business registration | Annoying — they have to dig out paperwork |
| Payout (bank details) | **Sensitive** — they need to feel safe entering this |
| Media (logo, banner) | Variable — depends if they have files ready |

**Save-as-you-go reassurance:**
- The "Saved" indicator after each field change is the single most important UX element in this phase. Without it, the merchant doesn't trust they can leave and come back.
- Show it explicitly. Not just a green dot — small grey text: *"Saved 2 seconds ago"* next to each section title.
- If save fails, it must be visible. Don't silently swallow errors.

**Bank details specifically:**
- This is where merchants get nervous. The screen needs to communicate:
  - YIIVA uses these to pay them out, not to charge them
  - The data is masked after entry (account number shows as `**** **** 5678`)
  - They can edit later if they make a mistake

  Concrete copy: *"We use these details to pay out your earnings. Make sure they're accurate."*

  See [store flows §8 Bank details masking](./store-frontend-flows.md#bank-details-masking-and-confirm-on-edit).

**Image upload moments:**
- Logo and banner are the only images required at this phase (banner is optional for first submission, required for go-live).
- Image upload happens via cloud storage; the merchant doesn't see the technical handoff. They drag a file → preview → "Saved." See [store flows §7.3](./store-frontend-flows.md#73-image-upload--cloud-storage-first-patch-the-url-second).
- Many merchants will upload Instagram-quality images that aren't optimized for product display. **Don't reject them silently.** If the image is too low-res, surface a warning *"This logo might look pixelated on buyer screens — try a higher-res image"* but don't block submission.

### Phase-2 success looks like

- The merchant returns to the wizard 2–4 times over a few days
- Each return, they make visible progress (more sections complete in the side nav)
- The 11 required fields for submission are all filled in
- They click "Submit for review" with confidence

### Failure modes

- **The wizard feels endless.** Mitigation: the section nav shows progress (`3 / 4 sections complete`); the submit button activates only when all 11 required fields are done. The merchant can see the finish line.
- **Bank details panic.** Mitigation: copy that emphasizes payouts (not charges); masking on display; click-to-reveal with focus-loss re-mask (see [store flows §8](./store-frontend-flows.md#bank-details-masking-and-confirm-on-edit)).
- **Lost work.** Mitigation: autosave per field; never block navigation with "are you sure?"; never dump unsaved work.
- **Unclear required fields.** Mitigation: visual cues on required vs optional; the submit button surfacing the missing-field count.

---

## 5. Phase 3 — Submission and the first review

### What's happening

The merchant clicks "Submit for review" and enters the first waiting state. An admin reviews their application and either approves it (Phase 4) or rejects it with feedback (back to Phase 2 with corrections).

### What the merchant feels

**Submission anxiety.** They've done the work, now they're waiting for someone else's verdict. The 2–3 day wait is going to feel longer than it is.

If approved: relief and excitement. *"I'm in."*

If rejected: deflation. *"Did I do something wrong?"* The wording of the rejection determines whether they fix and resubmit or quietly leave.

### Screens involved

- [Store flows §2.3 Submission and validation feedback](./store-frontend-flows.md#23-submission-and-validation-feedback) — the submit action
- [Store flows §2.4 First-review waiting state and rejection recovery](./store-frontend-flows.md#24-first-review-waiting-state-and-rejection-recovery) — the wait + rejection branches

### The journey moments

**The submit confirmation modal:**
- This is the merchant's last chance to back out. Make the consequence clear without scaring them: *"Once you submit, you won't be able to edit your store until the review is complete."*
- The 2–3 day expectation belongs here too. Set it before they're already waiting.

**The under-review status page (waiting):**
- The merchant will refresh this page repeatedly the first day, then less the second day, then maybe once on day three.
- The page needs to:
  1. Confirm their submission was received (timestamp, "Submitted X ago")
  2. Set the wait expectation ("Reviews usually take 2–3 business days")
  3. Tell them what happens next ("We'll email you")
  4. Show them what they sent (read-only access to the wizard fields)

  Each of these reduces their anxiety incrementally.

- **Polling cadence:** refetch on tab focus, not aggressively. They don't want a spinner running all day.

**The approval moment (best case):**

This is the **first milestone** of the merchant journey. When the merchant's `/auth/me` returns `role: 'MERCHANT'` and `store.status: 'APPROVED'`:

- Smooth transition from the under-review page to the merchant dashboard.
- Show a one-time modal or banner:

  > *"Welcome to YIIVA, {firstName}!*
  > *Your store has been approved. You're now a YIIVA merchant.*
  > *Next: add your products and request to go live."*

- Track that they've seen this modal (localStorage key) — never show it twice.

**The rejection moment (less common but high-impact):**

When `store.status: 'DRAFT'` AND `rejectionReason` is set:

- The merchant sees the setup wizard again — but with a **rejection banner** at the top.
- The banner shows the admin's feedback verbatim (see [store flows §2.4](./store-frontend-flows.md#24-first-review-waiting-state-and-rejection-recovery)).
- **Tone in the banner copy is constructive**: *"Your application needs changes"*, not *"Your application was denied"*. This isn't sugar-coating — it's accurate. The merchant has real recourse: edit and resubmit. See [store flows §2.4 — DRAFT + rejectionReason](./store-frontend-flows.md#draft--rejectionreason--rejection-recovery).
- The banner clears as soon as the merchant edits any field — they're addressing the feedback. (See [store flows §7.2 RejectionReason banner persistence](./store-frontend-flows.md#72-rejectionreason-banner-persistence).)

### Phase-3 success looks like

- A high majority of submissions get approved on the first review (admin-team curation determines the actual threshold — out of scope here).
- Of those rejected, most fix and resubmit within a week. **Track this metric** — a low resubmission rate is a strong signal that the rejection copy is failing.
- Treat these as heuristics; revisit specific thresholds after 30 days of real data.

### Failure modes

- **The wait kills momentum.** The 2–3 days are real and unavoidable, but a merchant who logs in and sees nothing new will start to wonder if they're being ignored. Mitigation: a small dynamic timestamp ("Submitted 2 days ago — usually approved within 1 more day") — gentle pressure-release.
- **Rejection feels like a "no."** The constructive rejection-copy guidance and the recovery flow design are the mitigation. See [store flows §6.4](./store-frontend-flows.md#64-reject-a-store-with-copy-guidance) for the admin-side rejection-template guidance that powers the rejection text.
- **Repeated rejections.** Each cycle uses the same submit endpoint. After 2–3 cycles, the merchant is at risk of giving up. Worth tracking and intervening (e.g., admin reaches out personally on the 3rd rejection — out of scope for v1, but flag).

---

## 6. Phase 4 — Approved and building toward go-live

### What's happening

The merchant is approved. They're now a `MERCHANT` with an `APPROVED` store. They have full dashboard access. **But buyers can't see them yet** — the store stays invisible until it passes the second review (go-live).

This phase is **the longest and highest-risk phase of the journey**. The merchant has to:
- Add at least 7 active products (each requiring photos, descriptions, prices, categories, variants)
- Add a banner image
- Write a brand story (if they didn't already)
- Add at least one address

Then they request go-live.

### What the merchant feels

Initial high → grind → completion.

The first 24 hours after approval, the merchant is energized. They want to add products immediately. They might add 2–3 in the first day.

Then the grind sets in. *"I have to photograph 4 more products. The lighting in my apartment is bad. I'll do it tomorrow."* Days pass. Maybe a week.

By day 7–10, the merchant is at the highest drop-off risk. Mitigations matter here.

### Screens involved

- [Store flows §2.5 Approved — preparing for go-live](./store-frontend-flows.md#25-approved--preparing-for-go-live) — the readiness checklist
- [Product flows §2 Inventory table](./product-frontend-flows.md#2-merchant--inventory-table)
- [Product flows §3 Create product](./product-frontend-flows.md#3-merchant--create-product)
- [Product flows §4 Product editor](./product-frontend-flows.md#4-merchant--product-editor)
- [Product flows §5 Activation flow](./product-frontend-flows.md#5-activation-flow)

### The journey moments

**Day 1 — the role upgrade and dashboard tour:**

The merchant's first time on the dashboard as a `MERCHANT`. The screen needs to:
1. Acknowledge the approval (the celebratory modal from Phase 3)
2. Show the **go-live readiness checklist** front and centre:

  ```
  Get ready to go live

  ✓ Brand basics (logo, description, contact)
  ✓ Bank details
  ✓ Business registration
  ☐ Banner image                              [Add banner]
  ☐ Brand story                              [Write story]
  ☐ At least one location                    [Add location]
  ☐ At least 7 active products (0 / 7)       [Add products]

  [ Request go-live ]  (disabled until all complete)
  ```

3. Make the next action obvious: **"Add your first product."**

The checklist is critical infrastructure for this phase. It's the merchant's compass for what to do next. See [store flows §2.5](./store-frontend-flows.md#25-approved--preparing-for-go-live).

**The first product (high-energy, low-friction wanted):**

The merchant clicks "Add products" → "+ Add product" → fills in the minimum (title, price) → 201 → directly into the editor.

The editor experience matters for Day 1 because:
- They're learning the tool
- They're not sure what's required vs optional
- Their photos may not be perfect

UX response:
- The editor's **activation readiness panel** (see [product flows §5.1](./product-frontend-flows.md#51-pre-activation-readiness-panel)) is the per-product equivalent of the store-level readiness checklist. It tells them what's needed: title, price > 0, at least one image, at least one category.
- The readiness panel is **always visible** in the side nav. The merchant always knows how close they are to publishing.

**The first product activated (milestone two):**

When the merchant clicks "Activate" and the response is 200, this is the **second milestone**. Mark it:

> *"Your first product is live!*
> *6 more to go before you can request to go live yourself."*

This frames the next-step expectation immediately — they've achieved one thing, here's what's next.

**Products 2 through 6 — the grind:**

This is where momentum matters most. UX response:
- The inventory table shows progress visibly: a small banner at the top *"3 of 7 products active. Keep going."*
- Each product activation shows the same progress: *"That's 4 out of 7."*
- At 6 of 7: *"One more product and you can request to go live."*

This isn't gamification — it's clear progress signaling. Merchants who can see their progress are more likely to keep going.

**The seventh active product (almost-celebration):**

When the merchant activates their 7th product, the dashboard's go-live readiness checklist updates: ✓ At least 7 active products. The "Request go-live" button activates if all other requirements are met.

A small celebration here is warranted, but **don't auto-trigger go-live** — the merchant might want to:
- Add a few more products before launching
- Time their launch with a marketing push
- Polish existing products further

So show:

> *"You've reached 7 active products! You can now request to go live whenever you're ready."*

…with the activated "Request go-live" button visible. Their choice.

**Banner, story, addresses — the polish moments:**

These are usually quicker than products:
- Banner: one image upload, see [store flows §7.3](./store-frontend-flows.md#73-image-upload--cloud-storage-first-patch-the-url-second)
- Story: a textarea, the helper text frames it (*"Tell buyers about your journey, what you stand for, what makes your brand special"*)
- Address: simple form, see [store flows §3.1](./store-frontend-flows.md#31-add-an-address)

If the merchant has been delaying these, the readiness checklist nudges them. Each ☐ becomes a ✓ as they complete it.

### Phase-4 success looks like

- The merchant adds their first product within a day or two of approval (high engagement on Day 1 carrying over).
- They reach 7 active products within 2–4 weeks (the realistic window — this is the longest phase).
- They click "Request go-live" within 3–5 weeks of approval.
- These are heuristics, not commitments. Track real data and revisit thresholds after launch.

### Failure modes

- **Product photography paralysis.** Real-world: the merchant doesn't have studio-quality photos. They put off creating products because they think the photos must be perfect. Mitigation: the editor's activation contract requires *"at least one image"* — not "high-quality images." Soft guidance only ("Higher-resolution images look better in search"); never block.
- **The grind drop-off.** Day 7–10 is the danger zone. Mitigation: a re-engagement email at day 5 if they have <3 active products. This is a Notifications-module concern, out of scope for v1, but flag.
- **Confusion about activation.** *"I added a product, why isn't it showing in my catalog?"* If they didn't activate, they don't know. Mitigation: the inventory table's status pill (DRAFT in grey, ACTIVE in green) is the first answer. Hover tooltip on DRAFT pill: *"This product isn't published yet. Click [Activate] to publish."*
- **Hitting the activation contract on the first try.** A merchant fills in title, price, uploads one image, and hits Activate. They miss "at least one platform category." Mitigation: the activation readiness panel shows ✗ next to the missing requirement before they click — they can see what's missing without trying first. See [product flows §5.1](./product-frontend-flows.md#51-pre-activation-readiness-panel).

---

## 7. Phase 5 — Go-live request and final review

### What's happening

The merchant clicks "Request go-live" → enters the second waiting state → admin reviews → approves (Phase 6) or rejects (back to Phase 4 with feedback).

### What the merchant feels

Submission anxiety, round two. They've worked hard for this. The waiting feels even longer because they can see the finish line.

### Screens involved

- [Store flows §2.6 Request go-live](./store-frontend-flows.md#26-request-go-live) — the request action
- [Store flows §2.7 Final-review waiting state and rejection recovery](./store-frontend-flows.md#27-final-review-waiting-state-and-go-live-rejection-recovery) — the wait + rejection branches

### The journey moments

**The "Request go-live" click:**
- The button has been there for days, increasingly available as the merchant completed each requirement. By the time they click, they've thought about it.
- The confirmation modal sets the same expectations as first-review submission: 2–3 day wait, no edits during review.
- After 200, the dashboard transitions to the "Final review in progress" state.

**The final-review waiting state:**

Almost identical UX to the first-review wait, but the copy reflects this is the *final* gate:

> *"Your store is in final review.*
> *We're checking that your store is ready to be seen by buyers. Reviews usually take 2–3 business days. As soon as we approve, your store will go live."*

The merchant feels closer than ever to their goal. They might check the page more often — that's fine, the polling is on focus only.

**The go-live approval (third milestone):**

When `store.status: 'ACTIVE'`, this is the **third and biggest milestone**. The merchant's store is now visible to buyers. Mark it:

> *"Your store is live!*
> *Buyers can now find {displayName} on YIIVA.*
> *Share your store URL: {PUBLIC_STORE_URL_BASE}/{slug}*
> *[ Copy link ] [ Share on Instagram ]"*

The "Share on Instagram" CTA leverages the merchant's existing audience. Many YIIVA merchants come from Instagram — pre-launch teasing on their own social is the most effective discovery channel for them. Helping them push the announcement is helping them succeed.

The modal should be track-as-seen so it doesn't repeat. See [store flows §2.8](./store-frontend-flows.md#28-active--live-store).

**The go-live rejection (less common):**

When `store.status: 'APPROVED'` AND `rejectionReason` is set (after a go-live rejection):

- The merchant returns to the dashboard. The go-live readiness checklist is still there.
- A **rejection banner** at the top shows the admin's feedback. Critical UX rule:

  > **The banner does NOT auto-clear when the merchant edits a field.** Per the [store flows §7.2](./store-frontend-flows.md#72-rejectionreason-banner-persistence), the rejectionReason field is only cleared when the merchant calls `request-go-live` again.

  The banner copy makes this expected: *"This message will go away when you request go-live again."*

- The merchant fixes the issue, then clicks "Request go-live" again. The cycle resumes.

**Repeated go-live rejections:**

A merchant who gets two go-live rejections in a row is at high risk of disengagement. The first rejection feels actionable. The second one feels like *"why won't you let me sell?"*

Mitigation: admin-team intervention. If the same merchant has been rejected twice at go-live, the admin should reach out personally (email, call) to walk through what's needed. Out of scope for v1, but the data is there to power it.

### Phase-5 success looks like

- A high majority of go-live requests are approved on the first try — the per-product activation contract has already filtered out most issues, leaving only store-level polish (banner quality, story tone) for admins to flag.
- Of those rejected, most fix and re-request within a week.
- Treat as heuristics; revisit specific thresholds after 30 days of real data.

### Failure modes

- **The wait, again.** Same mitigations as Phase 3.
- **The "but I did everything!" rejection.** When a merchant has worked hard, hitting a rejection at the very end is bruising. Admin rejection-copy must be even more constructive than first-review (see [store flows §6.8 — Reject go-live](./store-frontend-flows.md#68-reject-go-live)).
- **Confusion about the rejection-banner persistence.** The merchant edits to fix the feedback, the banner stays, they assume the system is broken. Mitigation: the banner copy explicitly tells them how to clear it.

---

## 8. Phase 6 — Live operations (light)

### What's happening

The merchant's store is `ACTIVE`. Buyers can find them. They're managing day-to-day: editing existing products, adding new ones, possibly inviting team members, eventually receiving and fulfilling orders.

> **Scope note:** order management is the bulk of "live operations" but lives in the order module — out of scope for this doc and the current flows docs. Once the order module ships its frontend-flows doc, link from here.

### What the merchant feels

Pride and uncertainty. *"My store is live. Now what?"*

The platform owes them discovery. If a week passes with zero orders, the merchant starts to question whether YIIVA is delivering on its promise. Marketing, social-media features, content posts (also out of scope here) all play into this.

### Screens involved

- [Store flows §2.8 ACTIVE — live store](./store-frontend-flows.md#28-active--live-store) — the live dashboard
- [Product flows §2–§9](./product-frontend-flows.md) — ongoing product management

### The journey moments

**Day 1 of being live:**
- The celebration modal (one-time)
- The "Share your store URL" prompt
- Encouragement to push the announcement on social

**Day 2 onwards:**
- Dashboard shows the same readiness checklist except all checkmarked, plus operational metrics (followers, views — when those are wired up)
- The merchant edits products freely (`PATCH` works on `ACTIVE` products)
- They can add more products without constraint
- They might invite a teammate (see [store flows §4 Employee management](./store-frontend-flows.md#4-employee-management-owner-side))

**Inviting a teammate:**

A merchant who's been live for a few weeks may want to bring on help (a sister, an assistant, a freelance social-media manager).

- The "Team" section becomes accessible after `APPROVED`
- The merchant sends an invite via email
- Cross-reference [`employee-journey.md`](./employee-journey.md) for the recipient experience

### Phase-6 success looks like

- The merchant is editing products weekly (small content updates, new product additions)
- They're not anxious; they're operating
- When the order module ships, they're equipped to receive their first sale

### Failure modes

- **Zero orders.** Real, but mostly an "out-of-product-flow" concern (discovery, marketing). Within this doc's scope: ensure the dashboard surfaces useful metrics (followers count, profile views) so the merchant feels engaged even before orders come.
- **Stale store.** A merchant who lets their store go a month without updates feels like a forgotten brand. Mitigation: gentle nudges (*"You haven't added a new product in 30 days — buyers love fresh content"*) — out of scope for v1, but the data structure supports it.

---

## 9. Edge moments across the journey

### 9.1 Account suspension or deactivation

If an admin suspends the merchant's account (different from suspending their *store* — see [§9.5](#95-store-suspension)), the merchant gets kicked on their next API call.

- **Their experience:** mid-action (uploading an image, editing a product), they get a *"Your account is no longer active"* full-screen takeover with a support-contact link.
- **Frontend behaviour:** see [auth flows §4.1](./auth-frontend-flows.md#41-account-suspendeddeactivated-mid-session). Don't attempt silent refresh on this 401; clear state and show the takeover.
- **Tone:** factual, low-blame. The merchant might think it's a mistake. Direct them to support.

### 9.2 Multi-device merchant

The merchant works on the dashboard from their laptop and phone. They have the wizard open in two tabs sometimes.

- **Refetch on tab focus** is the v1 strategy (see [store flows §7.4](./store-frontend-flows.md#74-multi-tab-merchant-setup)).
- Last-write-wins on autosave. Acceptable trade-off.
- For high-stakes data (bank details), consider a brief debounce + confirmation when the field has been edited within the last 60 seconds in another tab — but this is a future enhancement, not v1.

### 9.3 Forgotten password during onboarding

A merchant who hasn't logged in for a few days might forget their password. They go through forgot-password → reset → log back in → continue from where they left off.

- The store is intact (the DB has it), the wizard reflects all their previous progress
- The "Saved" state from days ago is still there
- See [auth flows §2.5–§2.6](./auth-frontend-flows.md#25-forgot-password--forgot-password) for the reset flow

### 9.4 Mid-session sign-out and return

The merchant signs out (intentional or via session expiry) and returns later. They sign back in.

- **The post-login routing matrix** ([auth flows §3](./auth-frontend-flows.md#3-post-login-routing-matrix)) takes them to the right phase based on their current `role × store.status × rejectionReason`.
- They never lose their place. The dashboard's "Continue setup" or "Add more products" prompt picks up exactly where they left off.

### 9.5 Store suspension

If an admin suspends the merchant's store (`store.status: 'SUSPENDED'`):

- **Currently aspirational** — no admin endpoint sets this state in v1 (see [store flows §2.9](./store-frontend-flows.md#29-suspended--closed--read-only-states))
- When the feature ships: read-only dashboard, no actions available, support contact prominent
- The merchant remains a `MERCHANT` (role isn't downgraded) but can't operate the store

### 9.6 Forgotten store

A merchant who creates a store, fills in some details, and disappears for months. Their `DRAFT` store sits in the database.

- **No automatic deletion** — the store stays
- When they return, log in → routing matrix → they land back in the setup wizard with all previous data intact
- The wizard treats them as a returning user; no special "welcome back" modal needed (it would feel patronising)

---

## 10. Cross-module touchpoints

The merchant journey spans three module APIs. The most important interactions:

### 10.1 Auth × Store: the role upgrade timing

When the admin approves a store, the merchant's `role` in the database flips from `BUYER` to `MERCHANT`. But the merchant's currently-issued JWT access token still has `role: 'BUYER'` until the next refresh.

**Backend mitigation:** `JwtStrategy.validate()` reads the `role` from the database on every request, not from the JWT payload. So backend authz checks already work correctly.

**Frontend mitigation:** the merchant's local `user.role` (in React context / Zustand) is still `BUYER` because the access token says so. **Refetch `/auth/me`** when the merchant might have just been approved (e.g., on tab focus while in `PENDING_REVIEW`).

See [auth flows §3.1](./auth-frontend-flows.md#31-the-matrix) for the routing matrix that re-renders after the refetch.

### 10.2 Store × Product: the gating

Products can only be created on stores in `APPROVED`, `PENDING_GO_LIVE`, or `ACTIVE`. The product module enforces this server-side ([product flows §11.2](./product-frontend-flows.md#112-activation-gate-vs-editor-open--whats-enabled-when)).

**Frontend implication:** in Phase 2 (`DRAFT` store), the "Products" navigation item should either be hidden or disabled with a tooltip *"Available after your store is approved."* Don't let the merchant click into a 403.

### 10.3 Store × Notifications (when built)

Currently, all transactional emails (registration verification, password reset, store approval, store rejection, go-live approval, go-live rejection, employee invite) are sent server-side. The merchant doesn't see them in-app — they arrive in their inbox.

**Future:** when the notifications module ships, in-app notifications (a bell icon with unread count) become possible. The frontend can subscribe to merchant-specific events. Not in scope for v1.

### 10.4 Auth × Store: rejection-banner persistence

Asymmetric rule between DRAFT and APPROVED states (see [store flows §7.2](./store-frontend-flows.md#72-rejectionreason-banner-persistence)):

- DRAFT + rejectionReason → banner clears on any field edit (autosave triggers it)
- APPROVED + rejectionReason → banner stays until `request-go-live` is called again

This is the most subtle UX rule in the merchant journey. Frontend devs MUST handle it correctly.

---

## 11. Drop-off risks and UX responses

| Risk | Phase | Severity | Mitigation in this doc / flows |
|---|---|---|---|
| Merchant doesn't verify email | 1 | Medium | [Auth flows §2.2 known limitation callout](./auth-frontend-flows.md#22-check-your-email-handoff) — recovery is via support; flag for backend resend endpoint |
| Setup wizard slog | 2 | High | Section nav with progress, autosave, save-failure visibility, always-visible submit button |
| Bank details panic | 2 | Medium | Masking, click-to-reveal, "we use these to pay you out" copy |
| Lost work | 2 | Low (mitigated by autosave) | No "are you sure?" dialogs, no blocking modals on navigation |
| First-review wait | 3 | Medium | Status page with timestamp, expectation copy, polling on focus only |
| First-review rejection | 3 | High | Constructive admin-rejection copy; banner-clears-on-edit; same submit endpoint for resubmission |
| **The 7-product hurdle** | 4 | **Very high** | Per-product readiness panel; live progress on inventory table; celebration at activation; gentle re-engagement nudges (when notifications built) |
| Photography paralysis | 4 | Medium | Soft warnings only on low-res images; never block on quality |
| Activation confusion | 4 | Medium | Status pills with colour coding; tooltips on DRAFT pill; readiness panel always visible |
| Go-live request misunderstanding | 5 | Low | Confirmation modal explaining edits-blocked-during-review |
| Go-live wait | 5 | Medium | Same patterns as first-review wait |
| Go-live rejection | 5 | High | Constructive admin copy; banner-stays-until-resubmit explained in copy |
| Repeated rejections | 3 + 5 | Medium-high (data-flagged) | Admin-team intervention (out of scope for v1) |
| Post-go-live silence | 6 | High (out of scope) | Discovery features in product/order modules; social-share CTAs at go-live; followers/views surfaced on dashboard |

The **single highest-leverage drop-off point** is the 7-product hurdle in Phase 4. UX investment here pays off the most.

---

## 12. UX and copy guidance specific to the merchant

### Voice and tone

The merchant is a creator running their own small business. Talk to them like a colleague who's slightly more familiar with the platform than they are.

**Do:**
- *"Welcome back, {firstName}."*
- *"You're 4 products away from going live."*
- *"Your store is under review. Usually 2–3 days."*

**Don't:**
- *"User authentication successful."*
- *"Submission accepted. Awaiting administrative review."*
- *"Your application has been received. Our team will respond in due course."*

### Celebrate milestones explicitly

The three milestone moments — first approval, first product activated, store goes live — should each have a one-time UI moment. Don't bury them in toasts that disappear in 3 seconds. Use modals or persistent cards that the merchant can dismiss when they're ready.

### Status-page anxiety reduction

For both waiting states (`PENDING_REVIEW`, `PENDING_GO_LIVE`):

- **Always show the timestamp** ("Submitted X ago" + absolute date)
- **Always set the expectation** ("Reviews usually take 2–3 business days")
- **Always tell them what's next** ("We'll email you")
- **Never use indeterminate language** ("Awaiting review", "In queue") — these elevate anxiety

### Never make the merchant feel small

YIIVA's positioning is "infrastructure for the next generation of creative brands." The UI should feel like it's serving them, not gatekeeping them.

| Don't say | Say instead |
|---|---|
| "Your application is being processed by an administrator." | "We're reviewing your store. Usually 2–3 days." |
| "You are not authorized to perform this action." | "You can do this once your store is approved." |
| "Please ensure all required fields are completed." | "Add the missing details below to submit." |
| "Your application has been declined." | "Your application needs changes." |
| "Your store has been suspended due to violation of platform terms." | "Your store has been temporarily suspended. Contact support to resolve." |

### Copy for the three milestones

**Milestone 1 — First approval:**

> *Welcome to YIIVA, {firstName}.*
>
> *Your store has been approved. You're now a YIIVA merchant.*
>
> *Next: add at least 7 active products and request to go live so buyers can find you.*

**Milestone 2 — First product activated:**

> *Your first product is live. {firstProductTitle} is ready for buyers to see.*
>
> *Add 6 more products to unlock go-live.*

**Milestone 3 — Store goes live:**

> *Your store is live.*
>
> *Buyers can now find {displayName} on YIIVA.*
>
> *Share your store URL with your followers: {PUBLIC_STORE_URL_BASE}/{slug}*
>
> *[ Copy link ]*

### Configuration values used in copy

The example copy throughout this doc references `support@yiiva.co.za` as the support contact and `{PUBLIC_STORE_URL_BASE}/{slug}` as the public store URL pattern. **Treat both as placeholders** — confirm with the team and pull from frontend config (e.g., `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PUBLIC_STORE_URL_BASE`). See the same callouts in [`auth-frontend-flows.md` §1](./auth-frontend-flows.md#1-context) and [`store-frontend-flows.md` §1](./store-frontend-flows.md#1-context).

---

## Closing note

This journey is the merchant's path from "I want to sell" to "I'm running a live store on YIIVA." Every screen, every error message, every wait state should be evaluated against one question:

**Is this making the merchant's path to their first order shorter, or longer?**

If a UX decision shortens it without compromising buyer trust, ship it. If it lengthens it, push back. The merchant is YIIVA's most important user — their success is the platform's success.
