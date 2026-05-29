# YIIVA Store Module — API Contract

> **Audience:** Frontend developers integrating the merchant dashboard and admin panel.
> **Scope:** Merchant and admin frontends only. Consumer-facing endpoints (public store profile, follow/unfollow) are excluded from this document.

---

## Endpoint Summary

| Method | Path | Auth | Who |
|---|---|---|---|
| `GET` | `/stores/me` | Required | Any authenticated user |
| `POST` | `/stores` | Required | Any authenticated user |
| `PATCH` | `/stores/:id` | Required | Owner or active employee |
| `POST` | `/stores/:id/submit` | Required | Owner only |
| `POST` | `/stores/:id/request-go-live` | Required | Owner only (MERCHANT role) |
| `POST` | `/stores/:storeId/addresses` | Required | Owner or active employee |
| `PATCH` | `/stores/:storeId/addresses/:addressId` | Required | Owner or active employee |
| `DELETE` | `/stores/:storeId/addresses/:addressId` | Required | Owner or active employee |
| `POST` | `/stores/:storeId/employees` | Required | Owner only |
| `GET` | `/stores/:storeId/employees` | Required | Owner or active employee |
| `POST` | `/stores/:storeId/employees/:employeeId/resend` | Required | Owner only |
| `POST` | `/stores/:storeId/employees/:employeeId/deactivate` | Required | Owner only |
| `POST` | `/stores/:storeId/employees/:employeeId/reactivate` | Required | Owner only |
| `DELETE` | `/stores/:storeId/employees/:employeeId` | Required | Owner only |
| `GET` | `/employees/invites/validate` | **Public** | Anyone |
| `POST` | `/employees/invites/accept` | Required | Invited user |
| `GET` | `/stores/admin/pending` | Required | ADMIN role |
| `GET` | `/stores/admin/pending-go-live` | Required | ADMIN role |
| `POST` | `/stores/:id/review` | Required | ADMIN role |
| `POST` | `/stores/:id/review-go-live` | Required | ADMIN role |

---

## Error Response Shape

All errors from the backend follow this structure:

```json
{
  "statusCode": 400,
  "message": "string or array of strings",
  "error": "string"
}
```

`message` is an **array of strings** only on `400` validation errors. On all other errors it is a single string.

---

## Rate Limiting

All store endpoints use the global throttle: **100 requests per 60 seconds** per IP. There are no stricter per-endpoint limits on this module. A `429 Too Many Requests` response means the global limit was hit.

---

## Store Lifecycle

Understanding the lifecycle is essential — the available actions at any point depend entirely on `store.status`.

```
DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED ──request-go-live──▶ PENDING_GO_LIVE ──approve──▶ ACTIVE
                        │                          │                                │
                     reject                     reject                           reject
                        │                          │                                │
                      DRAFT                     APPROVED                        APPROVED
                  (with rejectionReason)     (with rejectionReason)          (with rejectionReason)
```

| Status | Who sees it | What's possible |
|---|---|---|
| `DRAFT` | Merchant only | Edit, submit for review |
| `PENDING_REVIEW` | Merchant (read-only), Admin (review queue) | Admin can approve or reject |
| `APPROVED` | Merchant (dashboard access, MERCHANT role granted) | Edit, add products, request go-live |
| `PENDING_GO_LIVE` | Merchant (read-only), Admin (go-live queue) | Admin can approve or reject |
| `ACTIVE` | Everyone (live on platform) | Merchant edits, orders flow |
| `SUSPENDED` | Merchant (read-only) | No actions — contact support |
| `CLOSED` | Merchant (read-only) | No actions |

**Role upgrade:** When a store moves from `PENDING_REVIEW` → `APPROVED`, the owner's `role` changes from `BUYER` to `MERCHANT`. The frontend must call `GET /auth/me` after any admin approval action and update the session state — the JWT in memory still carries the old `BUYER` role until the next refresh.

---

## Permission Model

Two distinct permission levels exist within the store module:

