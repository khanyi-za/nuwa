# YIIVA Policy Register

> Operating and compliance policy decisions, with the date, what each policy
> requires in practice, and where it is enforced. Started 2026-08-11 during
> the Paystack live-mode KYC preparation (companion:
> `docs/paystack-kyc-responses.md`). Add new entries at the top of §1;
> never delete — supersede with a dated note.
>
> Why this file matters: several of these policies are **referenced in
> written answers to Paystack's compliance team**. They are commitments, not
> aspirations — operating differently from what this register says creates
> real risk with our payment provider.

---

## §1 Adopted policies

### P-1 · Manual CIPC-check Enhanced Due Diligence — ADOPTED 2026-08-11

**Decision (owner-confirmed):** every merchant store review includes a manual
Enhanced Due Diligence check before approval.

**Procedure (run by the reviewing admin, ~5 min per application):**
1. Verify the submitted CIPC registration number against the free public
   CIPC/BizPortal search: the entity exists, is in business, and the legal
   name matches the store's `companyName`.
2. On any inconsistency (name mismatch, unverifiable entity) or elevated-risk
   signal: require the director's SA ID/passport and proof of bank account
   before approval — or decline the application (rejection reason recorded).
3. Bank-account-to-entity match is delegated to Paystack: payouts only ever
   go to the Paystack-verified subaccount (see P-2).
4. Ongoing: transaction reconciliation against Paystack records; immediate
   suspension (existing admin tooling) where fraud or policy violations are
   suspected.

**Enforcement point:** the human PENDING_REVIEW → APPROVED gate (admin store
review). No code change required; a review-UI checklist item is a nice-to-have.

**Referenced in:** Paystack KYC Q2.

### P-2 · Payout account required before go-live — ADOPTED 2026-08-11

**Decision (owner-confirmed):** a store is not approved to go live until its
Paystack subaccount is configured (`Store.paystackSubaccountCode` set via the
athena Settings → "Automatic payouts" flow).

**Effect:** every trading merchant is on direct flat multi-split settlement —
the merchant's share (subtotal − commission) goes from the buyer's charge,
through Paystack, straight to the merchant's verified bank on the standard
T+1 cycle. YIIVA never takes custody of merchant funds. The graceful-
degradation fallback (share parks on YIIVA's main balance for manual payout)
becomes a dead path for all new merchants.

**Enforcement point:** the human PENDING_GO_LIVE → ACTIVE gate (admin
go-live review).

**Caveats (logged in STATUS.md 2026-08-11):**
- The admin review UI does not yet surface payout `configured` — until the
  small nuwa+athena follow-up ships, the admin verifies via the store's
  settings or the DB.
- Demo-era ACTIVE stores predate this policy — grandfather them through the
  payout settings flow before any real traffic. Production starts from an
  empty DB, so every real merchant hits the gate from day one.

**Referenced in:** Paystack KYC Q3 ("every merchant must have a
Paystack-verified subaccount before their store is approved to trade").

### P-3 · Registered businesses only — PRE-EXISTING, reaffirmed 2026-08-11

The onboarding wizard and server-side submission check require a CIPC company
registration number — unregistered sole traders cannot sell on YIIVA. This
was already enforced in code (`store.service.ts` submit validation); the KYC
submission elevates it to stated policy. Relaxing it later (e.g. for informal
traders) would contradict the Paystack submission — treat any such product
change as a compliance conversation first.

**Referenced in:** Paystack KYC Q1, Q2.

### P-4 · No escrow, no discretionary fund release — ARCHITECTURAL STANCE, stated 2026-08-11

Settlement is never conditional on fulfilment, buyer confirmation, or any
platform decision. The split is fixed inside the transaction at time of
charge; nobody at YIIVA can accelerate, delay, or redirect a merchant's
settlement. **Do not build** delivery-contingent holds, payout approval
queues, or platform wallets — any future feature shaped like "hold the money
until X" re-opens the fund-custody question the entire KYC submission is
built to close, and likely requires TPPP-adjacent licensing.

**Referenced in:** Paystack KYC Q3–Q6.

### P-5 · Refunds: platform-funded, proactive; clawback is manual ops — PRE-EXISTING (PS-3, 2026-07-22), extended 2026-08-11

- Refunds pull from YIIVA's main Paystack balance (Paystack default on split
  transactions); recovering the merchant's share is a manual commercial
  process (net off a future payout or invoice). Automate only if refund
  volume warrants it.
- **Extended in the KYC submission (Q7):** YIIVA adjudicates unresolved
  disputes and refunds legitimately aggrieved buyers proactively — without
  requiring merchant cooperation — in preference to letting issues become
  chargebacks. Merchants who generate repeated disputes are suspended.

**Referenced in:** Paystack KYC Q4, Q5, Q7.

### P-6 · Merchant bank-detail minimization — PRE-EXISTING (Phase 6 design), stated 2026-08-11

Merchant bank details are held by Paystack (subaccount); nuwa persists only
the subaccount code, bank display name, and account last-4. Keep it that way —
it is both a security posture and a compliance talking point.

---

## §2 Claim boundaries — things we must NOT say we do

Established while drafting the KYC answers. These are honesty boundaries for
any future communication with Paystack (or any regulator/partner):

- **No sanctions/PEP screening.** Not performed, never claimed. If Paystack
  or volume growth requires it, that is a build/buy decision (affordable SA
  APIs exist) — decide it before claiming it.
- **No automated CIPC registry integration.** The P-1 check is manual, done
  by a human during review. Say "we verify against the CIPC public registry",
  never "automated verification".
- **No ID-document collection as standard.** Director ID + proof of bank is
  the P-1 escalation path for flagged applications, not a universal
  requirement. Don't overstate it.
- **The manual-payout fallback is not mentioned externally.** Under P-2 it is
  a dead code path; describing it in compliance contexts only invites
  confusion about fund custody.

## §3 Discussed but NOT adopted (parked)

- **Formal written "Merchant Onboarding & Due Diligence Policy" PDF** — offer
  stands; draft it if Paystack asks for a documented policy (P-1/P-2/P-3 are
  its contents).
- **Sanctions/PEP screening** — parked until required (see §2).
- **Code-level enforcement of P-2** (a guard on the go-live review endpoint
  checking `paystackSubaccountCode`) — deliberate follow-up, not required
  while the gate is human-operated.

## §4 Follow-up checklist created by the KYC work

Mirrors `paystack-kyc-responses.md` §2 — tracked here because these outlive
the submission:

- [ ] Surface payout-account `configured` on the admin store review view
      (nuwa: expose on admin store detail; athena: show in review UI).
- [ ] Grandfather pre-policy ACTIVE stores through the payout settings flow
      before real traffic.
- [ ] Public Returns & Refunds policy page (30-day window + process already
      enforced in code; Q4/Q7 call it "our published returns policy").
- [ ] Dedicated public support contact (e.g. support@yiiva.co.za).
- [ ] Fix stale copy: `maya/docs/about_yiiva.md` still says "powered by
      PayFast".
- [ ] Optional: review-UI checklist item for the P-1 CIPC check.
