# YIIVA Catalogue — Mobile App Flows & UX Guide

> **Audience:** Frontend engineers building the YIIVA **buyer mobile app** on Expo / React Native.
> **Scope:** Screen-level flows for browsing the catalogue — Home/Discover, search, category browse, store profile, store catalogue, product detail, collection browse. Mobile-specific patterns for image loading, pagination, error/empty states.
>
> **Companion docs:**
> - [`auth-flows.md`](./auth-flows.md) — auth surface; this doc assumes a working auth layer (most catalogue endpoints are public but `GET /stores/:slug` requires auth — see [§5](#5-known-backend-gaps)).
> - [`../Api-frontend-contracts/product-module-api.md`](../Api-frontend-contracts/product-module-api.md) — endpoint shapes, request/response, error tables for the **merchant-facing** product endpoints. Public/buyer endpoints are not yet covered there; this doc is the interim source of truth for them.

---

## Table of Contents

1. [Context](#1-context)
2. [Available endpoints summary](#2-available-endpoints-summary)
3. [Screen-level flows](#3-screen-level-flows)
   - [3.1 Home / Discover](#31-home--discover)
   - [3.2 Search](#32-search)
   - [3.3 Category browse](#33-category-browse)
   - [3.4 Store profile](#34-store-profile)
   - [3.5 Store catalogue](#35-store-catalogue)
   - [3.6 Product detail](#36-product-detail)
   - [3.7 Collection browse](#37-collection-browse)
4. [Mobile patterns](#4-mobile-patterns)
5. [Known backend gaps](#5-known-backend-gaps)
6. [Testing checklist](#6-testing-checklist)
7. [Endpoint cross-reference](#7-endpoint-cross-reference)

---

## 1. Context

The buyer mobile app's primary job is product discovery. Everything in this doc supports that single goal — get a buyer from "I'm bored" or "I'm looking for X" to a product they want to buy, fast.

The catalogue surface is **mostly public** (no auth required) — buyers can explore without signing in. Sign-in is only requested at moments of intent: save to wishlist, add to cart, follow a store, checkout. This guide treats the buyer as unauthenticated unless otherwise noted; flows that *do* require auth call it out inline.

### What "catalogue" includes

| Surface | Purpose |
|---|---|
| **Home / Discover** | Curated entry point — newest products, featured stores (when those endpoints land), browse-by-category gateway |
| **Search** | Text-based query across product titles |
| **Category browse** | Hierarchical category tree → filtered product list |
| **Store profile** | Brand-page: cover, story, follower count, locations, product count |
| **Store catalogue** | Products belonging to a single store, with filters |
| **Product detail** | Full product page — gallery, description, variants, price, add-to-cart |
| **Collection browse** | Store-curated groupings (e.g., "Summer 2026") |

This doc does **not** cover cart, wishlist, checkout, or orders. Those are forthcoming Phase 3+ docs.

---

## 2. Available endpoints summary

All endpoints below are `@Public()` on the backend — no auth required — **except where flagged**.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/products` | Public | Cross-store catalogue (the main browse/search endpoint). Supports filters: category, tag, price range, text search, sort, collection. Paginated. |
| `GET` | `/categories` | Public | Full nested category tree. |
| `GET` | `/categories/:slug/products` | Public | Products in a specific category (and its descendants). |
| `GET` | `/stores/:slug/products` | Public | Per-store catalogue. Same filter set as `/products` but scoped to one store. |
| `GET` | `/stores/:slug/products/:productSlug` | Public | Product detail. |
| `GET` | `/stores/:slug/collections` | Public | Store's collections (with product counts). |
| `GET` | `/stores/:slug` | Public (optional auth) | Store profile. Unauthenticated → `isFollowing: false`. With JWT → `isFollowing` reflects the current user. |

### Shared query parameters (catalogue endpoints)

`GET /products`, `GET /stores/:slug/products`, and `GET /categories/:slug/products` all accept the same query DTO:

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | integer | `1` | Min 1 |
| `limit` | integer | `20` | Min 1, max 50 |
| `categorySlug` | string | — | Filters to products in the category (and descendants) |
| `tagName` | string | — | Trimmed + lowercased server-side |
| `priceMin` | integer (cents) | — | Inclusive |
| `priceMax` | integer (cents) | — | Inclusive |
| `search` | string | — | Substring match against `title` (case-insensitive) |
| `sortBy` | string | `"newest"` | One of: `newest`, `priceAsc`, `priceDesc` |
| `collectionSlug` | string | — | Filters to products in the named collection |

### Shared response shapes

**Catalogue list item** (returned by `/products`, `/stores/:slug/products`, `/categories/:slug/products`):

```ts
{
  id: string;
  title: string;
  slug: string;
  priceInCents: number;
  comparePriceInCents: number | null;   // "original price" for sale display
  images: [{ url: string; altText: string | null }];  // primary image only
  store: { displayName: string; slug: string };
}
```

**Paginated envelope:**

```ts
{
  data: CatalogueListItem[],
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }
}
```

**Product detail** (returned by `GET /stores/:slug/products/:productSlug`):

```ts
{
  id: string;
  title: string;
  slug: string;
  description: string | null;
  priceInCents: number;
  comparePriceInCents: number | null;
  totalStock: number;
  publishedAt: string;  // ISO 8601
  images: [{ id, url, altText, mediaType, sortOrder, isPrimary }];
  variants: [{
    id, name, color, size, material,
    priceInCents: number | null,           // null = inherits base price
    effectivePriceInCents: number,         // computed: variant.priceInCents ?? product.priceInCents
    stock: number,
    sortOrder: number
  }];
  categories: [{ category: { id, name, slug } }];
  tags:       [{ tag:      { id, name, slug } }];
  store: {
    displayName: string;
    slug: string;
    logoUrl: string | null;
    followerCount: number;
  };
}
```

**Category tree** (returned by `GET /categories`):

```ts
[
  {
    id, name, slug, description, imageUrl, parentId: null, sortOrder,
    children: [
      { id, name, slug, ..., children: [...] }
    ]
  },
  ...
]
```

Nested arbitrarily; each node has a `children` array (empty for leaves).

---

## 3. Screen-level flows

### 3.1 Home / Discover

**Entry:** the default landing tab in the bottom tab bar. First screen on cold-start (after splash + silent-refresh resolves).

**What the user sees (v1 layout):**

A vertically scrolling feed composed of these sections, top to bottom:

1. **Hero / search prompt** — fixed-height card with the YIIVA wordmark, a tap-to-search affordance, and a subtle invitation copy: *"Discover South African brands."*
2. **Browse by category** — horizontal scroller of top-level category cards (image + name). Tapping pushes [§3.3 Category browse](#33-category-browse).
3. **New arrivals** — horizontal product carousel from `GET /products?sortBy=newest&limit=10`. Tapping a card pushes [§3.6 Product detail](#36-product-detail).
4. *(Future)* **Featured stores** — horizontal scroller of curated stores. Out of v1 scope — no backend endpoint yet ([§5](#5-known-backend-gaps)).
5. **All products** — infinite-scroll grid (2 columns) hitting `GET /products` paginated.

**API calls on screen mount:**

- `GET /categories` — for the category scroller (one-shot, cache for the session)
- `GET /products?sortBy=newest&limit=10` — for new arrivals
- `GET /products?page=1&limit=20` — first page of the all-products grid

Fire these **in parallel** with `Promise.all`. Don't sequentially wait — the screen renders sections as they resolve, with skeleton loaders per section.

**Loading states:**
- **Skeleton cards** in each section while data loads — same dimensions as final cards, animated shimmer.
- **Pull-to-refresh** at the top of the scroll view → re-fires all three calls.

**Error paths:**

| Section | Failure UX |
|---|---|
| Category scroller | Hide silently; the rest of the screen still renders. Log to error tracker. |
| New arrivals | Hide the section title + content; rest renders. |
| All products grid (first page) | Replace with centered error state: icon + *"Couldn't load products. Pull to refresh."* |
| Pagination page > 1 | Inline footer in the grid: *"Couldn't load more. Tap to retry."* — non-blocking |

**Empty states:**
- All products empty (zero ACTIVE products platform-wide) is highly unlikely in production but possible in early development. Replace the grid with: *"No products yet. Check back soon."*

---

### 3.2 Search

**Entry:** the user taps the search affordance on Home, or the search icon in any header.

**What the user sees:**

A full-screen search overlay with:

- **Search input** — autofocus, `keyboardType: default`, `returnKeyType: search`, clear button on the right when populated
- **Recent searches** (when input is empty) — last 5 from device-local storage (`expo-secure-store` not needed; `AsyncStorage` is fine for non-sensitive data)
- **Results grid** — 2-column product grid, same component as Home's all-products grid

**Search behaviour:**

- **Debounce** the input by **400ms** before firing the API call. Too short and you spam the backend on every keystroke; too long and the user thinks the app is broken.
- **Cancel in-flight requests** when a new keystroke fires — use `AbortController`.
- Show *"Searching for **{query}**…"* helper text below the input while in flight.

**API call:** `GET /products?search=<query>&page=1&limit=20` (see [§2](#2-available-endpoints-summary))

**Success path:**
- Render the paginated grid. Infinite-scroll loads more pages with the same `search` term.
- Save the query to recent searches **only when the user taps a result** (not on every keystroke) — that's the signal it was a successful query.

**Empty result UX:**
- *"No products match **'{query}'**. Try different keywords or browse by category."*
- Below: shortcuts to top-level categories.

**Error paths:**

| Response | UX |
|---|---|
| Network/5xx | Centered error state with retry button. |
| `400` query validation | Inline error below the input — *"That search couldn't be processed."* |
| `429` | Toast: *"Searching too quickly. Try again in a moment."* — keep input enabled. |

> **Backend limitation:** search is `WHERE title ILIKE '%query%'` only — no SKU, no description, no fuzzy matching, no typo tolerance. Single-word queries work best; multi-word queries match the literal substring. Set expectations in copy (*"Try shorter keywords"* in the empty state). A search overhaul (e.g., Postgres full-text or Algolia) is a future backend follow-up.

---

### 3.3 Category browse

**Entry:** tap on a category card from Home's category scroller, or from the category tree screen (accessible from "All categories" link).

**Two screens are involved:**

#### 3.3.a Category tree (`CategoriesScreen`)

A flat list rendered from the nested tree returned by `GET /categories`:

- **Top-level categories** as large rows (image + name + chevron)
- Tapping a row that has `children` opens a nested list (push navigation) showing its children
- Tapping a leaf category pushes `CategoryDetailScreen`

Optional v1+: render the tree as accordion-style expansions on a single screen. Push-nav is simpler and matches platform conventions.

#### 3.3.b Category detail (`CategoryDetailScreen`)

Shows products in the category (including its descendants).

- Header: category name + (optional) description + image
- Body: infinite-scroll product grid

**API call:** `GET /categories/:slug/products?page=1&limit=20` (filters from [§2](#2-available-endpoints-summary) apply)

**Top-of-screen filter bar (v1+):**
- "Newest" / "Price ↑" / "Price ↓" — maps to `sortBy`
- "Filters" → opens a bottom sheet with price min/max + tag picker

**Empty state:** *"No products in this category yet."* + a back action to the parent category.

**Error paths:** same as Home's all-products grid.

---

### 3.4 Store profile

**Entry:** tap on the store name/logo on a product detail screen, on a product card, or on a store card from a future "featured stores" surface.

**Auth:** public, optional. Unauthenticated buyers see the full profile with `isFollowing: false`. Authenticated buyers see their actual follow state.

**What the user sees:**

- **Banner media** — full-bleed carousel using `bannerMedia[]` (images + videos, up to 5 items, ordered by `sortOrder`). Use `expo-av` for videos with `shouldPlay={false}` until the user taps. Auto-advance images at 4s intervals.
- **Header overlay** on the banner: store logo (rounded), `displayName`, follower count, average rating
- **Action row**: "Follow" / "Following" toggle button, "Share store" (share-sheet)
- **About** — `description` and `story` (collapsed by default with a "Read more" expander if long)
- **Locations** — chip row of unique cities from `locations[]`
- **Product count badge** — *"{productCount} products"*
- Below: a small CTA button **"Browse {displayName}'s products"** → [§3.5 Store catalogue](#35-store-catalogue)
- Or: render the catalogue grid directly below the profile fields on the same screen (single-screen pattern; more mobile-native)

**API call:** `GET /stores/:slug` (see [contract](../Api-frontend-contracts/store-module-api.md) — search for `getPublicStore`)

**Response shape (relevant fields):**

```ts
{
  id, displayName, slug, description, story, logoUrl,
  bannerMedia: [{ id, url, mediaType, sortOrder, isPrimary }],
  websiteUrl, averageRating, followerCount, totalSales,
  locations: string[],          // distinct cities from store.addresses
  productCount: number,         // count of ACTIVE products
  isFollowing: boolean,         // ← this is what currently makes the endpoint require auth
  createdAt: ISO 8601
}
```

**Success path:** render the screen.

**Error paths:**

| Response | UX |
|---|---|
| `404 "Store not found"` | Full-screen empty state: *"This store isn't available right now."* + back action. Cause: store doesn't exist OR isn't ACTIVE (suspended/draft). The backend deliberately conflates these — don't distinguish. |
| Network/5xx | Centered retry state. |

**Follow / unfollow:** requires auth. If the user taps Follow while signed out, push to `LoginScreen` with `returnTo: { screen: 'StoreProfile', params: { slug } }`. After login, the screen reloads with `isFollowing` available.

---

### 3.5 Store catalogue

**Entry:** "Browse all products" from [§3.4 Store profile](#34-store-profile), or a deeper navigation flow.

Same UX as [§3.3.b Category detail](#33-category-browse) — header showing the store identity + a paginated product grid.

**API call:** `GET /stores/:slug/products?page=1&limit=20` (see [§2](#2-available-endpoints-summary) for the filter set)

**Filters:**
- Default: `sortBy=newest`
- Filter bar identical to category detail — sort + price range + (mobile-specific) **collection picker** sourced from `GET /stores/:slug/collections`

**Error paths:** same as catalogue-list screens elsewhere in this doc.

---

### 3.6 Product detail

**Entry:** tap on any product card from any catalogue surface.

**What the user sees (top to bottom):**

1. **Image gallery** — full-width swipeable carousel using `expo-image`. Pinch-to-zoom on tap. Image dots indicator at the bottom of each slide. Mixed images + videos — videos play inline on tap. **All sourced from Cloudinary** — use Cloudinary's URL-based transforms for responsive sizing (`f_auto,q_auto,w_800`).
2. **Title and price** — title in 20pt semibold, price in 24pt bold. If `comparePriceInCents > priceInCents`, render the compare price struck-through next to the active price in a muted color, and show a discount chip (*"15% off"* calculated client-side).
3. **Store header card** — logo + displayName + follower count + chevron → [§3.4 Store profile](#34-store-profile)
4. **Stock indicator** — *"In stock"* (totalStock > 5), *"Only N left"* (1-5), *"Out of stock"* (0). Calculate using the relevant stock source (variant vs product — see "Variant selection" below).
5. **Variant selectors** (if `variants.length > 0`) — see "Variant selection" below
6. **Add to cart button** — sticky to the bottom of the screen. Disabled when out of stock. Label: *"Add to cart"* → spinner + *"Adding…"* in flight.
7. **Description** — full text, expandable if long
8. **Categories and tags** — chip rows. Tapping a category chip pushes the [§3.3 category detail](#33-category-browse). Tapping a tag fires `GET /products?tagName=<name>` in a new screen.
9. *(Optional v1+)* **Related products** — horizontal scroller. **No related-products endpoint exists** — workaround is to fetch `GET /categories/:slug/products` for the product's primary category, excluding the current product.

**API call:** `GET /stores/:slug/products/:productSlug` — see the full response shape in [§2](#2-available-endpoints-summary).

**Variant selection:**

YIIVA uses **independent SKU** — a product without variants tracks `totalStock` directly; a product with variants tracks each variant's `stock` independently. Stock and the active price both depend on whether a variant is selected:

| Product shape | Active price | Active stock |
|---|---|---|
| No variants (`variants.length === 0`) | `priceInCents` | `totalStock` |
| Has variants, none selected | Lowest `effectivePriceInCents` across variants; show "from R{price}" label | Sum of variant stocks (informational only — user must select before adding) |
| Has variants, one selected | `selectedVariant.effectivePriceInCents` | `selectedVariant.stock` |

**Selector UI:**
- If variants have distinct `color` values: render a horizontal color swatch row.
- If variants have distinct `size` values: render a row of size chips.
- If multiple axes (color + size): two rows, color above size.
- Variants that are out of stock should still be visible but visually disabled (greyed out, tap shows a toast: *"This option is out of stock."*).

**Add to cart:**
- Requires auth-or-guest-session for the cart endpoint (covered in the forthcoming cart-flows doc).
- If a product has variants and none is selected, disable the button with helper text: *"Select an option to add to cart."*

**Error paths:**

| Response | UX |
|---|---|
| `404 "Product not found"` | Full-screen *"This product isn't available."* + back action. Conflates "product doesn't exist", "product not ACTIVE", "store not ACTIVE", "wrong slug-pair" — don't try to distinguish. |
| Network/5xx | Centered retry. |

**Stale-cache edge:** if the user taps a product card from a list, the list-item data shows immediately as the page transitions — then the full detail fetch may reveal the product is now out of stock or unavailable. Show the new state without alarm; the list-card price/title was a hint, not a contract.

---

### 3.7 Collection browse

**Entry:** tap on a collection chip on a product detail page, or tap a collection card on a store profile (when the layout includes one).

**What the user sees:**

- Header: collection name + (optional) description + cover image
- Body: infinite-scroll product grid scoped to this collection

**Two paths to fetch:**

1. **Fetch the collection list first**, find the slug, then filter the catalogue:
   - `GET /stores/:slug/collections` returns all collections for that store with `productCount`
   - Then `GET /stores/:slug/products?collectionSlug=<slug>&page=1&limit=20`
2. *(Future)* a dedicated `GET /stores/:slug/collections/:collectionSlug` endpoint with products embedded — not yet available.

For v1, **path 1** is the only option. The collections list call can be cached at the store-profile level so this screen reuses it.

**Empty state:** *"No products in this collection yet."*

**Error paths:** same as other catalogue-list screens.

---

## 4. Mobile patterns

### Image loading

Use **`expo-image`** for all product / store images. It handles:
- Automatic memory + disk caching
- Placeholder + blur-hash transitions
- Cancellation on screen unmount

**Cloudinary transforms** — all image URLs in API responses point at `https://res.cloudinary.com/yiiva-prod/...`. Append size-appropriate transforms in the URL:

```ts
function transform(url: string, w: number) {
  return url.replace(
    '/upload/',
    `/upload/f_auto,q_auto,w_${w},c_limit/`
  );
}

<Image source={{ uri: transform(item.images[0].url, 800) }} />
```

`f_auto` picks the best format per client, `q_auto` picks optimal quality, `w_<n>` resizes to the requested width with `c_limit` (no upscale).

Common widths:
- Product card thumbnail (2-col grid): `w_400`
- Product detail hero gallery: `w_1200`
- Store logo: `w_200`
- Store banner: `w_1200`

### Pagination

Use **infinite scroll** for product grids. FlatList / FlashList with:

```ts
onEndReached={() => fetchPage(currentPage + 1)}
onEndReachedThreshold={0.5}     // trigger when 50% from the bottom
```

Append `data.data` to existing state; track `meta.totalPages` to stop firing requests once you've loaded all pages.

**Footer states:**
- Loading next page: spinner row
- Error loading next page: tap-to-retry row
- Reached the end: no footer (or *"You've seen everything"* sentinel)

### Pull-to-refresh

Use `RefreshControl` on every scrollable catalogue screen. Refreshes reset to page 1.

### Prefetch

When a product card is **about to** become visible (within ~200px of the viewport), trigger an image prefetch:

```ts
import { Image } from 'expo-image';
Image.prefetch([imageUrl]);
```

This dramatically improves perceived responsiveness when scrolling fast.

### Empty / error / loading state hierarchy

Every catalogue screen has four states. Render them consistently:

| State | Component |
|---|---|
| Loading (initial) | Full-screen skeleton matching the final layout |
| Loaded with data | Normal render |
| Loaded empty | Empty-state component (icon + headline + body + optional secondary action) |
| Failed | Error-state component (icon + headline + retry button) |

Use a single `CatalogueScreenShell` wrapper that takes a `state` prop and renders the right child — keeps the per-screen code clean.

### Skeleton design

Skeletons should match the eventual layout closely — same dimensions, same card spacing, same number of placeholder cards (usually 4-6 for grids). Animate with a subtle horizontal gradient shimmer at 1.5s loop. Don't use spinners for catalogue screens — skeletons feel faster.

---

## 5. Known backend gaps

These are blockers or degradations the mobile team will hit during Phase 2. Each lists the user impact + recommended backend fix. Track these as backend follow-ups; the mobile app can ship Phase 2 without them by leaning on the workarounds noted below.

### 5.1 ~~`GET /stores/:slug` requires auth~~ — **resolved (May 2026)**

The route was rewired to `@Public()` + `OptionalJwtAuthGuard`. Unauthenticated buyers receive the full store profile with `isFollowing: false`. Authenticated buyers receive their actual follow state — the backend skips the `storeFollower` lookup when no `userId` is present.

Mobile no longer needs the LoginScreen workaround; tap-into-store from product cards works without auth. See `store.service.spec.ts` for the regression-guard tests.

### 5.2 No "browse stores" endpoint — **degrades discovery**

**Current state:** there is no `GET /stores` public endpoint that returns a paginated list of active stores. Buyers can only reach stores by:
1. Tapping a product card → tapping the store header on the product detail
2. Following a deep link to a known store slug

**Impact:** the Home screen cannot show a "Featured stores" or "All stores" surface. Discovery is product-first only.

**Recommended backend fix (Phase 2.5):**

Add `GET /stores` (Public) with:
- Filters: `featured` (boolean), `search` (substring on displayName)
- Sort: `newest`, `mostFollowed`, `topRated`
- Response shape: paginated list of `{ id, slug, displayName, logoUrl, bannerMedia[primary only], followerCount, averageRating, productCount }`

Effort: ~2 hours including a public-store-list controller, service method, and tests.

**Mobile workaround until fixed:** omit the "Featured stores" rail from Home; reach store profiles only via product cards.

### 5.3 No featured / curated endpoint — **future**

The merchant doc references future curation surfaces but none exist today. Out of v1 scope; mobile uses `sortBy=newest` as the default surface.

### 5.4 Search is substring-only — **acceptable for v1**

`?search=` does a case-insensitive substring match on `title` only. No SKU, description, fuzzy matching, or typo tolerance.

**Mobile workaround:** copy guidance in the search empty state — *"Try shorter keywords or browse by category."*

A search engine integration (Postgres full-text or Algolia) is a future backend project — likely post-mobile-v1.

### 5.5 No related-products endpoint — **acceptable for v1**

Mobile can simulate "Related products" by fetching `GET /categories/:primaryCategorySlug/products` and filtering out the current product client-side. Adequate UX for v1.

---

## 6. Testing checklist

Test on a real device — image loading, infinite scroll, and pull-to-refresh behave differently from the simulator.

### Home
- [ ] Cold-start lands on Home — three sections render in parallel (no waterfalls)
- [ ] Pull-to-refresh refetches all three sections
- [ ] Category scroller failure doesn't break the screen (rest still renders)
- [ ] All-products grid scrolls smoothly through 10+ pages with no jank

### Search
- [ ] Typing fires API call only after 400ms idle
- [ ] Rapid typing cancels in-flight requests (no race conditions)
- [ ] Empty input shows recent searches
- [ ] Empty result shows category shortcuts
- [ ] Pressing 'search' on the keyboard fires the query immediately (bypass debounce)

### Category browse
- [ ] Tree screen renders nested children correctly
- [ ] Tapping a parent with children opens a nested list, not a product list
- [ ] Tapping a leaf opens the product list
- [ ] Filter bar applies sort + price filters and updates URL params

### Store profile
- [ ] Authenticated user sees `isFollowing` correctly toggled
- [ ] Banner media carousel handles a mix of images + videos
- [ ] Banner with 5 items advances correctly; with 1 item shows no carousel chrome
- [ ] Follow button updates optimistically + reverts on failure
- [ ] Unauthenticated user sees the full store profile with `isFollowing: false` (no LoginScreen push)
- [ ] Tapping Follow while signed out pushes to LoginScreen with `returnTo`; after login, the store profile reloads with the correct follow state

### Product detail
- [ ] Variant selector renders correctly for single-axis (color OR size) and dual-axis (color + size)
- [ ] Out-of-stock variants are visible but disabled with explanatory toast on tap
- [ ] Add to cart is disabled until a variant is selected (when variants exist)
- [ ] Compare price renders with strikethrough + discount chip
- [ ] Image gallery handles a mix of images + videos; pinch-zoom works on images
- [ ] Tapping the store header navigates to store profile (with auth-push as needed)

### Collection browse
- [ ] Reachable from product detail's collection chips
- [ ] Empty collection state renders correctly
- [ ] Same filter bar as store catalogue

### General mobile patterns
- [ ] Pull-to-refresh on every catalogue screen
- [ ] Infinite scroll triggers at ~50% from bottom
- [ ] Footer states (loading, retry, end-reached) render correctly
- [ ] Skeleton loaders show on initial load, not on subsequent pages
- [ ] Image prefetch reduces visible loading on fast scrolls
- [ ] Cloudinary transforms applied at appropriate widths (no full-resolution images on small cards)

---

## 7. Endpoint cross-reference

| Endpoint | Used in |
|---|---|
| `GET /products` | [§3.1 Home](#31-home--discover), [§3.2 Search](#32-search) |
| `GET /categories` | [§3.1 Home](#31-home--discover), [§3.3 Category browse](#33-category-browse) |
| `GET /categories/:slug/products` | [§3.3 Category browse](#33-category-browse) |
| `GET /stores/:slug` | [§3.4 Store profile](#34-store-profile) — public (optional auth) |
| `GET /stores/:slug/products` | [§3.5 Store catalogue](#35-store-catalogue), [§3.7 Collection browse](#37-collection-browse) |
| `GET /stores/:slug/products/:productSlug` | [§3.6 Product detail](#36-product-detail) |
| `GET /stores/:slug/collections` | [§3.7 Collection browse](#37-collection-browse), and the collection picker on [§3.5 Store catalogue](#35-store-catalogue) |
