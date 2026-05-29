# Backend handoff — Merchant collections pivot

**Scope:** three coordinated changes that align the backend with M10's collections-first merchant journey. Frontend is fully built; these changes unlock end-to-end testing.

**Context:** The merchant journey pivoted in M10. During pre-go-live setup, merchants now organise products into **their own collections** (Summer 2026, Sale, Featured) rather than picking from the admin's **platform categories**. Platform categories become an admin-side concern post-go-live (bulk-assigned to active products from a future inventory dashboard — out of M10 scope).

The product editor no longer surfaces a Categories section. The activation contract was rewritten frontend-side: "≥1 category" → "≥1 collection".

---

## 1. Drop "≥1 category" from product activation

Today the activation endpoint enforces 5 requirements; one of them is "the product must be linked to at least one platform category." That assumption no longer holds — the merchant has no UI surface to set categories during this phase, and the journey doc treats categorisation as a post-go-live activity.

### Required change

`POST /stores/:storeId/products/:productId/activate` should **either**:

- **Option A (recommended)**: drop the category requirement entirely. Replace with "≥1 collection" — the product must be linked to at least one of the store's collections. If 0 collections, return:

  ```
  400 Bad Request
  message: [
    "Product must be in at least one collection to activate.",
    // ... other missing requirements
  ]
  ```

- **Option B**: drop the category requirement entirely without replacement. Trust the frontend's 5-item readiness panel as the canonical contract.

**Frontend preference: Option A.** The frontend's `ActivationReadinessPanel` already gates the activate button on `product.collections.length >= 1`. Mirroring that on the backend keeps the contract symmetric and lets the multi-error 400 response surface useful guidance.

The other 4 activation requirements (title, price > 0, ≥1 image, variant prices > 0 or null) stay as-is.

### Migration impact

Any product currently in DB with `categories.length === 0` would have been blocked from activation by the old rule. After this change, those products can activate **if** they have ≥1 collection. No DB migration required — this is a pure validation change.

---

## 2. Add `GET /stores/:storeId/collections` (merchant endpoint)

Per `product-frontend-flows.md` §9 there's a documented limitation: no merchant endpoint exists for listing collections. The frontend currently maintains a `localStorage`-backed cache populated by create/update calls.

This works during a single browser session, but breaks on:
- Fresh device (different browser/laptop)
- Cleared site data
- Multi-tab inconsistency

### Required change

Add `GET /stores/:storeId/collections`.

**Protected. Store owner or active accepted employee.**

Returns the store's collections, ordered by `sortOrder` then `name`. The response should include `_count.products` so the frontend can show "12 products" badges without an extra round-trip.

**Success — `200`**
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

**Errors**

| Status | Cause |
|---|---|
| `403` | Not owner or active employee, or store doesn't exist (enumeration prevention) |

### Frontend follow-up after this lands

Once this endpoint ships, the frontend's `hooks/use-collections.ts` will switch its `queryFn` to call the new endpoint. The localStorage cache becomes a degraded-mode fallback (offline / network failure). The change is a one-line swap in the hook — consumers don't need to know.

---

## 3. Enforce "last collection on ACTIVE" rule

Activation requires ≥1 collection. So removing the only collection from an ACTIVE product should be blocked, matching the existing "last image on ACTIVE" pattern on the image endpoints.

### Required change

`DELETE /collections/:collectionId/products/:productId` should reject the unlink when:

- The target product's status is `ACTIVE`, AND
- After this removal, the product would have zero collections

**Suggested response:**
```
400 Bad Request
message: "Cannot remove the last collection from an active product. Add another collection first, or archive the product."
```

For non-ACTIVE products (DRAFT, OUT_OF_STOCK, ARCHIVED), allow the unlink unconditionally.

### Frontend handling

The frontend pre-empts this client-side: the `×` button on a collection chip is disabled on ACTIVE products with only 1 collection. The backend response is a defensive fallback for race conditions (e.g., two tabs operating on the same product). The frontend already classifies this 400 and surfaces the recovery copy inline — see `components/products/sections/collections-section.tsx` `handleRemove`.

---

## Verification recipe

```bash
TOKEN="<merchant_jwt>"
STORE_ID="<store_id>"
PRODUCT_ID="<product_id>"  # in DRAFT
BASE="http://localhost:3001"

# 1. Create a collection
curl -X POST "$BASE/stores/$STORE_ID/collections" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Summer 2026"}'
# capture the returned id as $COLLECTION_ID

# 2. Link the product to the collection
curl -X POST "$BASE/collections/$COLLECTION_ID/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN"

# 3. Activate the product (assuming title, price, image, variants all satisfied)
curl -X POST "$BASE/stores/$STORE_ID/products/$PRODUCT_ID/activate" \
  -H "Authorization: Bearer $TOKEN"
# Expect 200 — should succeed even if the product has 0 categories

# 4. Try to unlink the only collection — expect 400
curl -X DELETE "$BASE/collections/$COLLECTION_ID/products/$PRODUCT_ID" \
  -H "Authorization: Bearer $TOKEN"
# Expect 400 with the "last collection" message

# 5. Confirm the list endpoint works
curl "$BASE/stores/$STORE_ID/collections" \
  -H "Authorization: Bearer $TOKEN"
# Expect 200 with the collection returned, _count.products = 1
```

---

## Spec is updated

`docs/Api-frontend-contracts/product-frontend-flows.md` §5.1 — activation contract reflects the new requirement set.
`docs/Api-frontend-contracts/product-module-api.md` — should be updated alongside this work to document the new `GET` endpoint and the last-collection rule. Will land as a follow-up doc update once the backend changes ship.

---

## Frontend status

All three changes are unblocked frontend-side:

- **Activation pivot**: `ActivationReadinessPanel` already gates on `≥1 collection`. The multi-error 400 banner at the top of the editor will surface backend's new missing-requirements list correctly.
- **List endpoint**: `hooks/use-collections.ts` queryFn is a one-line swap. Today it reads `getCachedCollections(storeId)`; will become `(await apiFetch(...)).data`.
- **Last-collection rule**: client-side guard is in place; backend response is a defensive backstop for race conditions.
