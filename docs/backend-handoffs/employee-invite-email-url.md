# Backend handoff — Employee invite email URL

**Scope:** one-line template change. The employee invite email links to the wrong frontend path.

## Symptom

Recipient clicks the link in their invite email → lands on **404**.

URL in the email today:
```
{MERCHANT_APP_URL_BASE}/employees/invite?token=<rawToken>
```

Frontend route doesn't exist at that path.

## Canonical URL

Per `docs/Api-frontend-contracts/employee-journey.md` §3 and `auth-frontend-flows.md` §2.8:

```
{MERCHANT_APP_URL_BASE}/invites/accept?token=<rawToken>
```

That's the path the frontend invite-validation + accept screen lives at, and what `auth-frontend-flows` references throughout.

## Required change

In the invite email template (server-side), change the link target from `/employees/invite?token=` to `/invites/accept?token=`. Token query param shape unchanged.

## Verification

Trigger a new invite from any merchant account → check the inbox → confirm the link reads `{base}/invites/accept?token=...` and clicking lands on the branded validation screen (not 404).

## Frontend safety net

The frontend now ships a redirect shim at `/employees/invite` that forwards `?token=...` to `/invites/accept?token=...` so any in-flight or already-sent emails keep working. Once the template is fixed, the shim is dead code on the happy path — keep it as a backstop for any future drift or for emails that may have been sent before the fix.
