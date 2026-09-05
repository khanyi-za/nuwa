# Paystack KYC — YIIVA Responses

> Prepared 2026-08-11 for Paystack's live-mode business activation review.
> §1 is the submission-ready text — paste each answer under the matching
> question. §2 is INTERNAL ONLY (adopted policies + follow-ups) — do not send.
>
> Consistency rule: these seven answers are written as one story — merchants
> are vetted (Q1–Q2), funds are never held or controlled by the platform
> (Q3–Q6), and disputes are resolved on-platform before they can become
> chargebacks (Q7). If Paystack asks follow-ups, keep to the same vocabulary:
> "multi-split at time of charge", "verified subaccount", "standard T+1
> settlement", "no platform-side payout process".

---

## §1 Submission-ready answers

### Q1 — What details of the KYC information do you collect from the people that sign up on your platform?

YIIVA is a curated marketplace and we apply significantly more scrutiny to
merchants (the recipients of funds) than to buyers.

**Merchants:** Before a store can be submitted for approval, our platform
requires — and enforces at the system level — the following: the registered
legal entity name, the CIPC company registration number, VAT number where
applicable, the owner's full name, verified email address and phone number, a
physical contact point, and the business's South African bank account details
(bank, account number, branch code, account type). Merchant payout accounts
are created as Paystack subaccounts, so bank account details are additionally
validated through Paystack's own account-resolution and first-payout
verification.

Every merchant application is then **manually reviewed by our admin team**
before the store is approved, and a second manual review is performed before
the store goes live to buyers. Stores cannot list products publicly or receive
orders without passing both reviews. Non-compliant stores can be rejected
(with reasons) or suspended at any time.

**Buyers:** We collect full name, a verified email address, phone number, and
delivery address. Buyers pay via Paystack's hosted checkout, so card data
never touches our systems.

### Q2 — What type of Enhanced Due Diligence do you carry out on the individuals signing up on your platform?

YIIVA takes a risk-based approach, and our marketplace is deliberately curated
rather than open — merchant volume is low and every merchant is individually
known to us.

**Standard due diligence (all merchants):** the requirements described in our
previous answer (CIPC registration number, legal entity name, owner identity
and verified contact details, South African bank account), followed by manual
review by our team. We only onboard registered South African businesses —
unregistered individuals cannot sell on the platform.

**Enhanced measures:** During review we verify the provided CIPC registration
number against the CIPC public registry to confirm the entity exists and
matches the stated legal name. Merchant bank accounts are established as
Paystack subaccounts, which means every payout account passes Paystack's
account resolution and first-payout verification — funds can only ever settle
to a bank account verified as belonging to the merchant. Where we identify
inconsistencies or elevated risk (e.g. name mismatches, unverifiable
registration), we require the director's identity document and proof of bank
account before approval, or decline the application.

**Ongoing monitoring:** every transaction on the platform is reconciled
against Paystack records, all payment events are retained in an immutable
audit log, and our admin tooling supports immediate suspension of a merchant —
including halting their ability to receive orders — where fraud or policy
violations are suspected.

### Q3 — How long are funds held?

They are not held — neither by YIIVA nor on behalf of merchants — beyond
Paystack's standard settlement cycle.

YIIVA is built on Paystack's subaccount and multi-split architecture
specifically so that the platform never takes custody of merchant funds. Every
merchant must have a Paystack-verified subaccount before their store is
approved to trade. At checkout, each transaction carries a split that
allocates the merchant's share directly to their subaccount; Paystack settles
it to the merchant's bank account on the normal T+1 settlement cycle. The
platform's commission settles to YIIVA's own account on the same cycle.

There is no escrow period and no delivery-contingent hold: settlement is not
conditional on fulfilment, buyer confirmation, or any platform decision.

### Q4 — What event releases them? Who decides when they are released, the platform or the buyer?

The release event is the successful payment itself. Neither the platform nor
the buyer makes any release decision.

Each transaction is created with a Paystack multi-split that allocates the
merchant's share to their verified subaccount and the platform's commission to
YIIVA's account at the moment of charge. Settlement then follows Paystack's
standard T+1 cycle automatically. There is no delivery-confirmation trigger,
no buyer approval step, and no platform-side payout approval — no one at YIIVA
can accelerate, delay, or redirect a merchant's settlement, because the
allocation is fixed within the transaction before settlement occurs.

Where an order is subsequently cancelled or disputed, the remedy is a refund
through Paystack's refund API (initiated from the platform's admin tooling
under our published returns policy) — not a withheld release, since no funds
are ever held pending release.

### Q5 — Is the release of funds automatic, or does the platform decide?

Fully automatic. Settlement is executed by Paystack on its standard T+1
cycle, according to the split defined within each transaction at the time of
charge. There is no platform-side payout process, approval queue, or manual
step of any kind — YIIVA has no mechanism to decide on, initiate, or withhold
the release of merchant funds. The only money movement the platform can
initiate is a refund to the buyer via Paystack's refund API, governed by our
returns policy.

### Q6 — Where does the money sit while it is held?

At no point do funds sit with YIIVA. Between the buyer's charge and
settlement, funds are within Paystack's own settlement infrastructure, exactly
as for any standard Paystack transaction. At settlement (standard T+1), the
transaction's split executes: the merchant's share is deposited directly into
the merchant's own verified bank account, and the platform's commission is
deposited into YIIVA's account.

The only funds that ever rest in a YIIVA-controlled account are YIIVA's own
revenue — the platform commission and shipping cost recovery. We maintain no
wallet, stored balance, or ledger of merchant funds, and merchant money never
passes through an account we control.

