# Backend handoff — Cloudinary upload signing missing `source=uw`

**Scope:** 1-line fix in the Cloudinary signature endpoint. Unblocks every image/video upload from the merchant web app.

**Symptom captured during M1–M8 testing:** every upload fails with `401 Invalid Signature` from Cloudinary. Frontend can't proceed past any of: store logo, store banner, product image, product video, collection image, category image.

---

## What's happening

The frontend uses Cloudinary's Upload Widget (via `next-cloudinary`'s `<CldUploadWidget>`). The widget automatically injects a `source=uw` form parameter into every upload request — Cloudinary uses it as a provenance tag for "this came from the upload widget".

Cloudinary **includes that param in signature verification**. Because the backend's current signing logic only hashes `folder + timestamp + upload_preset`, the signature it returns doesn't match what Cloudinary expects, and the upload is rejected.

The error response from Cloudinary is explicit about what *should* have been signed:

```
HTTP 401 Unauthorized
x-cld-error: Invalid Signature d550c053e83b826a5e759cfc574c2e48a3963670.
              String to sign - 'folder=stores/cmpl48h7f000emhw40koyx96v/logo&source=uw&timestamp=1779779613&upload_preset=store_logo'.
```

Note the `&source=uw&` between `folder` and `timestamp`. Our backend currently produces a signature for `folder=...&timestamp=...&upload_preset=...` (no `source=uw`).

---

## The fix

In the signature endpoint's signing logic, add `source=uw` to the sorted, ampersand-joined string-to-sign — **always**.

### Before (current)

```ts
// pseudocode — match to your actual implementation
const paramsToSign = {
  folder,
  timestamp,
  upload_preset,
}
const stringToSign = Object.keys(paramsToSign)
  .sort()
  .map((k) => `${k}=${paramsToSign[k]}`)
  .join('&')
// folder=...&timestamp=...&upload_preset=...

const signature = sha1(stringToSign + CLOUDINARY_API_SECRET)
```

### After

```ts
const paramsToSign = {
  folder,
  source: 'uw',           // ← add
  timestamp,
  upload_preset,
}
const stringToSign = Object.keys(paramsToSign)
  .sort()
  .map((k) => `${k}=${paramsToSign[k]}`)
  .join('&')
// folder=...&source=uw&timestamp=...&upload_preset=...

const signature = sha1(stringToSign + CLOUDINARY_API_SECRET)
```

The response body shape is **unchanged** — frontend still receives `{ signature, timestamp, apiKey, cloudName, preset, folder, resourceType }`. Only the value of `signature` differs.

---

## Why "always" rather than conditional

All current YIIVA uploads go through the widget. Cloudinary's upload widget *always* sends `source=uw` regardless of context — image, video, single, chunked. Conditional signing would require the frontend to flag "I'm a widget" in the request body, which adds complexity for zero gain.

If a future non-widget upload path is added (server-to-server migration script, mobile native upload, etc.), that caller has two clean options:

- Send `source=uw` themselves (cheap; matches what the widget does)
- Send a `widgetSource: false` flag in the signature request body, and the backend conditionally drops `source=uw` from the string-to-sign

Either is fine. For v1, **always sign `source=uw`** is the simplest correct option.

---

## Verifying the fix

After deploying, the frontend will retry from `POST /uploads/cloudinary-signature` → widget upload → 200 from Cloudinary. The Cloudinary response should land in the widget's `onSuccess` callback and the merchant sees their logo preview.

### Manual cURL verification

You can reproduce the widget's exact signing inputs without the frontend. Generate a signature locally, then make a multipart upload with `source=uw`:

```bash
# 1. Compute expected signature (Node REPL)
const crypto = require('crypto')
const params = 'folder=stores/TESTSTORE/logo&source=uw&timestamp=1779779613&upload_preset=store_logo'
const secret = process.env.CLOUDINARY_API_SECRET
const sig = crypto.createHash('sha1').update(params + secret).digest('hex')
console.log(sig)

# 2. Upload via cURL with that signature
curl -X POST https://api.cloudinary.com/v1_1/yiiva-dev/image/upload \
  -F file=@./test.jpg \
  -F api_key=<your_api_key> \
  -F timestamp=1779779613 \
  -F folder=stores/TESTSTORE/logo \
  -F upload_preset=store_logo \
  -F source=uw \
  -F signature=<sig_from_step_1>
```

Should return `200` with `secure_url`. If it returns `401`, check that:

- `source=uw` appears alphabetically between `folder` and `timestamp` in the string-to-sign
- Param values match exactly (no URL-encoding differences, no extra whitespace)
- The signature is `sha1(stringToSign + secret)`, not HMAC

---

## Where this matters in code

- `lib/schemas/uploads.ts` — frontend schema, unchanged
- `lib/api/uploads.ts` — frontend client, unchanged
- `components/media-uploader.tsx` — frontend widget wrapper, unchanged after this fix
- Backend `uploads.service.ts` (or equivalent) — **one-line change** in the signing function

---

## Spec is updated

`docs/Api-frontend-contracts/uploads-module-api.md` §"What gets signed" now reflects this. The example string-to-sign explicitly includes `source=uw` in alphabetical position, and a callout explains why.

---

## Next.js v6-related followup (not blocking this fix)

`@cloudinary-util/url-loader` drops a `string` `uploadSignature` and only forwards `Function` values. Frontend now passes a callback wrapper around the pre-computed signature — see `components/media-uploader.tsx` `uploadSignatureCallback`. No backend change needed. Noted here so the next dev who reads the spec doesn't try to reintroduce a string `uploadSignature` and watch the upload silently submit as unsigned.

---

## Chunked uploads (deferred)

When `product_video` uploads land, Cloudinary chunks files >100MB. The widget calls the signature callback once per chunk — each chunk wants a fresh signature for its own `paramsToSign`. Pattern A (one pre-computed signature per click) won't cover this.

Recommended approach when video uploads ship:

1. Add a new backend endpoint, e.g. `POST /uploads/cloudinary-widget-signature`, that accepts `{ paramsToSign: Record<string, unknown> }` and signs whatever comes in (after authz check against `uploadContext`).
2. Frontend switches to `<CldUploadWidget signatureEndpoint="/api/uploads/widget-sign" />` and drops the pre-fetch dance.

Not blocking image uploads. Flag this when product video work is on deck.