| Operation | Who can perform it |
|---|---|
| Edit store, manage addresses, list employees | Store owner **or** any active accepted employee |
| Submit, request go-live, invite/deactivate/remove employees | Store owner **only** |
| Review applications, review go-live | `ADMIN` role only |

**Note on "view your store":** `GET /stores/me` is owner-scoped — it queries by `ownerId` and returns `null` for users who are not store owners. Employees do not have an equivalent endpoint to discover the store they have access to. Frontends should retain `store.id` from the `POST /employees/invites/accept` response, which returns it (see [Employee Invite Flow](#employee-invite-flow)), and use the per-store endpoints (addresses, employees) directly with that ID.

---

## Shared Response Shapes

### Store Object

Returned by create, update, submit, request-go-live, and most other store responses.

| Field | Type |
|---|---|
| `id` | string |
| `ownerId` | string |
| `companyName` | string |
| `displayName` | string |
| `slug` | string |
| `description` | string \| null |
| `story` | string \| null |
| `websiteUrl` | string \| null |
| `logoUrl` | string \| null |
| `bannerMedia` | `BannerMedia[]` | Multi-media store banner (≤5 items, image + video mix). See [Banner Media Object](#banner-media-object). Replaces the legacy single `bannerUrl` field. |
| `status` | `StoreStatus` |
| `rejectionReason` | string \| null |
| `contactEmail` | string \| null |
| `contactPhone` | string \| null |
| `businessRegNo` | string \| null |
| `vatNumber` | string \| null |
| `bankName` | string \| null |
| `bankAccountNo` | string \| null |
| `bankBranchCode` | string \| null |
| `bankAccountType` | string \| null |
| `totalSales` | number |
| `totalRevenue` | number |
| `averageRating` | number |
| `followerCount` | number |
| `createdAt` | ISO 8601 string |
| `updatedAt` | ISO 8601 string |

### Banner Media Object

A single media item within a store's banner gallery. Stores can have up to 5 of these — any mix of images and videos.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `storeId` | string | |
| `url` | string | Cloudinary `secure_url`. Backend validates the URL prefix matches the configured cloud. |
| `mediaType` | `'IMAGE' \| 'VIDEO'` | |
| `sortOrder` | integer | Ascending; the first item (lowest sortOrder) is the cover. |
| `isPrimary` | boolean | `true` for exactly one item in the gallery when the array is non-empty — the cover used in single-image contexts (search results, admin queue rows, etc.). The first item by sortOrder. |
| `createdAt` | ISO 8601 string | |

**Constraints:**
- Maximum 5 items per store
- When the array is non-empty, exactly one item has `isPrimary: true` (the first by sortOrder)
- `sortOrder` values are normalised by the backend on reorder operations (the array is returned in stable ascending order)

### Store Address Object

| Field | Type |
|---|---|
| `id` | string |
| `storeId` | string |
| `streetNumber` | string |
| `streetName` | string |
| `buildingName` | string \| null |
| `suburb` | string \| null |
| `city` | string |
| `postalCode` | string |
| `createdAt` | ISO 8601 string |
| `updatedAt` | ISO 8601 string |

### Employee Object

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `email` | string | |
| `employeeNumber` | string \| null | |
| `isActive` | boolean | |
| `acceptedAt` | ISO 8601 string \| null | `null` = invite pending |
| `createdAt` | ISO 8601 string | |
| `user` | object \| null | `null` until invite accepted — shape varies by endpoint (see below) |

**`user` shape in `GET /stores/me`:** `{ id, email, firstName, lastName }` — includes email, no avatarUrl.

**`user` shape in `GET /stores/:storeId/employees`:** `{ id, firstName, lastName, avatarUrl }` — includes avatarUrl, no email.

---

## Endpoints

---

### `GET /stores/me`

**Protected. Any authenticated user.**

Returns the authenticated user's full private store view. This is the primary endpoint for populating the merchant dashboard.

**No request body.**

**Success — `200`**

If the user has no store, the response body is `null` — this is a `200 OK` with a `null` body, not a `404`. Always check for null before accessing any store fields.

The `employees` array contains all records where `isActive: true` — this includes **both pending invites and active accepted employees**. Deactivated employees (`isActive: false`) are excluded. For the complete list including deactivated employees, use `GET /stores/:storeId/employees`.

The `_count.products` reflects **all products** regardless of status (DRAFT, ACTIVE, ARCHIVED, etc.).

```json
{
  "id": "string",
  "ownerId": "string",
  "companyName": "string",
  "displayName": "string",
  "slug": "string",
  "status": "DRAFT | PENDING_REVIEW | APPROVED | PENDING_GO_LIVE | ACTIVE | SUSPENDED | CLOSED",
  "rejectionReason": "string | null",
  "description": "string | null",
  "story": "string | null",
  "logoUrl": "string | null",
  "bannerMedia": "BannerMedia[]",
  "websiteUrl": "string | null",
  "contactEmail": "string | null",
  "contactPhone": "string | null",
  "businessRegNo": "string | null",
  "vatNumber": "string | null",
  "bankName": "string | null",
  "bankAccountNo": "string | null",
  "bankBranchCode": "string | null",
  "bankAccountType": "string | null",
  "totalSales": "number",
  "totalRevenue": "number",
  "averageRating": "number",
  "followerCount": "number",
  "createdAt": "ISO 8601 string",
  "updatedAt": "ISO 8601 string",
  "addresses": "StoreAddress[]",
  "employees": "Employee[]",
  "_count": {
    "products": "number",
    "orders": "number",
    "followers": "number"
  }
}
```

---

### `POST /stores`

**Protected. Any authenticated user.**

Creates a new store in `DRAFT` status. One store per user — enforced regardless of existing store status. The user's role remains `BUYER` until the store is approved by an admin.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `companyName` | string | yes | 2–150 chars, must be unique across platform |
| `displayName` | string | yes | 2–100 chars, must be unique across platform |
| `description` | string | no | max 500 chars |
| `story` | string | no | max 2000 chars |
| `contactEmail` | string | no | valid email |
| `contactPhone` | string | no | — |
| `websiteUrl` | string | no | valid URL |

**Success — `201`** — Returns the store object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `409` | `"You already have a store"` | User already owns a store |
| `409` | `"A store with that company name already exists"` | `companyName` taken |
| `409` | `"A store with that display name already exists"` | `displayName` taken |
| `400` | validation errors array | Invalid input |

---

### `PATCH /stores/:id`

**Protected. Store owner or active accepted employee.**

Updates store details. Only `DRAFT`, `APPROVED`, and `ACTIVE` stores can be edited. All fields are optional — only provided fields are updated.

`slug` cannot be set directly — it is always auto-generated from `displayName`. If `displayName` changes, the slug updates automatically.

If a `rejectionReason` exists and the store is in `DRAFT`, it is cleared on any update.

If the store ID does not exist, the response is `403` (not `404`) — this prevents store ID enumeration.

**Request body** — all fields optional

| Field | Type | Rules |
|---|---|---|
| `companyName` | string | 2–150 chars |
| `displayName` | string | 2–100 chars |
| `description` | string | max 500 chars |
| `story` | string | max 2000 chars |
| `websiteUrl` | string | valid URL |
| `logoUrl` | string | valid URL — upload image to cloud storage first, pass the resulting URL here |
| `contactEmail` | string | valid email |
| `contactPhone` | string | — |
| `businessRegNo` | string | — |
| `vatNumber` | string | — |
| `bankName` | string | — |
| `bankAccountNo` | string | — |
| `bankBranchCode` | string | — |
| `bankAccountType` | string | — |

**Success — `200`** — Returns the updated store object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to edit this store"` | Not owner or active employee |
| `400` | `"Store cannot be edited in its current status"` | Store is `PENDING_REVIEW`, `PENDING_GO_LIVE`, `SUSPENDED`, or `CLOSED` |
| `409` | `"A store with that company name already exists"` | `companyName` taken |
| `409` | `"A store with that display name already exists"` | `displayName` taken |

---

### `POST /stores/:id/submit`

**Protected. Store owner only.**

Submits the store for admin review. Moves status `DRAFT` → `PENDING_REVIEW`. All required fields must be populated — the backend validates and returns the complete list of missing fields in a single error so the merchant can fix everything at once.

This endpoint is also used for **re-submission after a rejection** — a store returned to `DRAFT` with a `rejectionReason` can be edited and submitted again via this same endpoint.

**Important:** The backend only explicitly blocks `PENDING_REVIEW`, `ACTIVE`, `SUSPENDED`, and `CLOSED`. It does not block `APPROVED` or `PENDING_GO_LIVE`. The frontend must only show or enable the submit action when `status === "DRAFT"`.

**No request body.**

**Required fields for submission:**
`description`, `logoUrl`, `contactEmail`, `contactPhone`, `businessRegNo`, `bankName`, `bankAccountNo`, `bankBranchCode`, `bankAccountType`

**Success — `200`** — Returns the updated store object with `status: "PENDING_REVIEW"`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to submit this store"` | Not the owner |
| `404` | `"Store not found"` | Store does not exist |
| `400` | `"Store has already been submitted for review"` | Already in `PENDING_REVIEW` |
| `400` | `"Store is already active"` | Already `ACTIVE` |
| `400` | `"Store cannot be submitted in its current status"` | `SUSPENDED` or `CLOSED` |
| `400` | `"The following fields are required before submission: <list>"` | One or more required fields missing |

---

### `POST /stores/:id/request-go-live`

**Protected. `MERCHANT` role. Store owner only.**

Requests the second admin review to move the store from `APPROVED` → live. All missing requirements are returned in a single error.

**No request body.**

**Requirements for go-live** (all must be met):
- All initial submission fields (description, logoUrl, contactEmail, contactPhone, businessRegNo, bankName, bankAccountNo, bankBranchCode, bankAccountType)
- At least one item in `bannerMedia` (image or video)
- `story` populated
- At least one store address added
- At least 7 active products listed

**Success — `200`** — Returns the updated store object with `status: "PENDING_GO_LIVE"`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to request go-live for this store"` | Not the owner |
| `404` | `"Store not found"` | Store does not exist |
| `400` | `"Your store must be approved before requesting to go live. Please submit it for review first."` | Store is `DRAFT` |
| `400` | `"Your store is currently under initial review. Please wait for the review to complete."` | Store is `PENDING_REVIEW` |
| `400` | `"Your store is already in the go-live review queue."` | Store is `PENDING_GO_LIVE` |
| `400` | `"Your store is already live."` | Store is `ACTIVE` |
| `400` | `"Your store is currently suspended and cannot request to go live."` | Store is `SUSPENDED` |
| `400` | `"Your store is closed and cannot request to go live."` | Store is `CLOSED` |
| `400` | `"Cannot request go-live. Missing requirements: <list>"` | One or more requirements not met |

---

## Banner Media

The store banner is a gallery of up to 5 media items — any combination of images and videos. Replaces the legacy single `bannerUrl` field. The first item by `sortOrder` is the cover (used wherever a single image was previously shown — search results, admin queue rows, etc.).

Uploads go through the Cloudinary signing flow with two upload contexts:
- `store_banner` — images (existing context, unchanged limits)
- `store_banner_video` — videos (new context — see `uploads-module-api.md`)

After the upload completes, the frontend posts the resulting `secure_url` + `mediaType` to `POST /stores/:storeId/banner-media`.

---

### `POST /stores/:storeId/banner-media`

**Protected. Store owner or active accepted employee.**

Adds a media item to the store's banner gallery. Rejected when the gallery is already at the 5-item cap.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `url` | string | yes | Cloudinary `secure_url`. Backend validates the URL prefix matches the configured cloud. |
| `mediaType` | `'IMAGE' \| 'VIDEO'` | yes | — |

The item is appended to the end of the gallery (largest `sortOrder + 1`). If the gallery was empty, this item becomes the cover (`isPrimary: true`).

**Success — `201`** — returns the created [BannerMedia](#banner-media-object) object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `400` | `"Banner gallery is at the 5-item limit. Remove an item before adding a new one."` | Gallery full |
| `400` | `"Banner URL must be a Cloudinary secure URL"` | URL prefix mismatch |
| `400` | validation errors | Invalid `mediaType` or missing fields |

---

### `DELETE /stores/:storeId/banner-media/:id`

**Protected. Store owner or active accepted employee.**

Removes a banner item. The remaining items' `sortOrder` values are renumbered so they stay contiguous (0..N-1). If the removed item was the cover, the next item by sortOrder becomes the new cover.

**No request body.**

**Success — `200`**
```json
{ "message": "Banner media removed" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `404` | `"Banner media not found"` | Item does not exist or belongs to a different store |
| `400` | `"At least one banner item is required while the store is in PENDING_GO_LIVE or ACTIVE"` | Removing would violate the readiness invariant (see below) |

> **Status-aware delete protection:** for `PENDING_GO_LIVE` and `ACTIVE` stores, the backend rejects a delete that would empty the gallery (analogous to the "last image" rule on ACTIVE products). For `APPROVED` and `DRAFT` stores, all items can be removed.

---

### `PATCH /stores/:storeId/banner-media/reorder`

**Protected. Store owner or active accepted employee.**

Reorders the entire gallery in a single call. The request body must list the exact set of current item ids — backend rejects any miscount, duplicates, or unknown ids.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `ids` | string[] | yes | Exact set of the gallery's current item ids, in the desired order. First id becomes the cover (`isPrimary: true`). |

**Success — `200`** — returns the reordered gallery as `BannerMedia[]`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `400` | `"Reorder ids must contain exactly the current set of banner items"` | Miscount, duplicates, or unknown id |

---

## Store Addresses

---

### `POST /stores/:storeId/addresses`

**Protected. Store owner or active accepted employee.**

Adds a physical location to the store. Can be added at any status except `CLOSED`. At least one address is required to request go-live. If the store does not exist, returns `403` (not `404`).

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `streetNumber` | string | yes | max 20 chars |
| `streetName` | string | yes | 2–100 chars |
| `buildingName` | string | no | max 100 chars |
| `suburb` | string | no | max 100 chars |
| `city` | string | yes | 2–100 chars |
| `postalCode` | string | yes | 4–10 chars |

**Success — `201`** — Returns the created address object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee, or store does not exist |
| `400` | `"Cannot add addresses to a closed store"` | Store is `CLOSED` |

---

### `PATCH /stores/:storeId/addresses/:addressId`

**Protected. Store owner or active accepted employee.**

Updates a store address. All fields optional.

**Request body** — all fields optional, same fields as create.

**Success — `200`** — Returns the updated address object.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `404` | `"Address not found"` | Address does not exist or belongs to a different store |

---

### `DELETE /stores/:storeId/addresses/:addressId`

**Protected. Store owner or active accepted employee.**

Removes a store address. For `APPROVED`, `PENDING_GO_LIVE`, and `ACTIVE` stores, deleting the last address is blocked.

**No request body.**

**Success — `200`**
```json
{ "message": "Address deleted" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee |
| `404` | `"Address not found"` | Address does not exist or belongs to a different store |
| `400` | `"Cannot delete the last address. Approved stores must have at least one location."` | Attempt to remove the only address on an approved/active store |

---

## Employee Management

---

### `POST /stores/:storeId/employees`

**Protected. Store owner only.**

Sends an email invite to a new team member. Valid for 7 days. Only available once the store is `APPROVED` or beyond. The invite record is created immediately — if the email send fails, the record persists and can be resent.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `email` | string | yes | valid email — normalised to lowercase |

**Success — `201`**
```json
{
  "id": "string",
  "email": "string",
  "isActive": true,
  "acceptedAt": null,
  "createdAt": "ISO 8601 string"
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"Only the store owner can invite employees"` | Not the owner |
| `400` | `"You can only invite employees once your store has been approved"` | Store is `DRAFT` or `PENDING_REVIEW` |
| `409` | `"This person is already an employee of your store"` | Invite already accepted |
| `409` | `"An invite has already been sent to this email..."` | Pending invite exists — use resend |

---

### `GET /stores/:storeId/employees`

**Protected. Store owner or active accepted employee.**

Returns all employees and pending invites for the store — including pending invites, active employees, and deactivated employees. Results are ordered oldest first (`createdAt asc`). If the store does not exist, returns `403` (not `404`) — same enumeration prevention as other endpoints.

**No request body.**

**Success — `200`**
```json
{
  "data": "Employee[]"
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"You do not have permission to manage this store"` | Not owner or active employee, or store does not exist |

---

### `POST /stores/:storeId/employees/:employeeId/resend`

**Protected. Store owner only.**

Generates a fresh invite token and resends the invite email. Invalidates any previous invite link. Cannot resend an already-accepted invite.

**No request body.**

**Success — `200`**
```json
{ "message": "Invitation resent" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"Only the store owner can resend invites"` | Not the owner |
| `404` | `"Employee not found"` | Record does not exist or belongs to a different store |
| `400` | `"This invitation has already been accepted"` | Invite already accepted |

---

### `POST /stores/:storeId/employees/:employeeId/deactivate`

**Protected. Store owner only.**

Revokes an employee's access. The record is kept and can be reactivated later.

**No request body.**

**Success — `200`**
```json
{
  "id": "string",
  "email": "string",
  "employeeNumber": "string | null",
  "isActive": false,
  "acceptedAt": "ISO 8601 string | null"
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"Only the store owner can deactivate employees"` | Not the owner |
| `404` | `"Employee not found"` | Record does not exist or belongs to a different store |
| `400` | `"Employee is already deactivated"` | No-op guard |

---

### `POST /stores/:storeId/employees/:employeeId/reactivate`

**Protected. Store owner only.**

Restores an employee's access.

**No request body.**

**Success — `200`**
```json
{
  "id": "string",
  "email": "string",
  "employeeNumber": "string | null",
  "isActive": true,
  "acceptedAt": "ISO 8601 string | null"
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"Only the store owner can reactivate employees"` | Not the owner |
| `404` | `"Employee not found"` | Record does not exist or belongs to a different store |
| `400` | `"Employee is already active"` | No-op guard |

---

### `DELETE /stores/:storeId/employees/:employeeId`

**Protected. Store owner only.**

Permanently removes the employee record. Use deactivate if you may want to restore access later.

**No request body.**

**Success — `200`**
```json
{ "message": "Employee removed" }
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `403` | `"Only the store owner can remove employees"` | Not the owner |
| `404` | `"Employee not found"` | Record does not exist or belongs to a different store |

---

## Employee Invite Flow

These two endpoints sit under a separate path (`/employees/invites`) because the recipient only has a token at this stage — they do not yet know the store ID.

---

### `GET /employees/invites/validate?token=<rawToken>`

**Public — no authentication required.**

Validates an invite token and returns store branding info. Call this on page load when the user lands on the invite acceptance page, before prompting them to log in or register. Use the returned data to show the store name and logo on the accept screen.

**Query parameter**

| Param | Type | Required |
|---|---|---|
| `token` | string | yes — from the `?token=` query param in the invite link |

**Success — `200`**
```json
{
  "email": "string",
  "store": {
    "id": "string",
    "displayName": "string",
    "slug": "string",
    "logoUrl": "string | null"
  }
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired invitation"` | Token not found, already used, or older than 7 days |

---

### `POST /employees/invites/accept`

**Protected. The authenticated user's email must match the invite email.**

Links the authenticated user's account to the invite. The user must be logged in with the same email the invite was sent to. The token is single-use and is cleared on acceptance.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `token` | string | yes | raw token from the invite link |
| `employeeNumber` | string | no | max 50 chars — optional internal identifier |

**Success — `200`**
```json
{
  "id": "string",
  "email": "string",
  "employeeNumber": "string | null",
  "isActive": true,
  "acceptedAt": "ISO 8601 string",
  "store": {
    "id": "string",
    "displayName": "string",
    "slug": "string"
  }
}
```

**Errors**

| Status | Message | Cause |
|---|---|---|
| `400` | `"Invalid or expired invitation"` | Token not found, already used, or expired |
| `400` | `"This invitation was sent to a different email address..."` | Logged-in user's email does not match invite email |

---

## Admin Endpoints

---

### `GET /stores/admin/pending`

**Protected. `ADMIN` role required.**

Paginated list of stores awaiting initial review (`PENDING_REVIEW`). Default sort is oldest first so the admin works the queue in submission order.

**Query parameters**

| Param | Type | Default | Rules |
|---|---|---|---|
| `page` | integer | `1` | min 1 |
| `limit` | integer | `20` | min 1, max 50 |
| `sortOrder` | `"asc"` \| `"desc"` | `"asc"` | — |

**Success — `200`**
```json
{
  "data": [
    {
      "...store fields...",
      "owner": {
        "id": "string",
        "email": "string",
        "firstName": "string",
        "lastName": "string",
        "phone": "string | null"
      }
    }
  ],
  "meta": {
    "total": "number",
    "page": "number",
    "limit": "number",
    "totalPages": "number"
  }
}
```

---

### `GET /stores/admin/pending-go-live`

**Protected. `ADMIN` role required.**

Paginated list of stores awaiting go-live review (`PENDING_GO_LIVE`). Same query parameters as above. Response includes `addresses` and active product count so the admin can verify launch readiness at a glance.

**Query parameters** — same as above.

**Success — `200`**

Same envelope as above. Each store additionally includes:
```json
{
  "addresses": "StoreAddress[]",
  "_count": {
    "products": "number"
  }
}
```

`_count.products` reflects **active products only** (`status: ACTIVE`). This is what the go-live requirement (minimum 7) is checked against.

---

### `POST /stores/:id/review`

**Protected. `ADMIN` role required.**

Approves or rejects a store's initial application.

- **Approve** → store moves to `APPROVED`, owner's `role` upgrades to `MERCHANT`. Approval email sent to owner.
- **Reject** → store returns to `DRAFT` with `rejectionReason` set. Rejection email sent to owner.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `decision` | `"APPROVE"` \| `"REJECT"` | yes | — |
| `reason` | string | only when `decision` is `"REJECT"` | min 10 chars |

**Success — `200`**

Returns the updated store object plus the `owner` object:
```json
{
  "...store fields...",
  "owner": {
    "id": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "role": "BUYER | MERCHANT"
  }
}
```

On approval, `owner.role` will be `"MERCHANT"`. The frontend should refresh the admin's view to reflect the state change.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"Store not found"` | Store does not exist |
| `400` | `"Only stores in PENDING_REVIEW status can be reviewed"` | Store is not in the right status |
| `400` | `"A rejection reason is required and must be at least 10 characters"` | `REJECT` sent without a valid reason |

---

### `POST /stores/:id/review-go-live`

**Protected. `ADMIN` role required.**

Approves or rejects a store's go-live request.

- **Approve** → store moves to `ACTIVE` and is visible to buyers. Go-live email sent to owner.
- **Reject** → store returns to `APPROVED` (not `DRAFT` — merchant retains `MERCHANT` role and dashboard access). `rejectionReason` set. Rejection email sent to owner.

**Request body** — same shape as `/review`.

**Success — `200`**

Returns the updated store object plus the `owner` object (same shape as `/review` success). On approval, `store.status` will be `"ACTIVE"`.

**Errors**

| Status | Message | Cause |
|---|---|---|
| `404` | `"Store not found"` | Store does not exist |
| `400` | `"Only stores in PENDING_GO_LIVE status can be reviewed for go-live"` | Store is not in the right status |
| `400` | `"A rejection reason is required and must be at least 10 characters"` | `REJECT` sent without a valid reason |

---

## Connection Logic

### Store creation and the BUYER → MERCHANT role transition

A user starts as `BUYER`. They can create a store and submit it from any role. When the admin approves the initial application, the backend atomically upgrades the owner's role to `MERCHANT`. The frontend must call `GET /auth/me` after a successful approval action and update the session state — the JWT in memory still carries the old `BUYER` role until the next token refresh.

### The rejectionReason field

`rejectionReason` is the admin's feedback to the merchant. It is present when:
- A store is returned to `DRAFT` after an initial rejection
- A store remains in `APPROVED` after a go-live rejection

It is cleared automatically when:
- The merchant makes any edit to the store **while in `DRAFT`** (edits in `APPROVED` or `ACTIVE` do **not** clear it)
- The store is resubmitted via `POST /stores/:id/submit` (status moves to `PENDING_REVIEW`)
- The merchant requests go-live via `POST /stores/:id/request-go-live` (status moves to `PENDING_GO_LIVE`)
- The store is approved at either gate (review → `APPROVED`, review-go-live → `ACTIVE`)

Display this field prominently on the merchant dashboard when it is non-null so the merchant knows exactly what to fix before resubmitting.

**Implication for go-live rejections:** A go-live rejection sets `rejectionReason` on an `APPROVED` store. Because edits while `APPROVED` do not auto-clear the reason, the dashboard banner will keep displaying until the merchant calls `POST /stores/:id/request-go-live` again — that's when the reason is cleared. Frontends should communicate this clearly: "fix the issue, then re-request go-live to dismiss this notice."

### Image and media fields (logoUrl, bannerMedia)

The backend does not handle file uploads. The frontend is responsible for uploading to Cloudinary first and then passing the resulting URL back to the appropriate endpoint.

- **`logoUrl`** is a single URL string. Updated via `PATCH /stores/:id { logoUrl }`.
- **`bannerMedia`** is a collection. **Do not** mutate it via `PATCH /stores/:id` — the dedicated endpoints below are the only correct surface:
  - `POST /stores/:storeId/banner-media` — add an item
  - `DELETE /stores/:storeId/banner-media/:id` — remove an item
  - `PATCH /stores/:storeId/banner-media/reorder` — reorder (first id = cover)

This mirrors how product images work (see product-module-api §"Product Images") and keeps the multi-item invariants (≤5 items, exactly one `isPrimary`) enforceable server-side.

The legacy `bannerUrl` field is removed in this revision — existing data is migrated server-side into a single `bannerMedia` entry with `isPrimary: true`.

### Employee invite — full sequence

```
Owner sends invite
  → POST /stores/:storeId/employees
  → Backend creates record, sends email with link:
    https://merchant.yiiva.co.za/invites/accept?token=<rawToken>

Recipient opens link
  → Page loads → GET /employees/invites/validate?token=xxx
      ├── 400 → show "This invite is invalid or has expired"
      └── 200 → show store name, logo, and the email the invite was sent to

Recipient is not logged in
  → Prompt: "Log in or register with <email> to accept this invite"
  → After login/register → POST /employees/invites/accept

Recipient is logged in with wrong email
  → POST /employees/invites/accept returns 400
  → Show: "This invitation was sent to a different email address.
           Please log in with the correct account."

Recipient accepts successfully
  → 200 → redirect to store dashboard or confirmation screen
```

### Pending invite vs accepted employee

Use `acceptedAt` and `isActive` together to determine state:

| `acceptedAt` | `isActive` | `user` | Meaning |
|---|---|---|---|
| `null` | `true` | `null` | Invite pending — sent but not yet accepted |
| ISO 8601 date | `true` | populated | Active employee — has access |
| ISO 8601 date | `false` | populated | Deactivated employee — access revoked |

**Access note:** A pending invite (`acceptedAt: null`) is shown in the employee list but grants no store access. `canManageStore` requires both `isActive: true` AND `acceptedAt` to be set before an employee can perform any store actions.
