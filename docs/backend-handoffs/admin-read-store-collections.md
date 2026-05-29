# Backend handoff — Admin read access to merchant collections

**Scope:** small authz change. Let `ADMIN` users call `GET /stores/:storeId/collections` against any store. Same pattern as the admin-read-store-products change you already shipped.

**Why now:** the admin launch-review screen's product detail modal lists the collections each product belongs to (Collections gate activation per the M10 pivot, so they're useful context). The admin can now click a collection chip to drill into its description, cover image, and product count. The drill-down calls `GET /stores/:storeId/collections` and picks the matching row — but the endpoint is owner-only today, so the admin's call 403s.

**Frontend status:** Frontend handles the 403 with a graceful fallback Alert ("Couldn't load this collection's details from the admin account. The merchant has it linked as `{name}`."), so the modal still opens and the admin sees the basics. Once this lands the call succeeds and the modal renders cover, description, slug, product count, and creation date.

---

## What to change

Update the authz check on `GET /stores/:storeId/collections` to additionally allow `user.role === 'ADMIN'`.

Same pattern as the products handoff:

```ts
// before
if (!(await canManageStore(userId, storeId))) {
  throw new ForbiddenException("You do not have permission to manage this store")
}

// after
if (user.role !== 'ADMIN' && !(await canManageStore(userId, storeId))) {
  throw new ForbiddenException("You do not have permission to manage this store")
}
```

Apply only to the **GET** (list) endpoint. **Do not** open up the mutation endpoints (`POST` / `PATCH` / `DELETE`, product-link endpoints). Admins should only read merchant collections during review, not modify them.

### Response shape

Unchanged. Same response the merchant gets:

```json
{
  "data": [
    {
      "id": "string",
      "storeId": "string",
      "name": "string",
      "slug": "string",
      "description": "string | null",
      "imageUrl": "string | null",
      "sortOrder": 0,
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "_count": { "products": 12 }
    }
  ]
}
```

The frontend's existing `getCollections` + `collectionSchema` parser handle it as-is.

### Authz order

Prefer ADMIN-allow short-circuit BEFORE the `canManageStore` lookup so we avoid an unnecessary DB hit for admin reads — same pattern as the products handoff (now documented in the spec doc as the canonical approach for admin reads).

---

## Verification

```bash
ADMIN_TOKEN="<admin_jwt>"
MERCHANT_STORE_ID="<some_merchant_store_id>"
BASE="http://localhost:3001"

# Expect 200 with the merchant's collections
curl "$BASE/stores/$MERCHANT_STORE_ID/collections" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Sanity: admins cannot create collections on someone else's store
curl -X POST "$BASE/stores/$MERCHANT_STORE_ID/collections" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test"}'
# Expect 403
```

---

## Frontend cleanup after this ships

The graceful 403 Alert in `components/admin/review-collection-modal.tsx` becomes dead code on the happy path. Keep it as a defensive fallback for the rare network failure (cheap), or drop it.

---

## Out of scope

- Admin write access to merchant collections — not requested, not safe.
- Per-collection product list endpoint (`GET /stores/:storeId/collections/:collectionId/products`) — we just show the count for now. If admins need the per-collection product list in future, they can filter the existing `GET /stores/:storeId/products?collectionId=...` endpoint (which the products handoff already opened up to admins).
- Admin-side bulk operations.

---

## Spec doc update suggestion

`docs/Api-frontend-contracts/product-module-api.md` already has the "Admin read access (May 2026)" section (§118) covering the products GETs. When you ship this, extend that section to mention `GET /stores/:storeId/collections` as well, or add a similar one-paragraph note near the collections endpoint header (§741). The authz pattern is identical — one consolidated mention keeps the spec tidy.
