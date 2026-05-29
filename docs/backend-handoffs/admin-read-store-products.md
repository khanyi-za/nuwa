# Backend handoff — Admin read access to merchant products

**Scope:** small authz change. Let `ADMIN` users call `GET /stores/:storeId/products` against any store. Unblocks the admin Launch review screen.

**Why now:** the admin's launch-review detail page (frontend: `/admin/go-live/:storeId`) shows a horizontal strip of the merchant's active products so the admin can spot-check catalogue quality before approving. Today the frontend calls `GET /stores/:storeId/products?status=ACTIVE&limit=8` from the admin's session. The endpoint is owner-only (owner OR active accepted employee), so the admin 403s and the strip renders an error — the reviewer can't see what they're approving.

**Frontend status:** Frontend already handles the error gracefully with a fallback message, but the experience is degraded. Once this lands, the existing call works without frontend changes — same endpoint, same shape.

---

## What to change

Update the authz check on `GET /stores/:storeId/products` to additionally allow `user.role === 'ADMIN'`.

Pseudocode:

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

Apply only to the `GET` (list) endpoint. **Do not** open up the mutation endpoints (`POST` / `PATCH` / `DELETE` / activate / archive / images / categories / etc.) — admins should only **read** merchant catalogues during review, not modify them.

`GET /stores/:storeId/products/:productId` (single-product detail) should follow the same pattern — admin read allowed.

### Response shape

Unchanged. Same paginated response shape the merchant gets:

```json
{
  "data": [ProductListItem],
  "meta": { "total", "page", "limit", "totalPages" }
}
```

The frontend's existing `useProducts` hook + `productListItemSchema` parser handle it as-is.

### Edge cases

- **Store doesn't exist** — return `403` (enumeration prevention), same as today.
- **Admin filters by `status=DRAFT` or other**: allowed; admin can inspect any product state.
- **Authz check order**: prefer ADMIN-allow short-circuit BEFORE the `canManageStore` lookup so we avoid an unnecessary DB hit for admin reads.

---

## Verification

```bash
ADMIN_TOKEN="<admin_jwt>"
MERCHANT_STORE_ID="<some_merchant_store_id>"
BASE="http://localhost:3001"

# Expect 200 with the merchant's catalogue
curl "$BASE/stores/$MERCHANT_STORE_ID/products?status=ACTIVE&limit=8" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Sanity: admins cannot create products on someone else's store (mutations stay locked)
curl -X POST "$BASE/stores/$MERCHANT_STORE_ID/products" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Test","priceInCents":100}'
# Expect 403
```

---

## Frontend cleanup after this ships

Drop the amber error message in `components/admin/review-go-live-detail.tsx` — the call will succeed cleanly. Or keep it as a defensive fallback for the rare network failure (cheap).

---

## Out of scope

- Admin write access to merchant resources — not requested, not safe.
- Admin-side bulk listing across stores — separate endpoint if ever needed.
- Per-product category bulk-assign — that's the post-go-live admin tooling we deferred from M10.
