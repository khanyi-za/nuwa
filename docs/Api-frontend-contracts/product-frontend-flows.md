# YIIVA Product — Frontend Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA merchant web app (Next.js).
> **Scope:** Screen-level flows, state-driven UX, copy, and edge cases for **all product-related user journeys** in the merchant web app — product inventory, the editor, activation/archive/delete lifecycle, store collections, and admin platform-category management. Consumer-facing catalog endpoints are out of scope here (mobile app).
>
> **Companion docs:**
> - [`product-module-api.md`](./product-module-api.md) — endpoint shapes, request/response, error tables. Source of truth for the API contract.
> - [`store-frontend-flows.md`](./store-frontend-flows.md) — covers the merchant dashboard surfaces around the product module (go-live readiness checklist, image upload pattern that the editor depends on).
> - [`auth-frontend-flows.md`](./auth-frontend-flows.md) — covers the post-login routing into the screens described here.
>
> This doc focuses on **what each persona sees and how they move through the product lifecycle**. Cross-reference the contract for endpoint specifics; do not duplicate them here.

---

## Table of Contents

1. [Context](#1-context)
2. [Merchant — inventory table](#2-merchant--inventory-table)
3. [Merchant — create product](#3-merchant--create-product)
4. [Merchant — product editor](#4-merchant--product-editor)
   - [4.1 Layout](#41-layout)
   - [4.2 Basics section](#42-basics-section)
   - [4.3 Images section](#43-images-section)
   - [4.4 Variants section](#44-variants-section)
   - [4.5 Categories section](#45-categories-section)
   - [4.6 Tags section](#46-tags-section)
   - [4.7 Collections section](#47-collections-section)
   - [4.8 Save behaviour and feedback](#48-save-behaviour-and-feedback)
5. [Activation flow](#5-activation-flow)
6. [Archive flow](#6-archive-flow)
7. [Delete flow (DRAFT only)](#7-delete-flow-draft-only)
8. [Stock and pricing UX](#8-stock-and-pricing-ux)
9. [Store collections (merchant-side)](#9-store-collections-merchant-side)
10. [Admin — platform categories](#10-admin--platform-categories)
11. [Edge cases & coordination](#11-edge-cases--coordination)
12. [UX patterns & copy guidance](#12-ux-patterns--copy-guidance)
13. [Testing checklist](#13-testing-checklist)

---

## 1. Context

### Three personas (recap)

The product module is where merchants spend the most time after they reach `APPROVED`. It also includes a small admin surface for category management.

| Persona | Role | Their product-module surface |
|---|---|---|
| **Merchant** | `MERCHANT` | The full lifecycle: inventory table, product editor, activation/archive, store collections |
| **Employee** | `BUYER` (per the role-system limitation) | Same surface as the merchant — manage products, images, variants, categories, tags, collections |
| **Admin** | `ADMIN` | Platform-category tree management (`/categories` CRUD) |

> Active employees can manage products thanks to the service-layer `canManageStore` check. The role guard was removed from product controllers earlier in this session — see `auth-frontend-flows.md` §1 callout for the underlying employee-discovery limitation.

### Product lifecycle state machine

```
            create
              ↓
            DRAFT  ────activate (with validation)──→ ACTIVE  ──archive──→ ARCHIVED
              │                                       │   ↑
              │                                  (stock=0)│ (re-stock + re-activate)
              │                                       ↓
              ⤓                                  OUT_OF_STOCK ──archive──→ ARCHIVED
            delete
            (only DRAFT)
```

| Status | Visible to buyers? | Mutations allowed? | Can transition to |
|---|---|---|---|
| `DRAFT` | No | Yes | `ACTIVE` (via activate); deleted via `DELETE` |
| `ACTIVE` | Yes | Yes | `ARCHIVED` (via archive); `OUT_OF_STOCK` (system, when stock zeros) |
| `OUT_OF_STOCK` | Yes (with stock-out indicator) | Yes (re-stock then re-activate) | `ACTIVE` (via activate); `ARCHIVED` (via archive) |
| `ARCHIVED` | No | **No** — read-only across all sub-resources | (terminal — no automatic reactivation) |

> **Note on `OUT_OF_STOCK`:** the schema supports this status, but **no backend code currently transitions a product into it** — there is no automatic stock-zeroing logic in the product service. The screens designed for `OUT_OF_STOCK` in this doc (status pill colour, "Re-activate after restock" path) are reserved for a future automatic stock-management feature. You cannot QA this state end-to-end against the current backend.

**Design rules to internalise as a frontend developer:**

- **DRAFT is the default.** Every product is born `DRAFT`. There is no "create as ACTIVE" shortcut.
- **`ACTIVE` is gated by the activation contract.** Validation runs at activation, not at creation. The editor must let merchants save partial work without nagging.
- **`ARCHIVED` is one-way.** No reactivation endpoint. The merchant has to create a new product if they want to bring it back.
- **`DELETE` only works on `DRAFT`.** Once a product has gone live (or even just past DRAFT into ARCHIVED), it cannot be hard-deleted — order/review history must be preserved.
- **Sub-resources (images, variants, categories, tags, collections) are blocked when the parent product is `ARCHIVED`.** Every mutation across those endpoints returns `409 "Cannot modify an archived product"`.

### State-driven UI cheat sheet

| Action | DRAFT | ACTIVE | OUT_OF_STOCK | ARCHIVED |
|---|---|---|---|---|
| Show "Activate" button | yes (gated by readiness checklist) | no (already active — show "Active" indicator) | yes ("Re-activate after restock") | no |
| Show "Archive" button | no (use Delete) | yes | yes | no (already archived) |
| Show "Delete" button | yes | no | no | no |
| Edit fields | yes | yes | yes | **no — read-only** |
| Add/remove images, variants, tags, categories, collections | yes | yes | yes | **no — read-only** |
| Last-image-on-product rule | n/a | enforced (cannot remove last) | n/a | n/a |
| Last-category-on-product rule | n/a | enforced (cannot remove last) | n/a | n/a |

> **Configuration values used in copy:** the example copy throughout this document references `support@yiiva.co.za` as the support contact — treat as a placeholder (per the same callout in `auth-frontend-flows.md` §1). All currency is shown as ZAR with the `R` prefix; backend stores everything in cents.

---

## 2. Merchant — inventory table

**Entry:** the merchant lands on the product list whenever they navigate to "Products" in the merchant dashboard's top-level navigation. This is the post-APPROVED merchant's most-visited screen.

### Layout

```
Products                                                    [ + Add product ]

[ All ▾ ] [ Search title or SKU ... ] [ Sort: Newest ▾ ]    [ Category ▾ ] [ Collection ▾ ]

┌──────────────────────────────────────────────────────────────────────────┐
│ [img] Vintage Tee                              R 249.00   ACTIVE         │
│       50 in stock · 2 variants · 1 category    R 350.00 ↘                │
│                                                          [Edit] [More ▾] │
├──────────────────────────────────────────────────────────────────────────┤
│ [img] Hoodie — Charcoal                        R 599.00   DRAFT          │
│       0 in stock · no variants · 0 categories                            │
│                                                          [Edit] [More ▾] │
├──────────────────────────────────────────────────────────────────────────┤
│ [img] Limited Cap (gone)                       R 199.00   ARCHIVED       │
│       last seen 12 May 2026                                              │
│                                                          [View]          │
└──────────────────────────────────────────────────────────────────────────┘

[ ← Previous ]    Page 1 of 3    [ Next → ]
```

### Filters

| Filter | DTO field | Default | Options |
|---|---|---|---|
| Status | `status` | `all` | `all`, `DRAFT`, `ACTIVE`, `OUT_OF_STOCK`, `ARCHIVED` |
| Search | `search` | (empty) | matches title or SKU, case-insensitive |
| Category | `categoryId` | (empty) | platform-category picker |
| Collection | `collectionId` | (empty) | store-collection picker |
| Sort | `sortBy` | `newest` | `newest`, `oldest`, `nameAsc`, `nameDesc`, `priceAsc`, `priceDesc`, `stockAsc` |

**API call:** `GET /stores/:storeId/products` ([contract](./product-module-api.md#get-storesstoreidproducts))

**Each row shows:**
- Primary image thumbnail (from `images[0]` filtered to `isPrimary: true` — may be empty for DRAFT products without images)
- Title + slug as small grey text below
- Status pill (DRAFT, ACTIVE, OUT_OF_STOCK, ARCHIVED) with consistent colour coding
- Inventory summary: `{totalStock} in stock · {variantCount} variants · {categoryCount} categories`
- Price: `R {price/100}` plus comparePrice with strikethrough if non-null (see [§8.4](#84-compare-price-strikethrough))
- Action buttons:
  - **DRAFT/ACTIVE/OUT_OF_STOCK:** `[Edit]` (primary) + `[More ▾]` dropdown (Activate, Archive, Delete — filtered by current status per the [state cheat sheet](#state-driven-ui-cheat-sheet))
  - **ARCHIVED:** `[View]` only — read-only

### Status pill colours

| Status | Pill colour (suggested) |
|---|---|
| `DRAFT` | grey / neutral |
| `ACTIVE` | green |
| `OUT_OF_STOCK` | amber/yellow |
| `ARCHIVED` | muted grey, italic |

### Empty states

**No products yet (fresh APPROVED store):**

```
        [ illustration ]

   Add your first product

   You need at least 7 active products to go live. Start by
   creating your first one — you can save it as a draft and
   come back later.

   [ + Add your first product ]
```

This empty state should be coordinated with the go-live readiness checklist on the dashboard (see [`store-frontend-flows.md` §2.5](./store-frontend-flows.md#25-approved--preparing-for-go-live)).

**Filtered to no results:**

```
   No products match your filters.

   [ Clear filters ]
```

**No archived products:**

```
   You haven't archived any products yet. Archived products
   appear here when you take them off sale.
```

### Pagination

Standard previous/next + page counter. Default `limit: 20`, max `50`. The contract returns `meta: { total, page, limit, totalPages }` — render those.

---

## 3. Merchant — create product

**Entry:** "Add product" button on the inventory table, or "Add your first product" CTA from the empty state, or "Add products" link from the go-live readiness checklist.

### What the user sees

A small modal or full-screen form with the **bare minimum** required to create:

```
Add a product

Title *
[___________________________________]

Price (in ZAR) *
[ R __________ ]

[ Cancel ]   [ Create product ]
```

That's it for the create step — by design. The merchant can save more details (description, SKU, stock, images, variants, etc.) in the editor after creation. **Do not show every field on this screen** — it would feel like the wizard never ends.

### Validation

- `title`: 2–120 chars, on-blur validation
- `priceInCents`: required, ≥ 0 (the contract allows `0` — but the activation contract requires `> 0` later). For the create form, accept `0` to avoid blocking quick drafts. Helper text: *"You can change this later. Activation requires a price greater than zero."*
- Display the price as ZAR (e.g. `R 249.00`) but submit as cents (e.g. `24900`). See [§8.3](#83-cents-to-zar-display-rules).

### API call

`POST /stores/:storeId/products` ([contract](./product-module-api.md#post-storesstoreidproducts))

Body: `{ title, priceInCents }` plus any optional fields if the merchant chose to fill them.

### Success path (201)

- Backend returns the full product object
- Push it into local state
- **Navigate directly to the product editor** for that product (see [§4](#4-merchant--product-editor))
- Show a brief toast: *"Draft created. Add details to publish."*

The transition is critical: don't dump the merchant back on the inventory table after creation. They came here to make a product, not to admire a list of one item. Take them straight to the editor.

### Error paths

| Response | UX |
|---|---|
| `403 "You do not have permission to manage this store"` | Refetch `/auth/me`, reroute. The user lost permissions. |
| `403 "Cannot manage products on a store with status <STATUS>..."` | Store regressed below `APPROVED`. Refetch and reroute. |
| `400` validation array | Inline field errors (title too short/long, price negative). |

---

## 4. Merchant — product editor

This is the main surface for managing a product after creation. It's also reached from "Edit" on the inventory table. The editor is where the merchant fills in everything needed for activation — and where they manage the product across its lifecycle.

### 4.1 Layout

**Recommended layout:** **section-based single page with sticky side nav**, mirroring the [store setup wizard](./store-frontend-flows.md#22-store-setup-wizard-draft) pattern. Reasons are the same:

- Merchants edit non-sequentially (add an image now, fix the price tomorrow, write the description next week)
- A linear wizard forces an arbitrary order
- The activation readiness panel (see [§5.1](#51-pre-activation-readiness-panel)) needs to be visible alongside the form

```
┌──────────────────────┬─────────────────────────────────────────────────┐
│ ← Back to products   │ Vintage Tee                            DRAFT    │
│                      │ /vintage-tee                                    │
│ Sections             │                                                 │
│ • Basics ✓           │ ┌─────────────────────────────────────────────┐│
│ • Images (3)         │ │ Basics                                      ││
│ • Variants (none) ☐  │ │                                             ││
│ • Categories ☐       │ │ Title *                                     ││
│ • Tags (5)           │ │ [Vintage Tee____________________________]  ││
│ • Collections (1)    │ │                                             ││
│                      │ │ Description                                 ││
│ Activation readiness │ │ [_________________________________________]│
│  3 / 5 ✓             │ │                                             ││
│                      │ │ ...                                         ││
│ ☐ Activate           │ │                                             ││
│ (disabled until 5/5) │ └─────────────────────────────────────────────┘│
│                      │                                                 │
│ More ▾               │                                                 │
│ • Archive            │                                                 │
│ • Delete (DRAFT only)│                                                 │
└──────────────────────┴─────────────────────────────────────────────────┘
```

### What the URL bar shows

Use the product's slug in the URL: `/products/{slug}/edit` (or whatever your routing decides — but include the slug for shareability and bookmark stability). Note the slug is unique per store, not platform-wide — see [contract §1027](./product-module-api.md#product-slug-is-auto-generated-and-store-scoped).

### Read-only mode for ARCHIVED

If `product.status === 'ARCHIVED'`, render the entire editor in read-only mode:
- Disable all inputs
- Replace the "Activate" CTA with a banner: *"This product is archived. To bring something similar back to your store, create a new product."*
- Hide all action buttons except `[Back to products]`

### 4.2 Basics section

Fields: `title`, `description`, `priceInCents`, `comparePriceInCents`, `sku`, `totalStock`.

| Field | UX |
|---|---|
| `title` | Single-line input. Live char count `42 / 120`. Validation: 2–120 chars. |
| `description` | Multi-line textarea. Char count `247 / 5000`. No formatting / markdown in v1 — backend stores plain text. Helper: *"Tell buyers about this product. Materials, sizing notes, care instructions — anything that helps them decide."* |
| `priceInCents` | ZAR input with `R` prefix and decimal handling (see [§8.3](#83-cents-to-zar-display-rules)). Activation requires `> 0`. |
| `comparePriceInCents` | Optional ZAR input. Helper: *"Original price. Buyers see this with a strikethrough next to the sale price."* If user enters a `comparePriceInCents ≤ priceInCents`, show a soft warning (*"This is below the current price — buyers won't see a discount."*) but don't block. |
| `sku` | Plain text. Helper: *"Optional internal identifier. We don't show this to buyers."* Max 80 chars. |
| `totalStock` | Integer input. **Behaviour depends on whether variants exist** — see [§8.1](#81-bare-totalstock-vs-variant-stock--the-transition). |

**Validation timing:**
- All fields: on-blur for format checks, autosave on debounce 800ms (see [§4.8](#48-save-behaviour-and-feedback))
- Required-for-activation fields are **not blocked** at editor time — the merchant can save partial drafts. The activation flow surfaces missing fields ([§5.3](#53-multi-error-feedback-string-array-messages)).

### 4.3 Images section

The image manager is the most interactive part of the editor.

```
Images (3)                                          [ + Add image / video ]

┌──────────┬──────────┬──────────┐
│  [img]   │  [img]   │  [vid]   │
│  PRIMARY │          │          │
│  [×]     │  [★] [×] │  [×]     │
│  [drag]  │  [drag]  │  [drag]  │
└──────────┴──────────┴──────────┘
   Front      Back      Demo

[Helper text: At least 1 image (not video) is required to activate this product.]
```

**Patterns to implement:**

- **Drag-and-drop reorder.** The contract's reorder endpoint requires the **exact set of all current image IDs in the new order** ([contract](./product-module-api.md#patch-storesstoreidproductsproductidimagesreorder)). Implement drag-and-drop locally, then on drop fire `PATCH /images/reorder` with the new order. Optimistic UI: snapshot the pre-drag order locally, re-render immediately with the new order, and **restore the snapshot on failure** — don't refetch (that's an extra network round-trip the user doesn't want).
- **Primary indicator.** The current primary image gets a "PRIMARY" pill. Other images get a star icon button to promote them. Click → `PATCH /images/:imageId/primary` — backend automatically demotes the previous primary. Optimistic UI: swap the pill immediately.
- **Add image vs add video.** The "Add" button opens a picker. Default `mediaType: IMAGE`. The picker should let the merchant choose video for product demos (these don't count toward activation but enrich the listing). See [§11.1](#111-image-upload--cross-reference-to-store-flows-73) for the upload pattern.
- **The first image added is auto-primary** (per backend logic). UX: the merchant doesn't need to know this — just show "PRIMARY" on it after upload.
- **Add with `isPrimary: true` demotes the existing primary** — backend handles. No special UX beyond the pill swap.
- **Delete image.** Click `[×]` → confirmation modal → `DELETE /images/:imageId`. Optimistic UI for the removal, but watch for the `409` error below.

**The last-image-on-ACTIVE rule:**

If `product.status === 'ACTIVE'` AND the user tries to delete the only image:

- The backend returns `409 "Cannot remove the last image from an active product. Add a replacement image first or archive the product."`
- UX: replace the deletion confirmation with a different modal:

```
You can't remove this image

This is the only image on a live product. Buyers need at
least one image to see what they're buying. Add a
replacement image first, or archive the product to take
it off sale.

[ Add another image ]   [ Archive instead ]   [ Cancel ]
```

The `[ Add another image ]` opens the upload flow inline. `[ Archive instead ]` opens the [archive flow](#6-archive-flow).

**Activation readiness contribution:** "Has at least one IMAGE (not video)" → `images.filter(i => i.mediaType === 'IMAGE').length >= 1`.

### 4.4 Variants section

Variants are optional. A product can be **bare** (no variants — uses the product's own `totalStock` and `priceInCents`) or **varianted** (one or more variants — each has its own `stock` and may override `priceInCents`).

```
Variants (2)                                         [ + Add variant ]

┌──────────────────────────────────────────────────────────────────┐
│ Black / Medium       SKU: vt-bk-m   Stock: 12   Price: (inherit) │
│                                                  [Edit] [Delete] │
├──────────────────────────────────────────────────────────────────┤
│ Black / Large        SKU: vt-bk-l   Stock: 8    Price: R 279.00  │
│                                                  [Edit] [Delete] │
└──────────────────────────────────────────────────────────────────┘

[Helper text: Each variant has its own stock. Leave the variant price empty
to inherit the base price (R 249.00). Buyers see one variant per row when
choosing options.]
```

**Add variant form:**

```
Add variant

Name *               (e.g. "Black / Medium")
[___________________________________]

Stock *
[ ____ ]

Price override       (leave empty to inherit R 249.00)
[ R __________ ] or [ Inherit base price ]

Color                Size                Material
[___________]        [___________]       [___________]

SKU
[___________________________________]

[ Cancel ]   [ Save variant ]
```

**Critical UX rules:**

- **Price-inheritance display.** When `priceInCents === null`, show *"(inherit)"* in the variants list and a placeholder *"Inherit base price (R xxx.xx)"* in the input. Provide a clear toggle/button to clear an existing override:

  ```
  Price override
  [ R 279.00 ]   [ Clear — use base price ]
  ```

  Clicking "Clear" sends `priceInCents: null` to the backend (per the contract — `null` is explicitly allowed via `@ValidateIf`).

- **Variant creation does not redistribute totalStock.** If the bare product had `totalStock: 100` and the merchant adds a first variant with `stock: 12`, the product's `totalStock` is **not** automatically reset. See [§8.1](#81-bare-totalstock-vs-variant-stock--the-transition) for the recommended UX flow at the bare→varianted transition.

- **Drag-to-reorder variants.** Same pattern as images — local drag, fire `PATCH /variants/:variantId` with the new `sortOrder` for each affected variant. (Backend doesn't have a single batch-reorder endpoint for variants — multiple PATCH calls needed. If reordering becomes a frequent action, flag a backend follow-up.)

- **Delete variant.** Confirmation modal:

  ```
  Delete this variant?
  Stock: {stock} units  ·  This can't be undone.
  [ Cancel ]   [ Delete variant ]
  ```

  After deletion, backend re-indexes `sortOrder` automatically (compacts to 0, 1, 2…). UX: refetch the variants list after delete to pick up the new order.

  The contract permits deleting the last variant on an ACTIVE product. There's no last-variant rule. After deletion, the product reverts to bare-product behaviour (using its own `totalStock` and `priceInCents`).

- **Variant stock = 0** is allowed. The product can still be `ACTIVE`. The activation contract checks variant **price overrides** (no negative or zero overrides allowed) but does **not** check variant stock — a product with all variants at `stock: 0` can still activate. Don't add a frontend gate the backend doesn't enforce.

**Activation readiness contribution:** *"All variant price overrides must be > 0"* → `variants.every(v => v.priceInCents === null || v.priceInCents > 0)`. `null` is fine (inherits base); a variant with `priceInCents: 0` fails.

### 4.5 Categories section

Platform categories drive discovery — every active product needs at least one. The list of available categories is fetched from `GET /categories` (public, returns the full tree).

```
Categories (1)                              [ + Add category ]

┌─────────────────────────────────────────────┐
│ Fashion / Streetwear / Hoodies         [×]  │
└─────────────────────────────────────────────┘

[Helper text: At least one category is required to activate this product.
 Pick the most specific category — buyers can find your product through
 any parent category too.]
```

**Add category UX:** opens a tree picker:

```
Add category

Search categories...

▾ Fashion
  ▾ Streetwear
    ☐ Hoodies      (already added)
    ☐ T-Shirts
    ☐ Caps
  ▾ Formal
    ☐ Suits
▾ Beauty
  ▾ Skincare
    ☐ Cleansers

[ Cancel ]   [ Add 1 selected ]
```

- **Show the full path** when an option is nested (`Fashion / Streetwear / T-Shirts`).
- **Visual breadcrumb** in the categories list confirms the hierarchy.
- **Idempotent add** — backend returns 200 with the existing record if already linked. UX: no error, just close the picker. (Don't surface a "already linked" message — confusing.)
- **Search filter** narrows the tree as the merchant types.

**Remove category UX:** click `[×]` → confirmation:

```
Remove "Fashion / Streetwear / Hoodies"?
This product won't appear under this category anymore.
[ Cancel ]   [ Remove ]
```

**The last-category-on-ACTIVE rule:**

If `product.status === 'ACTIVE'` AND removing the only category:

- Backend returns `409 "Cannot remove the last category from an active product"`.
- UX: same pattern as last-image:

```
You can't remove this category

Active products need at least one category. Add another
category first, or archive the product.

[ Add another category ]   [ Archive instead ]   [ Cancel ]
```

**Activation readiness contribution:** *"Has at least one platform category"* → `categories.length >= 1`.

### 4.6 Tags section

Tags are platform-wide, lowercase-normalised strings. Up to 20 per product. Created on the fly when added — the merchant just types a name.

```
Tags (5)                                          [ + Add tag ]

[ summer ×]  [ streetwear ×]  [ unisex ×]  [ minimalist ×]  [ cotton ×]

[Helper text: Lowercase only. Tags help buyers find your product.
 You can add up to 20 — currently using 5.]
```

**Add tag UX — chip-input pattern:**

```
[ Add a tag ... ]
```

The user types `Summer Vibes` → on Enter or comma:
- Backend normalises via `name.trim().toLowerCase()` — **spaces are preserved**, only case changes. `"Summer Vibes"` becomes the tag-name `summer vibes` (display) and the slug `summer-vibes` (URL routing only, not shown to users).
- Show a lowercase preview inline as the user types: *"Will be added as: `summer vibes`"*. This sets expectation before submit.
- Send `POST /stores/:storeId/products/:productId/tags` with `{ name: "Summer Vibes" }` (backend lowercases — frontend can submit as typed).
- On 200, append the new chip to the list using the normalised `tag.name`.
- On `400 "A product can have at most 20 tags"`, surface inline: *"You've reached the 20-tag limit. Remove one to add more."*

**Remove tag** — click `[×]` on a chip → fires `DELETE /tags/:tagId`. The `tagId` is the **Tag's id**, not the ProductTag-link id (per the [contract](./product-module-api.md#tag-id-vs-tag-name)). Frontend reads it from `product.tags[n].tag.id`.

**Idempotent add** — backend returns the existing record if the tag is already linked. UX: silently no-op (don't show an error).

### 4.7 Collections section

Collections are store-scoped groupings the merchant has created (e.g., "Summer 2026", "Sale"). Multi-select: a product can belong to many collections.

```
Collections (1)                                   [ + Add to collection ]

[ Summer 2026 × ]

[Helper text: Collections are your custom groupings — they appear on your
 store page so buyers can browse curated picks.]
```

**Add to collection UX** — opens a multi-select picker showing the merchant's collections:

```
Add to collections

Search your collections...

☐ Summer 2026     (already added)
☐ Limited Edition
☐ Sale

[ + Create new collection ]   [ Cancel ]   [ Add 0 selected ]
```

The "+ Create new collection" link opens the [collection-create flow](#9-store-collections-merchant-side) inline so the merchant doesn't have to leave the editor.

**API calls:**
- Add: `POST /collections/:collectionId/products/:productId` ([contract](./product-module-api.md#post-storesstoreidcollectionscollectionidproductsproductid))
- Remove: `DELETE /collections/:collectionId/products/:productId` ([contract](./product-module-api.md#delete-storesstoreidcollectionscollectionidproductsproductid))

**Idempotent add** — backend returns existing record on duplicate. No error UX needed.

> See [§9](#9-store-collections-merchant-side) for the collection-listing limitation that affects this section's picker — for pre-`ACTIVE` stores, the frontend must maintain a local list of collections since there's no merchant `GET /stores/:storeId/collections` endpoint.

### 4.8 Save behaviour and feedback

- **Autosave per field**, on blur for short fields and 800ms debounce for long ones (description, etc.) — same pattern as the store wizard.
- **Per-section "Saved" indicator** visible for ~2s after each successful save.
- **"Saving…" indicator** while in flight.
- **"Save failed — retry"** with a retry button on error.
- For sub-resource sections (Images, Variants, Categories, Tags, Collections), saves happen via their own dedicated endpoints — they're not part of the main `PATCH /products/:id` payload. Reflect this in the indicator: each section saves independently.

---

## 5. Activation flow

This is the moment a product becomes visible to buyers. It's the merchant equivalent of the store's go-live request — except there's no admin gate. The merchant is fully responsible for the activation contract.

### 5.1 Pre-activation readiness panel

The editor's sticky side nav shows an activation readiness panel below the section list:

```
Activation readiness    3 / 5

✓ Has a title
✓ Has a price > zero
✗ At least one image
✗ At least one category
✓ All variant price overrides > zero (or inherit)

[ Activate this product ]   ← disabled until 5 / 5
```

- Each row maps to one of the 5 activation-contract requirements (per the [contract](./product-module-api.md#post-storesstoreidproductsidactivate)):
  - Title length ≥ 2
  - Price > 0
  - At least 1 image of `mediaType: IMAGE` (videos don't count)
  - At least 1 platform category
  - All variants with non-null `priceInCents` have `priceInCents > 0` (inheriting via `null` is fine)

- The button is **disabled** until all 5 items pass. Hover/tap on the disabled button shows: *"Fix the missing items above to activate."*

- Clicking a `✗` row scrolls to (and focuses) the relevant editor section so the merchant can fix it inline.

> **Note on derivation:** the readiness panel is derived from `GET /stores/:storeId/products/:id` (which returns full relations). The frontend computes the 5 checks locally so the panel updates immediately as the merchant edits — no need to wait for the activation request to fail.

### 5.2 The Activate action and confirmation

**Trigger:** the merchant clicks "Activate this product" once the readiness panel shows 5/5.

**Confirmation modal:**

```
Title:  Activate "{title}"?
Body:   Once activated, your product will be visible to buyers
        on YIIVA. You can keep editing it after activation —
        all changes will be live immediately.
        Make sure your title, price, images, and description
        are accurate.
Action: [ Cancel ]   [ Activate ]
```

The "you can keep editing after activation" framing matters because it's true (`PATCH` works on `ACTIVE` products) and reassures the merchant that this isn't a one-way commit.

**API call:** `POST /stores/:storeId/products/:id/activate` ([contract](./product-module-api.md#post-storesstoreidproductsidactivate))

### 5.3 Multi-error feedback (string-array messages)

The activation contract is unusual: a `400` returns `message` as a **string array** — every failing requirement listed at once, not one at a time.

```json
{
  "statusCode": 400,
  "message": [
    "Price must be greater than zero",
    "Product must have at least one image",
    "Product must be linked to at least one platform category"
  ],
  "error": "Bad Request"
}
```

> **Frontend implication:** your error-handler needs to detect when `message` is an array (vs the single string most other endpoints return). For activation specifically, render every line as a separate item in the UI. Don't `.join(', ')` them into a sentence — readers will skim past the second issue.

**UX on multi-error response:**

- Stay on the editor (don't navigate away)
- Surface a banner at the top of the form:

```
┌────────────────────────────────────────────────────────┐
│ ✗ Couldn't activate your product yet                   │
│                                                        │
│ • Price must be greater than zero                      │
│ • Product must have at least one image                 │
│ • Product must be linked to at least one platform     │
│   category                                             │
│                                                        │
│ Fix these and try again.                               │
└────────────────────────────────────────────────────────┘
```

- Refetch `GET /stores/:storeId/products/:id` so the readiness panel re-evaluates against fresh server state. The local pre-validation should already have caught most of these — if it didn't, that's a sign the local state was stale (or you have a bug).

### 5.4 Post-activation UI changes

On `200 OK` response (status now `ACTIVE`):

- Replace the "Activate this product" CTA with a status badge: *"Active — visible to buyers"*
- Show the `publishedAt` timestamp prominently: *"Published 7 May 2026"*
- Replace the readiness panel with a brief congratulations card:

```
┌───────────────────────────────────────────────┐
│ Your product is live                          │
│ Buyers can now find "{title}" on YIIVA.       │
│                                               │
│ Public link: {PUBLIC_STORE_URL_BASE}/         │
│   {storeSlug}/products/{productSlug}          │
│ [ Copy link ]                                 │
└───────────────────────────────────────────────┘
```

> Public-link pattern uses the same placeholder convention as `store-frontend-flows.md` §2.8. Confirm with the team before shipping.

- Show "Archive this product" as an option in the editor's `[More ▾]` menu (no longer Delete — that's DRAFT-only, see [§7](#7-delete-flow-draft-only)).

### 5.5 Idempotency — already-active no-op

If the merchant clicks Activate twice (race condition, two browser tabs, network retry), the **second call returns 200 with the unchanged product** — the backend treats already-ACTIVE as a no-op success.

> The early-return shape was **normalised earlier in this session** to match the success-path shape (see contract section §1's product schema). Both paths now return identical scalar product fields. Frontend doesn't need to special-case this.

UX: just re-render the product card with the response. No surprising flicker, no error toast.

### 5.6 Trying to activate an `ARCHIVED` product

`409 "Cannot activate an archived product."` — this should be unreachable from the editor (the editor is read-only on ARCHIVED products), but if a stale tab fires it, surface a banner: *"This product is archived. Create a new product to bring something similar back."*

---

## 6. Archive flow

Archive removes a live product from sale without deleting it. Order history, reviews, and analytics stay attached.

**Entry:** `[More ▾]` menu in the editor, or the row's `[More ▾]` on the inventory table. Disabled when the product is `DRAFT` (use Delete) or already `ARCHIVED`.

**Confirmation modal:**

```
Title:  Archive "{title}"?
Body:   Buyers won't see this product anymore. Your sales history,
        reviews, and any pending orders stay intact.
        You can't reactivate an archived product later — if you
        want this product back, you'll need to create a new one.
Action: [ Cancel ]   [ Archive ]
```

The "you can't reactivate" line is critical — the contract explicitly notes archive is one-way. Don't soften it.

**API call:** `POST /stores/:storeId/products/:id/archive` ([contract](./product-module-api.md#post-storesstoreidproductsidarchive))

**Success path (200):**
- Update local state: `status: 'ARCHIVED'`
- Toast: *"{title} archived. It's no longer visible to buyers."*
- Editor switches to read-only mode (see [§4.1](#41-layout) — the read-only treatment)
- The `[More ▾]` menu now shows nothing (no actions available on ARCHIVED)

**Error paths:**

| Response | UX |
|---|---|
| `409 "Cannot archive a draft product. Delete it instead."` | Should be prevented client-side. If it slips through, surface as inline banner with `[Delete this draft]` action linking to the delete flow. |
| Already-ARCHIVED 200 no-op | Same as activate idempotency — render the response, no special UX. |

---

## 7. Delete flow (DRAFT only)

Delete is permanent — the product row is gone, all sub-resources cascade-deleted, the slug becomes available for reuse. **Only `DRAFT` products can be deleted.**

**Entry:** `[More ▾]` menu in the editor or inventory table, only when `product.status === 'DRAFT'`.

**Confirmation modal:**

```
Title:  Delete "{title}"?
Body:   This permanently removes the product, including any images,
        variants, tags, and category links you've added.
        This can't be undone. If you want to keep a record of this
        product instead, archive it after activation.
Action: [ Cancel ]   [ Delete forever ]
```

The "permanent" framing matters — merchants accustomed to "trash" patterns from other apps might assume there's a recovery path. There isn't.

**API call:** `DELETE /stores/:storeId/products/:id` ([contract](./product-module-api.md#delete-storesstoreidproductsid))

**Success path (200):**
- Backend returns `{ "success": true }`
- Remove the product from local state
- Navigate back to the inventory table
- Toast: *"{title} deleted."*

**Error paths:**

| Response | UX |
|---|---|
| `409 "Only draft products can be deleted. Use archive to remove a live product."` | Should be prevented client-side. Surface as banner with `[Archive instead]` action. |
| `404` | Already deleted in another tab. Refetch inventory and quietly remove. |

---

## 8. Stock and pricing UX

### 8.1 Bare `totalStock` vs variant `stock` — the transition

The backend treats stock as **independent**, not aggregated:
- A product with no variants uses `Product.totalStock` for stock tracking.
- A product with one or more variants uses each `Variant.stock` individually. `Product.totalStock` is **not** the sum of variant stocks.

**The transition moment** — merchant has been running a bare product, then adds a first variant — is the most confusing UX surface in the editor. Recommended pattern:

1. When the merchant clicks `[+ Add variant]` on a bare product (`totalStock > 0`, `variants.length === 0`), show a notice in the Add-variant modal:

```
┌──────────────────────────────────────────────────────┐
│ ℹ Switching to variants                              │
│                                                      │
│ Once you add variants, this product's "Total stock"  │
│ field stops being used. Buyers will pick a variant   │
│ and see that variant's stock.                        │
│                                                      │
│ Your current totalStock of {N} won't be split        │
│ across variants — you'll set each variant's stock    │
│ separately.                                          │
└──────────────────────────────────────────────────────┘
```

2. After the first variant is created, the **Basics section's `totalStock` field becomes disabled** with a helper note: *"This product has variants. Manage stock on each variant instead."*

3. If the merchant later deletes all variants, the `totalStock` field re-enables. The product reverts to bare-product behaviour. (The original `totalStock` value is preserved — it never got zeroed by the variant transition.)

### 8.2 `reservedStock` is informational, not editable

Both `Product` and `ProductVariant` carry a `reservedStock` field (held by carts that haven't checked out yet). The contract describes this field as exposed in detail responses but should **not be presented as an editable input** — it's managed by the cart system, not the merchant.

UX rules:

- **Never render `reservedStock` as an editable field.** The Basics section's stock input is `totalStock` only; the variant edit form's stock input is `Variant.stock` only.
- **Showing it as a derived read-only stat is fine and encouraged.** Merchants planning their inventory want to know what's actually available right now. Surface it as a small caption next to the stock input:

  *"50 in total · 3 held in active carts · 47 available"*

- If you choose not to show the breakdown, just show `totalStock`. Don't surface `reservedStock` in isolation — the number is meaningless without context.

### 8.3 Cents-to-ZAR display rules

Backend stores all prices as integer cents (e.g. `R249.00 = 24900`). Frontend handles conversion in both directions.

| Direction | Rule | Example |
|---|---|---|
| Display | `priceInCents / 100` formatted with locale, prefix `R` | `24900 → "R 249.00"` |
| Input → submit | parse decimal, multiply by 100, round | user types `249.00` → submit `24900` |
| Show `0` cents explicitly | `R 0.00` is a valid display for DRAFT placeholders | merchant can save `priceInCents: 0` while drafting |

**Input UX:**

```
Price *
R [_______________]   (e.g. 249.00)
```

- Allow only digits and one decimal point
- Auto-format on blur: `"249" → "249.00"`, `"249.5" → "249.50"`
- Reject negative inputs at field-level

**Currency rounding edge case:** ZAR doesn't use 1c or 2c coins, but the backend stores everything in cents. Don't round to nearest 5c at the input — let the merchant set whatever they want. (Backend doesn't enforce this either.)

### 8.4 Compare price strikethrough

`comparePriceInCents` is the "original price" for showing a discount. Only meaningful when `comparePriceInCents > priceInCents`.

**Display rules:**

| Scenario | Display |
|---|---|
| `comparePriceInCents` is null | Show `priceInCents` only — no strike-through |
| `comparePriceInCents > priceInCents` | Show `priceInCents` plus crossed-out `comparePriceInCents`: ~~R 350.00~~ R 249.00 |
| `comparePriceInCents <= priceInCents` | Show `priceInCents` only. Show a small soft-warning in the editor (*"This compare price is not above the current price — buyers won't see a discount"*) but don't block save. |
| `comparePriceInCents` set, then user clears `priceInCents` | Backend allows. Frontend can warn but doesn't have to. |

The compare price is a UX/marketing concept, not a system constraint. Treat it gently — don't over-validate.

### 8.5 Variant price override = null (inheritance)

A variant's `priceInCents` can be:
- A specific override (e.g., `27900` → `R 279.00`)
- `null` → inherit the product's `priceInCents`

**UX in the variant list:**

| Variant `priceInCents` | Display in list |
|---|---|
| null | `(inherit)` shown in muted text. Helper: hovering shows *"Inherits R 249.00 from product."* |
| `27900` | `R 279.00` |

**UX in the variant edit form:**

```
Price override
[ R __________ ]   [ Inherit base price (R 249.00) ]
```

The "Inherit" button explicitly clears the override (sends `priceInCents: null`). Don't make the merchant guess that "leaving the field empty" means inherit — too easy to set `R 0.00` by accident.

When the form opens for a variant with `priceInCents: null`, show the field empty with a placeholder *"Inherits R 249.00"*.

---

## 9. Store collections (merchant-side)

Collections are merchant-curated groupings of their own products (e.g., "Summer 2026", "Limited Edition"). Per-store, flat (no hierarchy), and don't affect platform-wide discovery.

### Where collections live in the dashboard

A "Collections" section in the merchant dashboard — sibling to "Products". Merchants see a list of their collections, can create/edit/delete, and click into a collection to manage its products.

```
Collections                                        [ + New collection ]

┌──────────────────────────────────────────────┐
│ Summer 2026                                  │
│ "Hot picks for the season"                   │
│ 12 products · created 1 March 2026           │
│                                  [Edit] [×]  │
├──────────────────────────────────────────────┤
│ Limited Edition                              │
│ no description                               │
│ 4 products · created 15 April 2026           │
│                                  [Edit] [×]  │
└──────────────────────────────────────────────┘
```

> **Listing limitation:** there is **no `GET /stores/:storeId/collections` merchant endpoint**. The public endpoint `GET /stores/:slug/collections` only returns results for `ACTIVE` stores. For pre-launch merchants (`APPROVED`, `PENDING_GO_LIVE`), the frontend must **maintain a local list** of collections — populate from create/update calls, persist in client state (and optionally localStorage as a fallback). After the store goes `ACTIVE`, the public endpoint becomes available and can be used as the source of truth. Track this as a known limitation; coordinate with backend for a merchant-side list endpoint if it becomes friction.

### 9.1 Create a collection

**Entry:** "+ New collection" button.

**Form:**

```
Create a new collection

Name *               (e.g. "Summer 2026")
[___________________________________]

Description          (optional)
[___________________________________]

Image URL            (optional)
[___________________________________]

[ Cancel ]   [ Create collection ]
```

**Validation:**
- Name: 2–80 chars
- Description: 0–500 chars
- Image URL: valid URL if provided
- `sortOrder`: not exposed in the form for v1 (defaults to 0). Add a manual sort UI later if collections need it.

**API call:** `POST /stores/:storeId/collections` ([contract](./product-module-api.md#post-storesstoreidcollections))

**Success path (201):**
- Backend returns the full collection with auto-generated slug
- Add to local state
- Close form
- Toast: *"Collection \"{name}\" created."*

> **Slug is fixed at creation.** The backend does not regenerate the slug when the name changes (per [contract](./product-module-api.md#collection-slug-is-fixed)). Reflect this in the helper text: *"The collection's URL will be `/store/{storeSlug}/collections/{slug}` — set the name carefully."*

### 9.2 Edit a collection

**Entry:** `[Edit]` on a collection card.

Same form as create, with all fields pre-populated. **The slug field is not editable** — show it as read-only.

**API call:** `PATCH /stores/:storeId/collections/:collectionId` ([contract](./product-module-api.md#patch-storesstoreidcollectionscollectionid))

### 9.3 Delete a collection

**Entry:** `[×]` on a collection card.

**Confirmation:**

```
Title:  Delete "Summer 2026"?
Body:   The collection and its product groupings will be removed.
        Your products themselves will not be deleted — only this
        grouping.
Action: [ Cancel ]   [ Delete collection ]
```

**API call:** `DELETE /stores/:storeId/collections/:collectionId` ([contract](./product-module-api.md#delete-storesstoreidcollectionscollectionid))

### 9.4 Add and remove products from a collection

These actions can happen from two surfaces:

- **From the product editor's Collections section** ([§4.7](#47-collections-section)) — multi-select picker
- **From the collection detail screen** — click into a collection, see its products, add/remove there

The backend endpoints are the same:
- `POST /collections/:collectionId/products/:productId` (idempotent — returns existing if already linked)
- `DELETE /collections/:collectionId/products/:productId`

---

## 10. Admin — platform categories

Admins manage the platform-wide category taxonomy. Categories are hierarchical (a category can have a parent), are slug-unique platform-wide, and drive product discovery.

### Where it lives in the admin panel

A "Categories" section in the admin top-level navigation — sibling to "Store applications" and "Go-live applications".

### 10.1 Tree view

```
Platform categories                              [ + New category ]

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
  ▾ Skincare (10 products)
    Cleansers (4 products)                [Edit] [×]
    Moisturisers (6 products)             [Edit] [×]
  Fragrance (5 products)                  [Edit] [×]
```

- Indented tree with collapse/expand chevrons
- Per-node product count (computed via `_count.products` if backend exposes it; otherwise a separate query)
- Per-node action buttons: `[Edit]` and `[×]` (delete)
- Each indent level = one parent-child relationship

**API call (page load):** `GET /categories` (public, no auth) — returns the full tree with `children[]` nested per the [contract](./product-module-api.md#get-categories)

### 10.2 Create category

**Entry:** "+ New category" or `[+ Add child]` on a parent node.

**Form:**

```
Create category

Name *                  (e.g. "Hoodies")
[___________________________________]

Description             (optional)
[___________________________________]

Image URL               (optional)
[___________________________________]

Parent category         (optional — leave empty for root)
[ ▾ Select parent... ]

Sort order              (default 0; lower numbers appear first)
[ ____ ]

[ Cancel ]   [ Create category ]
```

**Parent picker:** opens the same tree view as the main page; click a node to select. The selected parent's path is shown in the picker.

**API call:** `POST /categories` ([contract](./product-module-api.md#post-categories))

**Success (201):**
- Backend returns the category with auto-generated slug and the `parent` object included
- Refetch the tree (or insert into local state)
- Toast: *"Category \"{name}\" created."*

### 10.3 Edit category (rename, reparent)

Same form as create, with the additional ability to **change the parent** (including setting `parentId: null` to make a category root).

**Cycle prevention:**

The backend rejects reparenting that would create a cycle (moving a parent into one of its own descendants) with `400 "Reparenting would create a cycle"`. Frontend can also detect this client-side before submitting:

```typescript
function wouldCreateCycle(targetCategoryId: string, newParentId: string, tree): boolean {
  // Walk up newParentId's chain — if you hit targetCategoryId, it's a cycle
  // (the new parent is a descendant of the target)
}
```

If detected client-side, disable the parent option in the picker:

```
[ ▾ Select parent... ]
  ▾ Fashion
    Streetwear  (this category — can't be its own parent)
      Hoodies   (descendant — would create a cycle)
  Beauty                                          ✓ available
```

If the user somehow submits an invalid reparent, the backend's 400 fires — surface as a banner: *"Can't move {name} here — it would create a loop in the tree."*

**API call:** `PATCH /categories/:id` ([contract](./product-module-api.md#patch-categoriesid))

### 10.4 Delete category

**Entry:** `[×]` on a category node.

**The blocked-deletion rules:**

The backend rejects deletion if any of:
- Category has child categories (`_count.children > 0`)
- Category has products linked to it (`_count.products > 0`)
- Category has store associations (`_count.storeCategories > 0`)

Each fires a different `409` error. The frontend should explain each clearly:

| Backend message | UX |
|---|---|
| `"Cannot delete a category that has child categories. Move or delete the children first."` | Replace confirmation with: *"This category has {N} child categories. Move or delete them first, then come back to delete this one."* List the children inline as a small read-only tree with "Edit" links. |
| `"Cannot delete a category that has products linked to it. Re-categorise the products first."` | Replace confirmation with: *"This category has {N} products linked. Re-categorise them first before you can delete it."* Provide a link to filter the admin's view of those products (or a count + link to the global catalog filtered to this category). |
| `"Cannot delete a category that stores are associated with. Remove store associations first."` | Replace confirmation with the same explanation. (Note: store-category associations are an admin/moderation feature; UI for managing them is out of scope here.) |

**Confirmation flow when delete is allowed:**

```
Title:  Delete "Hoodies"?
Body:   No products are linked to this category and it has no
        children — safe to delete. This can't be undone.
Action: [ Cancel ]   [ Delete category ]
```

**API call:** `DELETE /categories/:id` ([contract](./product-module-api.md#delete-categoriesid))

---

## 11. Edge cases & coordination

### 11.1 Image upload — cross-reference to store flows §7.3

The image upload pattern is identical to the one documented in [`store-frontend-flows.md` §7.3](./store-frontend-flows.md#73-image-upload--cloud-storage-first-patch-the-url-second): frontend uploads to cloud storage first, then sends the resulting URL to `POST /stores/:storeId/products/:productId/images` (or `PATCH /stores/:storeId/products/:id` for `logoUrl`/`bannerUrl` on the store).

**Product-specific recommendations:**

| Field | Recommended client-side validation |
|---|---|
| Product images | Min 800×800 (square preferred but not enforced), max 10MB, JPG/PNG/WebP |
| Product videos (`mediaType: VIDEO`) | Max 60 seconds, max 50MB, MP4/WebM |

These are not enforced by the backend (which just stores the URL), so the frontend is the gate.

### 11.2 Activation gate vs editor open — what's enabled when

The editor stays accessible across all statuses. Section availability:

| Section | DRAFT | ACTIVE | OUT_OF_STOCK | ARCHIVED |
|---|---|---|---|---|
| Basics | edit | edit | edit | read-only |
| Images | full | full (last-image rule) | full | read-only |
| Variants | full | full | full | read-only |
| Categories | full | full (last-category rule) | full | read-only |
| Tags | full | full | full | read-only |
| Collections | full | full | full | read-only |
| Activate button | **shown if 5/5** | hidden (already active) | **shown** (re-activate) | hidden |
| Archive button | hidden | shown | shown | hidden |
| Delete button | shown | hidden | hidden | hidden |

### 11.3 Archived product is read-only — UI consequences

Beyond disabling form inputs, also:
- Hide all `[+ Add ...]` buttons across sub-resource sections
- Replace the [More ▾] menu with nothing (no actions possible)
- The "Activate" CTA is hidden — can't reactivate archived products in v1
- Show a banner at the top: *"This product is archived. It's not visible to buyers. Create a new product to bring something similar back."*

### 11.4 Cross-store 404 — what the frontend sees

The contract returns `404 "Product not found"` (rather than 403) when:
- The product ID doesn't exist
- The product exists but belongs to a different store than the URL says

**Why:** prevents an attacker from enumerating product IDs to discover what other stores sell.

**Frontend implication:** `404` is a generic "product not found" — don't try to distinguish "wrong store" from "doesn't exist". Same error UI for both:

```
Product not found
This product doesn't exist or has been removed.
[ Back to products ]
```

This applies to all merchant product, variant, image, tag, category-link, and collection endpoints — the 404-not-403 pattern is consistent across the whole module per the contract.

### 11.5 Multi-tab editor

If the merchant has the editor open in two tabs and edits the same product in both, the patterns from [`store-frontend-flows.md` §7.4](./store-frontend-flows.md#74-multi-tab-merchant-setup) apply:

- **Recommended for v1:** refetch on tab focus. When tab B regains focus, refetch the product and overwrite local state. Last-write-wins on autosave.
- **Don't coordinate** with `BroadcastChannel` until usage data shows it matters.

For sub-resources (images, variants, etc.), the same model holds — refetch on focus.

---

## 12. UX patterns & copy guidance

### 12.1 Editor layout choice and autosave

Section-based single-page editor with sticky side nav, autosave per field. Same pattern as the store wizard ([store flows §2.2](./store-frontend-flows.md#22-store-setup-wizard-draft)). Do not implement a multi-step wizard — products are edited non-sequentially.

### 12.2 Currency formatting

| Display position | Format |
|---|---|
| Price, comparePrice, variant override | `R 249.00` (space after R, two decimals always) |
| Per-row inventory summary | `R 249.00` (no abbreviation in v1) |
| In confirmation modals | Full format, e.g. *"Activate \"Vintage Tee\" at R 249.00?"* |

Locale: `en-ZA` if you want native locale, or hand-rolled if `R` prefix isn't supported in your `Intl.NumberFormat` setup.

### 12.3 Confirmation dialogs (destructive vs non-destructive)

| Action | Confirmation? | Rationale |
|---|---|---|
| Activate | Yes (light) | Make the merchant pause to confirm the product is ready, but the action is reversible (archive or edit afterwards) |
| Archive | **Yes (firm)** | One-way action — no automatic reactivation |
| Delete | **Yes (firm)** | Permanent — cascades to sub-resources |
| Image delete (last on ACTIVE) | Replace with explanation modal (no destructive action available) | See [§4.3](#43-images-section) |
| Category remove (last on ACTIVE) | Same | See [§4.5](#45-categories-section) |
| Variant delete | Yes (light) | Stock loss is real — confirm |
| Tag remove | No | Reversible by re-adding the tag name |
| Collection remove | No | Reversible by adding back |
| Collection delete | Yes (light) | Cascades to product-collection links but products themselves stay |

### 12.4 Validation error display

| Error type | Where to show |
|---|---|
| Field-level (validation) | Inline below the field, red text, clears on edit |
| Activation multi-error | Top-of-form banner with all rules listed, plus the readiness-panel checkmarks updating |
| Last-image-on-ACTIVE | Replace deletion confirm with explanatory modal + recovery actions |
| Last-category-on-ACTIVE | Same |
| Tag cap reached | Inline below the tag input |
| Cross-store 404 | Full-page error state with "Back to products" |
| Network/5xx | Toast |

### 12.5 Empty-state copy bank

| Where | Copy |
|---|---|
| No products | *"Add your first product. You need at least 7 active products to go live. [+ Add your first product]"* |
| No products matching filters | *"No products match your filters. [Clear filters]"* |
| No archived products | *"You haven't archived any products yet."* |
| No images on a product | *"Add at least one image so buyers can see what they're buying. [+ Add image]"* |
| No variants on a product | *"This product has no variants. Buyers will see one option with the base price and stock. [+ Add variant if you offer choices]"* |
| No categories on a product | *"Categories help buyers find your product. Pick at least one to activate. [+ Add category]"* |
| No collections | *"Group your products into collections like \"Summer 2026\" or \"Limited Edition\". [+ New collection]"* |
| No platform categories (admin, fresh deploy) | *"Create the first category to start the platform taxonomy. [+ New category]"* |

### 12.6 Tone matrix per persona

| Persona | Tone | Example |
|---|---|---|
| Merchant — creating | Quick, frictionless | *"Add a product"* (not *"Initiate product creation"*) |
| Merchant — editing | Practical, supportive | *"Saved"*, *"Saving…"*, *"Save failed — retry"* |
| Merchant — activating | Confirming, reassuring | *"Once activated, your product will be visible to buyers on YIIVA."* |
| Merchant — archive/delete | Clear about consequences | *"This can't be undone."* / *"Archive is one-way."* |
| Merchant — error recovery | Constructive, not blaming | *"Couldn't activate yet — fix these and try again."* |
| Admin — categories | Functional, neutral | *"24 products · 3 children"* |
| Admin — delete blocked | Specific, actionable | *"Re-categorise the {N} products first, then come back to delete."* |

### Configuration values used in copy

The example copy throughout this document references `support@yiiva.co.za` as the support contact and `{PUBLIC_STORE_URL_BASE}/{storeSlug}/products/{productSlug}` as the public-product-link pattern. Treat both as **placeholders** — confirm the live values with the team and pull from frontend config (e.g. `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_PUBLIC_STORE_URL_BASE`) rather than hardcoding them across screens.

---

## 13. Testing checklist

Manual UX checks per flow. Run on a real device whenever product-module code changes.

### Inventory table
- [ ] Empty state shown when store has zero products, with link to "Add your first product"
- [ ] "Filtered to no results" state shown when filters yield zero
- [ ] Status pills colour-coded: DRAFT (grey), ACTIVE (green), OUT_OF_STOCK (amber), ARCHIVED (muted)
- [ ] Primary image thumbnail appears for products with images; placeholder for those without
- [ ] Sort by all 7 options changes the order correctly
- [ ] Search matches title and SKU, case-insensitive
- [ ] Filter by category narrows the list (verify with multi-category products)
- [ ] Filter by collection narrows the list
- [ ] Pagination works: page 1 → 2 → 3 → back to 1
- [ ] Per-row [More ▾] menu shows status-appropriate actions (no Delete on ACTIVE, no Archive on DRAFT, etc.)

### Create product
- [ ] Modal validates title (2–120) and price (≥ 0) on blur
- [ ] Submit with title only and price 0 → 201 (allowed for drafts)
- [ ] On 201 → navigate to editor, not back to inventory
- [ ] Toast confirms creation

### Editor — basics
- [ ] Autosave fires on blur for title / sku, debounced 800ms for description
- [ ] "Saving…" / "Saved" indicators per section
- [ ] Save failure shows retry option
- [ ] Char count visible on title and description
- [ ] Compare-price below current price shows soft warning
- [ ] Compare-price strike-through visible in card preview
- [ ] Price input handles cents-to-ZAR correctly: enter `249` → submitted as `24900`, displayed as `R 249.00`

### Editor — images
- [ ] Drag-and-drop reorders images (optimistic update, server confirms)
- [ ] First image added is auto-primary (PRIMARY pill appears)
- [ ] Click star on a non-primary image → it becomes primary, previous primary loses pill
- [ ] Add with `isPrimary: true` (via UI option) demotes existing primary
- [ ] Delete a non-last image → confirmation → 200 → removed from list, sortOrder compacts
- [ ] Try to delete last image on ACTIVE product → modal swaps to "you can't remove this — add another or archive"
- [ ] Add image vs add video produces different `mediaType` values; only IMAGE counts for activation
- [ ] Reorder requires exact set of current image IDs (test malformed input → 400)

### Editor — variants
- [ ] Add first variant on a bare product → modal warns about totalStock no longer being used
- [ ] After first variant added, Basics section's totalStock field becomes disabled
- [ ] Variant with `priceInCents: null` shows "(inherit)" in list
- [ ] Variant edit form has explicit "Inherit base price" toggle
- [ ] Setting variant priceInCents to 0 fails activation (5/5 doesn't reach)
- [ ] Setting variant priceInCents to null is allowed and inherits
- [ ] Delete last variant on ACTIVE product → succeeds (no last-variant rule)
- [ ] After delete-all-variants, Basics totalStock re-enables with original value preserved

### Editor — categories
- [ ] Tree picker shows full hierarchy with paths
- [ ] Search filters the tree
- [ ] Adding an already-linked category returns silently (no error)
- [ ] Last-category-on-ACTIVE removal blocked, recovery modal shown

### Editor — tags
- [ ] Type a tag and Enter → normalised to lowercase before submit
- [ ] Adding 21st tag → 400 inline error "20-tag limit"
- [ ] Adding an existing tag returns silently
- [ ] Remove tag uses Tag.id, not ProductTag.id (verify with multiple products sharing the same tag)

### Editor — collections
- [ ] Multi-select picker shows merchant's collections
- [ ] Adding a product to a collection it's already in returns silently
- [ ] "+ Create new collection" inline opens the create modal without leaving editor

### Activation
- [ ] Readiness panel shows live progress as merchant edits (5 checkmarks)
- [ ] Activate button disabled until 5/5
- [ ] Hover on disabled button shows tooltip
- [ ] Click an X row → scrolls to the relevant editor section
- [ ] Submit activate → 200 → product status flips to ACTIVE
- [ ] Submit activate with stale local state (race) → 400 with string-array message → banner with all rules listed
- [ ] Already-active activate → 200 no-op, response shape matches normal success
- [ ] Try to activate ARCHIVED product → 409 banner with "create a new product" message
- [ ] Post-activation card shows public link, copy-link button works

### Archive
- [ ] Archive ACTIVE product → confirmation → 200 → status ARCHIVED, editor goes read-only
- [ ] Try to archive DRAFT → 409 with "delete instead" recovery
- [ ] Already-archived archive → 200 no-op

### Delete
- [ ] Delete DRAFT → confirmation → 200 → product gone, return to inventory
- [ ] Delete option hidden on non-DRAFT products
- [ ] Try to delete ACTIVE (force the request) → 409 with "archive instead" recovery

### Stock and pricing
- [ ] Bare product totalStock works in Basics
- [ ] Adding first variant disables totalStock
- [ ] Variant stock independent — adding 50 to one variant doesn't affect another
- [ ] Variant priceInCents=null inherits product price in cards and detail
- [ ] reservedStock NOT visible in any merchant UI

### Store collections
- [ ] Create collection → 201 → appears in local state
- [ ] Edit collection → 200 → name updates but slug stays
- [ ] Delete collection → 200 → removed from list, products unaffected
- [ ] Add product to collection from editor → 200 → appears in collection
- [ ] Add same product again → silent (idempotent)
- [ ] Remove product from collection → 200 → removed
- [ ] Pre-ACTIVE store: no `GET /collections` endpoint — local list works

### Admin categories
- [ ] Tree view shows hierarchy with collapse/expand
- [ ] Per-node product count visible
- [ ] Create root category (no parent) → 201
- [ ] Create child category (with parent) → 201, appears under parent
- [ ] Reparent a category → 200, tree updates
- [ ] Try to make a category its own parent → 400 with friendly message
- [ ] Try to reparent into a descendant → 400 with friendly message
- [ ] Frontend pre-filters cycle-creating options in the parent picker
- [ ] Delete a category with children → 409 with explanation, list of children shown
- [ ] Delete a category with linked products → 409 with explanation, count shown
- [ ] Delete a clean category → confirmation → 200

### Cross-cutting
- [ ] Multi-tab editor: edit in tab A, focus tab B → tab B refetches
- [ ] All confirmations are keyboard-accessible
- [ ] Form labels associated with inputs (screen readers)
- [ ] Error banners use `role="alert"`
- [ ] Color contrast on status pills ≥ 4.5:1
- [ ] All currency inputs/displays handle `0` cents correctly