### Q7 — How do you manage disputes from customers on the platform?

Disputes are handled through a layered, in-platform process designed to
resolve issues long before they become payment disputes:

1. **Cancellation** — buyers can cancel an order in-app before dispatch;
   cancelled orders are refunded via Paystack.
2. **Direct resolution** — the platform includes built-in buyer–merchant
   messaging on every order, keeping resolution (and its record) on-platform.
3. **Returns** — buyers submit return requests in-app within 30 days of
   delivery; merchants process them through a structured workflow (approve,
   reject with reason, parcel received, settle) with system-enforced windows
   and statuses.
4. **Platform adjudication** — where a merchant fails to resolve an issue,
   YIIVA's support team adjudicates and can execute a full or partial refund
   to the buyer directly through Paystack's refund API, without requiring the
   merchant's cooperation. Refunds are funded from the platform's own balance,
   so the buyer's remedy is never dependent on the merchant.
5. **Evidence** — every order carries a complete audit trail: payment events,
   stage-by-stage courier tracking (The Courier Guy), and PIN-confirmed
   delivery captured by the courier at handover. This allows us to resolve
   delivery disputes with objective evidence and to respond promptly with
   documentation to any chargeback enquiry.

Our policy is to refund legitimately aggrieved buyers proactively rather than
allow issues to escalate into chargebacks, and merchants who generate repeated
disputes are subject to suspension from the platform.

---

## §2 INTERNAL — adopted policies + follow-ups (do not send)

These answers rest on two operating policies the owner formally adopted on
2026-08-11 (also recorded in STATUS.md). They must actually be run:

1. **Manual CIPC-check EDD** — at every store review, verify the CIPC number
   against the public CIPC/BizPortal search (entity exists, in business, legal
   name matches). On mismatch or elevated risk: require director ID + proof of
   bank account before approval, or decline.
2. **Payout-account-before-go-live** — go-live approval requires the store's
   Paystack subaccount to be configured (`Store.paystackSubaccountCode` set).
   Every trading merchant is therefore on direct split settlement.

Claims deliberately NOT made (do not make them in follow-ups either):
- No sanctions/PEP screening — we don't do it. If Paystack requires it,
  that's a real build/buy conversation.
- No automated CIPC registry integration — the check is manual.
- The manual-payout fallback for unconfigured stores (dead path under policy
  2) is not mentioned anywhere — keep it that way.

Follow-ups created by this submission:
- [ ] Surface payout-account `configured` status on the admin store review
      view (small nuwa + athena change) so policy 2 is checkable in-UI.
- [ ] Grandfather any pre-policy ACTIVE store through the payout settings
      flow before real traffic (prod DB starts empty — moot for launch).
- [x] Public Returns & Refunds policy page — BUILT 2026-09-04 at
      `yiiva-final-landing/src/app/returns-refunds/page.tsx` (+ footer link);
      live at https://yiiva.co.za/returns-refunds once the landing repo's
      pending work is committed and pushed (Vercel).
- [ ] Dedicated public support contact — support@yiiva.co.za is now published
      on the Returns page; the MAILBOX/forwarding still needs to be created
      at the domain's email host (owner errand) or the address bounces.
- [ ] Fix stale copy: `maya/docs/about_yiiva.md` still says payments are
      "powered by PayFast".

---

## §3 Test login details — submission-ready reply (prepared 2026-09-04)

> Response to Paystack's request: "Kindly share the test login details for us
> to review your website." Paste the block below. Consistent with §1's
> vocabulary. The credentials belong to a dedicated review account that will
> be deactivated once the review concludes.

Thank you — please find our review access details below.

**Context:** YIIVA is currently in pre-launch. The merchant side of the
platform runs on the web, and the buyer marketplace is our mobile app
(currently in internal distribution ahead of its store release). Payments run
in test mode pending this activation, so the full checkout can be exercised
end-to-end with Paystack's standard test card.

**1. Merchant platform (web) — https://merchant.yiiva.co.za**

- Email: paystack.review@yiiva.co.za
- Password: RAE9qjGUaqlhWXD9SJXzPJgR

This account operates "Yiiva Demo Store", a demonstration store owned by our
own registered entity (Khaziimla Technology (Pty) Ltd). Logging in shows the
full merchant experience: catalogue and inventory management, sales and
returns handling, earnings, and — under Settings → Automatic payouts — the
store's verified Paystack subaccount, which is how every trading merchant on
YIIVA receives their share via a split defined at time of charge (per our
earlier answers: standard T+1 settlement, no platform-side payout process).

**2. Buyer marketplace (Android app)**

Install link (open on an Android device, or scan the QR on the page):
https://expo.dev/accounts/yiiva/projects/yiiva-app/builds/70c2ed0a-513d-4399-8c90-cd4312acc4df

You can register a buyer account in-app with any email address (a 6-digit
verification code is emailed). Browse the demo store, add to cart, and check
out — payment is taken through Paystack's hosted checkout in test mode; the
standard test card 4084 0840 8408 4081 (any future expiry, CVV 408) completes
the purchase. Refunds and cancellations are likewise live in test mode.

**3. Public site** — https://yiiva.co.za (marketing/landing).

The review login above is a dedicated account created for this review; we
will deactivate it once your review is complete. If the app install link
expires before you get to it, let us know and we will refresh it same-day.

> INTERNAL (do not send): the install link's APK artifact expires 2026-09-17
> — rebuild with `npx eas-cli build -p android --profile preview` in maya if
> needed. Teardown after review: deactivate the user + archive the store
> (see auto-memory `paystack-review-account`).
