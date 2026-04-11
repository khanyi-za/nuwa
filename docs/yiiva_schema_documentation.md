# YIIVA — Database Schema Documentation

> Technical reference for all 36 database models and enums in the YIIVA platform.
> Stack: NestJS + Prisma + PostgreSQL

---

## Table of Contents

- [Enums](#enums)
  - [Why Enums?](#why-enums)
  - [UserRole](#userrole)
  - [AccountStatus](#accountstatus)
  - [StoreStatus](#storestatus)
  - [ProductStatus](#productstatus)
  - [OrderStatus](#orderstatus)
  - [PaymentStatus](#paymentstatus)
  - [PaymentMethod](#paymentmethod)
  - [ShipmentStatus](#shipmentstatus)
  - [PayoutStatus](#payoutstatus)
  - [NotificationType](#notificationtype)
  - [ContentType](#contenttype)
  - [SupportTicketStatus](#supportticketstatus)
  - [SupportTicketPriority](#supportticketpriority)
  - [DiscountType](#discounttype)
- [Models](#models)
  - [Users & Auth](#users--auth)
    - [User](#1-user)
    - [RefreshToken](#2-refreshtoken)
    - [Address](#3-address)
  - [Stores & Brands](#stores--brands)
    - [Store](#4-store)
    - [StoreFollower](#5-storefollower)
    - [StoreAddress](#6-storeaddress)
    - [StoreEmployee](#7-storeemployee)
    - [Category](#8-category)
    - [StoreCategory](#9-storecategory)
    - [StoreCollection](#10-storecollection)
    - [ProductCollection](#11-productcollection)
  - [Products & Catalog](#products--catalog)
    - [Product](#12-product)
    - [ProductVariant](#13-productvariant)
    - [ProductImage](#14-productimage)
    - [ProductCategory](#15-productcategory)
  - [AI Tagging & Discovery](#ai-tagging--discovery)
    - [Tag](#16-tag)
    - [ProductTag](#17-producttag)
  - [Content / Shoppable Media](#content--shoppable-media)
    - [ContentPost](#18-contentpost)
    - [ContentPostProduct](#19-contentpostproduct)
  - [Cart & Wishlist](#cart--wishlist)
    - [Cart](#20-cart)
    - [CartItem](#21-cartitem)
    - [WishlistItem](#22-wishlistitem)
  - [Orders](#orders)
    - [Order](#23-order)
    - [OrderItem](#24-orderitem)
  - [Payments](#payments)
    - [Payment](#25-payment)
    - [Payout](#26-payout)
  - [Shipping & Delivery](#shipping--delivery)
    - [Shipment](#27-shipment)
    - [ShipmentTrackingEvent](#28-shipmenttrackingevent)
  - [Reviews](#reviews)
    - [Review](#29-review)
  - [Promotions & Discounts](#promotions--discounts)
    - [Promotion](#30-promotion)
    - [PromotionUsage](#31-promotionusage)
  - [Notifications](#notifications)
    - [Notification](#32-notification)
  - [Customer Support](#customer-support)
    - [SupportTicket](#33-supportticket)
    - [SupportMessage](#34-supportmessage)
  - [Standalone / Utility](#standalone--utility)
    - [WaitlistEntry](#35-waitlistentry)
    - [AnalyticsEvent](#36-analyticsevent)

---

# Enums

## Why Enums?

Enums restrict a field to a predefined set of valid values, enforced at the database level. Without them, a `status` field would just be a `String`, and any typo or inconsistency (like "active" vs "Active" vs "ACTVE") would corrupt your data. Enums give you three things:

1. **Data integrity** — only valid values can be stored
2. **Developer experience** — your IDE autocompletes the options and TypeScript catches invalid values at compile time
3. **Readability** — anyone looking at the schema immediately understands the possible states

In PostgreSQL, Prisma creates actual database-level enum types, so the constraint is enforced even if someone runs a raw SQL query outside your application code.

---

## UserRole

```
BUYER, MERCHANT, ADMIN
```

This controls what a user can do across the entire platform. Your API guards and middleware will check this on almost every request. A BUYER can browse, purchase, and leave reviews. A MERCHANT can do everything a buyer can plus manage their store, products, and view analytics. An ADMIN can moderate stores, manage categories, handle support escalations, and access platform-level dashboards.

We use an enum rather than a separate roles table because YIIVA's roles are simple and fixed — you're not building a complex RBAC system with custom permissions. If a user's role changes (buyer becomes a merchant), you update one field. The role also determines which app experience they see — buyers get the shopping app, merchants get the dashboard.

---

## AccountStatus

```
ACTIVE, SUSPENDED, DEACTIVATED, PENDING_VERIFICATION
```

This controls whether a user can use the platform at all, and it's separate from UserRole because they're independent concerns. A merchant can be ACTIVE or SUSPENDED regardless of their role.

- **PENDING_VERIFICATION** is the default for new signups — the user has registered but hasn't confirmed their email or phone yet. Your auth flow blocks login or purchasing until they verify.
- **ACTIVE** means everything is good.
- **SUSPENDED** lets admins temporarily block a user (for policy violations, suspicious activity, chargebacks) without deleting their data — important because you might need their order history for investigations.
- **DEACTIVATED** is for users who close their own account. You keep the record for order history integrity but prevent login.

Without this enum, you'd need boolean fields like `isVerified`, `isSuspended`, `isDeactivated` and manage the combinations yourself, which gets messy fast.

---

## StoreStatus

```
DRAFT, PENDING_REVIEW, APPROVED, PENDING_GO_LIVE, ACTIVE, SUSPENDED, CLOSED
```

This drives YIIVA's curated marketplace model, which is core to the business proposition. Unlike open marketplaces where anyone can list immediately, YIIVA uses a **two-gate review system** to ensure both brand legitimacy and store launch readiness.

- **DRAFT** is when a merchant is still setting up their store — adding their logo, story, bank details. They can save progress without going live.
- **PENDING_REVIEW** means the merchant has submitted their store for the first review. An admin verifies that the brand is legitimate — real CIPC registration, valid bank details, real contact info. This is the curation gate that prevents spam and fraud from entering the platform.
- **APPROVED** means the store passed the first review. The owner's role is upgraded from BUYER to MERCHANT, giving them dashboard access to add products, upload their banner, write their brand story, and prepare for launch. The store is **not yet visible to buyers** at this stage.
- **PENDING_GO_LIVE** means the merchant has requested the second review after meeting the launch readiness requirements (13 required fields, at least one StoreAddress, at least 7 active products). An admin verifies the store is ready to be seen by buyers.
- **ACTIVE** means the store passed the second review and is live and visible to buyers in the discovery feed and search.
- **SUSPENDED** lets admins pull a store temporarily (counterfeit complaints, payment issues) while preserving all data.
- **CLOSED** is permanent — the merchant has shut down.

**Rejection paths:** A rejection at PENDING_REVIEW sends the store back to DRAFT with a `rejectionReason`. A rejection at PENDING_GO_LIVE sends the store back to APPROVED — the merchant retains their MERCHANT role and dashboard access and only needs to address the launch feedback.

Your product listing queries will filter by `StoreStatus.ACTIVE` so buyers never see draft, approved, or suspended stores. The merchant dashboard shows different UI states depending on this status.

---

## ProductStatus

```
DRAFT, ACTIVE, OUT_OF_STOCK, ARCHIVED
```

This controls product visibility and is separate from stock quantity because they serve different purposes.

- **DRAFT** lets merchants work on a product listing (writing descriptions, uploading photos, setting prices) before publishing. This is important because a half-finished listing with no images would look bad in search results.
- **ACTIVE** means it's live and purchasable.
- **OUT_OF_STOCK** is different from simply having zero stock — it's a deliberate status that keeps the product visible but unpurchasable. This matters because a product page might still get search traffic and you want to show "notify me when back in stock" rather than a 404.
- **ARCHIVED** is for products the merchant no longer sells but that exist in past orders. You can't delete them because OrderItems reference them, so archiving hides them from the storefront while preserving data integrity.

---

## OrderStatus

```
PENDING, CONFIRMED, PROCESSING, READY_FOR_DISPATCH, DISPATCHED, IN_TRANSIT, DELIVERED, CANCELLED, REFUND_REQUESTED, REFUNDED
```

This is the most complex enum because it models the full order lifecycle, and getting this wrong causes real business problems.

- **PENDING** is immediately after checkout — payment hasn't been confirmed yet.
- **CONFIRMED** means PayFast's ITN has come back with `COMPLETE` and the merchant has been notified.
- **PROCESSING** means the merchant is preparing the order (picking, packing).
- **READY_FOR_DISPATCH** means it's packed and waiting for TCG collection.
- **DISPATCHED** means TCG has physically collected the parcel.
- **IN_TRANSIT** maps to ShipLogic tracking events showing the parcel is moving through the network.
- **DELIVERED** means TCG confirmed delivery (via OTP).
- **CANCELLED** can happen before dispatch (buyer changes mind or merchant can't fulfill).
- **REFUND_REQUESTED** is after delivery (wrong item, damaged, etc.) and triggers a review process.
- **REFUNDED** means the money has been returned via PayFast.

Each of these states triggers different things — notifications to the buyer, updates to the merchant dashboard, inventory adjustments, payout calculations. The enum ensures your application logic has a clear, finite set of states to handle. Without it, you'd be comparing strings and inevitably miss edge cases.

---

## PaymentStatus

```
PENDING, COMPLETED, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED
```

This tracks the payment independently from the order because they don't always move in sync. An order can be CONFIRMED while the payment is still technically PENDING (race condition between your system and PayFast's ITN). A payment can FAIL while the order stays in PENDING (buyer's card declined).

- **PENDING** is when you've initiated payment with PayFast but haven't received the ITN yet.
- **COMPLETED** maps directly to PayFast's `payment_status: "COMPLETE"`.
- **FAILED** maps to PayFast's `"FAILED"`.
- **CANCELLED** is when the buyer abandoned the PayFast payment page.
- **REFUNDED** and **PARTIALLY_REFUNDED** handle post-delivery returns — partial refunds matter because a buyer might return one item from a multi-item order.

---

## PaymentMethod

```
CREDIT_CARD, DEBIT_CARD, INSTANT_EFT, DELAYED_EFT, MOBICRED, SNAPSCAN, MASTERPASS, STORE_CREDIT, ZAPPER, PAYPAL, RCS, APPLE_PAY, SAMSUNG_PAY
```

These are the actual payment methods PayFast supports in South Africa. We store which method was used because it affects your analytics (what do YIIVA's customers prefer?), reconciliation (different methods have different fee structures), and support (troubleshooting a failed SnapScan payment is different from a failed EFT).

This enum will need updating if PayFast adds or removes methods, but that happens rarely enough that a migration is acceptable.

---

## ShipmentStatus

```
PENDING, COLLECTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED_DELIVERY, RETURNED
```

This is YIIVA's simplified view of delivery status, designed for what buyers and merchants actually need to see. It's separate from `shiplogicStatus` (which stores ShipLogic's internal states like `creating`, `manifested`, etc.) because ShipLogic's statuses are technical and not meaningful to end users.

- **PENDING** means the shipment has been created but TCG hasn't collected yet.
- **COLLECTED** means the driver picked it up.
- **IN_TRANSIT** means it's moving between hubs.
- **OUT_FOR_DELIVERY** means it's on the final delivery vehicle.
- **DELIVERED** means the OTP was confirmed.
- **FAILED_DELIVERY** means the driver couldn't deliver (nobody home, wrong address).
- **RETURNED** means it's being sent back to the merchant after failed delivery attempts.

Your app maps ShipLogic tracking events to these simplified statuses so the buyer sees a clean progress bar rather than internal logistics jargon.

---

## PayoutStatus

```
PENDING, PROCESSING, COMPLETED, FAILED
```

Simple lifecycle for merchant payouts.

- **PENDING** means the payout has been calculated and is waiting to be initiated.
- **PROCESSING** means the bank transfer has been submitted.
- **COMPLETED** means the money has landed in the merchant's account.
- **FAILED** means the transfer was rejected (wrong bank details, closed account).

This is critical for merchant trust — they need to see exactly where their money is. The merchant dashboard will show payout history with these statuses.

---

## NotificationType

```
ORDER_PLACED, ORDER_CONFIRMED, ORDER_SHIPPED, ORDER_DELIVERED, ORDER_CANCELLED, PAYMENT_RECEIVED, PAYMENT_FAILED, PAYOUT_COMPLETED, NEW_REVIEW, NEW_FOLLOWER, PROMOTION, SYSTEM
```

This categorises notifications so your app can handle them differently. Each type maps to a different icon, different deep-link destination, and different push notification template.

When a buyer taps an `ORDER_SHIPPED` notification, the app opens the order tracking screen. When a merchant taps `NEW_REVIEW`, it opens the review. When they tap `PAYOUT_COMPLETED`, it opens the payout history. Without this enum, you'd be parsing notification text to figure out where to navigate, which is fragile.

It also lets users configure notification preferences — a merchant might want push notifications for `ORDER_PLACED` but only email for `NEW_FOLLOWER`.

---

## ContentType

```
IMAGE, VIDEO
```

Straightforward but necessary because images and videos render completely differently in the app. Images load inline, videos need a player with play/pause controls, buffering, and potentially different CDN handling. The feed algorithm might also weight them differently (videos often get more engagement). Your API needs to know the type to return the right metadata (aspect ratio for images, duration for videos, thumbnail for videos).

---

## SupportTicketStatus

```
OPEN, IN_PROGRESS, AWAITING_CUSTOMER, AWAITING_MERCHANT, RESOLVED, CLOSED
```

This drives the support workflow and makes it clear who needs to act next.

- **OPEN** is a new ticket nobody has looked at yet.
- **IN_PROGRESS** means a support agent is working on it.
- **AWAITING_CUSTOMER** and **AWAITING_MERCHANT** are the key ones — they make it explicit who the ball is with. This prevents tickets from falling through the cracks. If your support dashboard shows 15 tickets in `AWAITING_MERCHANT`, you know those merchants need a nudge.
- **RESOLVED** means the issue is fixed but the ticket stays open briefly for the customer to confirm.
- **CLOSED** is final.

---

## SupportTicketPriority

```
LOW, MEDIUM, HIGH, URGENT
```

This lets your support team triage effectively. A "how do I change my store logo" question is LOW. A "my order hasn't arrived after 2 weeks" is HIGH. A "I've been charged twice" is URGENT. Your support dashboard can sort and filter by priority, and you can set SLA targets per level (e.g. URGENT tickets must be responded to within 2 hours).

---

## DiscountType

```
PERCENTAGE, FIXED_AMOUNT, FREE_SHIPPING
```

These are the three fundamental ways to discount in e-commerce, and the calculation logic is completely different for each. PERCENTAGE takes the `discountValue` as a percentage (e.g. 15 means 15% off). FIXED_AMOUNT subtracts a Rand amount (e.g. 50 means R50 off). FREE_SHIPPING waives the shipping fee entirely. Your checkout logic needs to know which type it's dealing with to calculate the final order total correctly. Mixing these up (applying 15 as R15 instead of 15%) would be a costly bug, so the enum makes the intent explicit.

---

# Models

## Users & Auth

### 1. User

This is the core identity model for everyone on the platform — buyers, merchants, and admins. We use a single `User` table with a `role` enum rather than separate Buyer and Merchant tables because in practice a person might start as a buyer and later become a merchant, and shared auth logic (login, password reset, tokens) is much simpler with one table.

The `accountStatus` field lets you control the user lifecycle — you can require email verification before they can transact, suspend bad actors, or deactivate accounts without deleting data. We store `lastLoginAt` for analytics and security purposes (detecting inactive accounts, suspicious logins).

**Key fields:**
- `email` (unique) — primary identifier for auth
- `phone` (unique, optional) — secondary identifier, important for SA market where mobile is primary
- `passwordHash` — never store plain text passwords
- `role` — determines access level and app experience
- `accountStatus` — controls whether the user can use the platform
- `emailVerified` / `phoneVerified` — track verification state independently
- `verificationToken` (optional) — hashed email verification token. Set on registration, cleared after the user verifies their email.
- `verificationExpiry` (optional) — when the verification token expires (24 hours after issue).
- `resetToken` (optional) — hashed password reset token. Set when the user requests a password reset, cleared after the reset is complete.
- `resetExpiry` (optional) — when the reset token expires (1 hour after issue).

**Relations:** store, addresses, orders, cart, wishlistItems, reviews, notifications, supportTickets, followedStores, refreshTokens, storeEmployments

---

### 2. RefreshToken

This handles JWT-based authentication. When a user logs in, you issue a short-lived access token and a longer-lived refresh token. The refresh token gets stored here so you can validate it, revoke it (e.g. on logout or password change), and track expiry.

The `revoked` boolean lets you invalidate tokens without deleting them, which is important for security auditing. We tie each token to a `userId` so you can revoke all tokens for a user at once if needed (e.g. "log out everywhere").

**Key fields:**
- `token` (unique) — the actual refresh token string
- `userId` (FK) — which user this token belongs to
- `expiresAt` — when the token becomes invalid
- `revoked` — whether the token has been manually invalidated

---

### 3. Address

Users can have multiple saved addresses (home, work, etc.) with one marked as default. This is separated from the User model because a buyer might have several delivery addresses.

The `label` field lets them name addresses for easy selection at checkout. We include `recipientName` and `phone` per address because a user might ship to someone else. The country defaults to "South Africa" since that's YIIVA's market, but it's still a field in case you expand later.

**Key fields:**
- `userId` (FK) — which user owns this address
- `label` — friendly name like "Home" or "Work"
- `recipientName` / `phone` — per-address because you might ship to someone else
- `isDefault` — which address is pre-selected at checkout
- `country` — defaults to "South Africa"

---

## Stores & Brands

### 4. Store

This is the brand/merchant profile — the heart of YIIVA's seller side. Every merchant gets one store (the `ownerId` is unique, enforcing one store per user). The `slug` is for clean URLs like `yiiva.co.za/store/bold-streetwear` and is derived automatically from `displayName`.

South African businesses often have a registered company name (from CIPC) that differs from their public trading/brand name. Both are stored separately: `companyName` is the legal entity used for invoices, payouts, and compliance — never shown to buyers. `displayName` is the brand name buyers see everywhere. Both are unique across the platform, which means the slug derived from `displayName` is inherently unique — no suffix collision logic needed.

The `status` field controls the store lifecycle through a two-gate review system: a merchant creates a store in DRAFT, fills in details incrementally, and submits it for PENDING_REVIEW (first gate — admin verifies legitimacy). Once APPROVED, the owner is upgraded to MERCHANT, gains dashboard access, and prepares for launch. When ready, they request go-live (PENDING_GO_LIVE — second gate — admin verifies readiness). Only after the second approval does the store become ACTIVE and visible to buyers. This curated flow is what differentiates YIIVA from open marketplaces. The `rejectionReason` field is set by an admin when a store is rejected at either gate — it gives the merchant actionable feedback and is cleared automatically when they edit their store or resubmit.

Bank details are stored directly on the store because payouts go to the business, not the individual user. The denormalized metrics (`totalSales`, `totalRevenue`, `averageRating`, `followerCount`) exist because these values get queried constantly — on store listings, search results, dashboards. Calculating them from joins every time would be expensive, so we store them and update them when relevant events happen (new order, new review, new follower).

**Key fields:**
- `ownerId` (FK, unique) — one store per user
- `companyName` (unique) — registered legal entity name (CIPC). Used for invoices, payouts, compliance. Not shown to buyers.
- `displayName` (unique) — public-facing brand name shown to buyers everywhere
- `slug` (unique) — URL-friendly identifier derived from `displayName`
- `description` — short brand summary shown in search results and store listings
- `story` — brand narrative for discovery and community
- `websiteUrl` (optional) — the brand's external website. Optional throughout the entire store lifecycle including at go-live. Many SA creators sell exclusively through YIIVA and Instagram.
- `logoUrl` / `bannerUrl` — brand visuals. Set via the update endpoint after the frontend uploads to cloud storage. `bannerUrl` is required at the go-live gate.
- `contactEmail` / `contactPhone` — store contact details. May differ from the owner's account email/phone.
- `businessRegNo` — CIPC company registration number. Required for first-review submission.
- `vatNumber` (optional) — VAT registration number. Not required at any stage.
- `status` — DRAFT → PENDING_REVIEW → APPROVED → PENDING_GO_LIVE → ACTIVE (two-gate curated marketplace flow)
- `rejectionReason` — admin feedback on rejection. Set by an admin at either review gate. First-gate rejection sends the store back to DRAFT; second-gate rejection sends it back to APPROVED. Cleared automatically when the merchant edits their store or resubmits.
- `bankName` / `bankAccountNo` / `bankBranchCode` / `bankAccountType` — payout destination
- `totalSales` / `totalRevenue` / `averageRating` / `followerCount` — denormalized for performance

**Relations:** owner (User), products, categories, orders, payouts, followers, contentPosts, promotions, addresses, employees, collections

---

### 5. StoreFollower

This is the join table that lets buyers follow brands. It's essential for YIIVA's community and discovery features — followers get notified of new products, content posts, and promotions. The `@@unique([userId, storeId])` constraint prevents a user from following the same store twice.

**Key fields:**
- `userId` (FK) — the buyer who follows
- `storeId` (FK) — the store being followed

---

### 6. StoreAddress

Represents a physical location where the brand operates — a shop, studio, warehouse, or pop-up. Displayed on the store's public profile for trust and discovery, similar to Instagram business location tags.

This is **not** related to shipping logistics. Delivery addresses are handled entirely at checkout through TCG/ShipLogic. `StoreAddress` is purely a "find us" feature. A store can have zero or more addresses — many SA creators sell exclusively online and have no physical presence.

No `province` field — city and postal code are sufficient for a location tag. No `type` enum — all addresses serve the same purpose. No `isHeadquarters` flag — if a brand has multiple locations, they are all treated equally.

**Key fields:**
- `storeId` (FK) — which store this location belongs to. Cascades on store delete.
- `streetNumber` — the street number, e.g. "42". Required.
- `streetName` — the street name, e.g. "Bree Street". Required.
- `buildingName` — building, complex, mall, or shopping centre name. Optional.
- `city` — city or town, e.g. "Cape Town". Required.
- `postalCode` — SA postal code, e.g. "8001". Required.

---

### 7. StoreEmployee

Represents a team member who has been invited by the store owner to help manage the store. All employees have the same access level — there is no role hierarchy among employees. The only distinction is between the store owner (identified by `Store.ownerId`) and employees. The owner does NOT have a `StoreEmployee` record — ownership is tracked directly on the Store model.

The invite flow uses the same SHA-256 token security pattern as email verification and password reset: the raw token is sent via email, the hash is stored in the database, cleared after acceptance.

**Permission model:**

| Action | Owner | Employee |
|---|---|---|
| Edit store profile, products, content | Yes | Yes |
| View orders, analytics | Yes | Yes |
| Edit bank/payout details | Yes | No |
| Invite / remove employees | Yes | No |
| Submit store for review | Yes | No |
| Deactivate / delete the store | Yes | No |

**Key fields:**
- `storeId` (FK) — which store this employee belongs to. Cascades on store delete.
- `userId` (FK, nullable) — linked YIIVA account. Null until the invite is accepted. `onDelete: SetNull` — if the user account is deleted, the employee record persists as an audit trail but is unlinked.
- `email` — the email address the invite was sent to. Always present.
- `employeeNumber` — optional identifier provided by the employee during acceptance. Not system-generated.
- `inviteToken` — SHA-256 hash of the invite token. Raw token sent via email. Cleared after acceptance.
- `inviteExpiry` — when the invite link expires. Cleared after acceptance.
- `acceptedAt` — timestamp of acceptance. Null until accepted.
- `isActive` — owner can deactivate (false) to revoke dashboard access without deleting the record. Reactivatable.

**Constraints:** `@@unique([storeId, email])` — one invite per email per store.

---

### 8. Category

Product categories use a self-referencing tree structure via `parentId`. So you can have "Fashion" → "Streetwear" → "Hoodies" as nested categories. This is a well-established pattern for e-commerce taxonomies.

The `slug` is for URL-friendly category pages, and `sortOrder` lets you control how categories appear in navigation. Categories are platform-wide (managed by YIIVA admins) rather than per-store, which keeps the buyer's browsing experience consistent.

**Key fields:**
- `slug` (unique) — URL-friendly identifier
- `parentId` (FK, self-referencing) — enables nested category tree
- `sortOrder` — controls display order in navigation

**Relations:** parent (Category), children (Category[]), products (via ProductCategory), storeCategories

---

### 9. StoreCategory

This join table links stores to the categories they sell in. It's separate from product-level categorisation because you want to know at the store level what a brand sells (e.g. "this is a streetwear brand") for discovery and filtering, independent of whether they've uploaded products in every category yet.

**Key fields:**
- `storeId` (FK) — the store
- `categoryId` (FK) — the category it operates in

---

### 10. StoreCollection

Merchant-created groupings of products within their own store — for example "Summer 2025", "Limited Edition", or "Winter Essentials". Collections are entirely store-scoped: they exist to help the merchant organise their catalog for buyers browsing their storefront, but they have no effect on platform-wide discovery or search. A buyer browsing the global catalog sees categories (platform-managed), not collections (merchant-managed).

The `slug` is unique per store, not platform-wide — two different stores can both have a collection called "new-arrivals". The `@@unique([storeId, slug])` constraint enforces this scoping. The `sortOrder` field lets merchants control the order their collections appear on their store page (lower number = appears first).

**Key fields:**
- `storeId` (FK) — which store this collection belongs to. Cascade on delete.
- `name` — the collection name shown to buyers. Required.
- `slug` — URL-friendly identifier derived from `name`. Unique per store, not platform-wide.
- `description` (optional) — short description shown on the collection page
- `imageUrl` (optional) — hero/cover image for the collection
- `sortOrder` — manual ordering within the store. Defaults to 0.

**Constraints:** `@@unique([storeId, slug])` — slug is unique within a store. `@@index([storeId])` — fast lookup of all collections for a store.

**Relations:** store (Store), products (via ProductCollection)

---

### 11. ProductCollection

Join table for the many-to-many relationship between `Product` and `StoreCollection`. A single product can belong to multiple collections (e.g. a hoodie in both "Winter Essentials" and "Featured"), and a collection can contain many products.

Both foreign keys cascade on delete — if the product is deleted, the membership is removed; if the collection is deleted, all its product memberships are removed. The `@@unique([productId, collectionId])` constraint prevents a product from being added to the same collection twice.

**Key fields:**
- `productId` (FK) — the product. Cascade on delete.
- `collectionId` (FK) — the collection. Cascade on delete.

**Constraints:** `@@unique([productId, collectionId])` — prevents duplicate memberships.

**Relations:** product (Product), collection (StoreCollection)

---

## Products & Catalog

### 12. Product

This is the main product listing. Several important design choices:

**Pricing in cents** (`priceInCents`): We store all monetary values as integers in cents (so R250.00 = 25000). This avoids floating-point precision issues that plague financial calculations. When you multiply R19.99 × 3 in floating point you can get R59.96999... instead of R59.97. Cents as integers eliminate this entirely.

**`comparePriceInCents`**: This is the "was R350, now R250" crossed-out price. It's standard in e-commerce for showing discounts without needing a separate promotion system for every sale.

**`costInCents`**: The merchant's cost price, used for margin calculations in the analytics dashboard. Optional because not all merchants track this.

**`totalStock`**: Aggregated from variants. If a product has no variants, this is the stock count directly. If it has variants, this gets recalculated when variant stock changes. This avoids needing to SUM variant stock on every product listing query.

**Physical dimensions** (`weightInGrams`, `lengthCm`, etc.): Required for ShipLogic/TCG to calculate shipping rates. Without accurate parcel dimensions, shipping quotes will be wrong.

**Denormalized metrics** (`totalSold`, `viewCount`, `averageRating`, `reviewCount`): Same reasoning as Store — these are queried on every product card, search result, and listing page. The performance cost of joining to orders, analytics events, and reviews every time would be significant at scale.

**`isFeatured`**: Lets YIIVA or merchants highlight specific products for curated discovery feeds.

The `@@unique([storeId, slug])` ensures slugs are unique within a store but different stores can have a product called "black-hoodie".

**Key fields:**
- `storeId` (FK) — which store sells this product
- `priceInCents` / `comparePriceInCents` / `costInCents` — all monetary values in cents
- `totalStock` — aggregated inventory count
- `weightInGrams` / `lengthCm` / `widthCm` / `heightCm` — for shipping rate calculation
- `totalSold` / `viewCount` / `averageRating` / `reviewCount` — denormalized metrics
- `status` — DRAFT, ACTIVE, OUT_OF_STOCK, ARCHIVED

**Relations:** store, variants, images, categories, tags, collections, reviews, wishlistItems, cartItems, orderItems, contentProducts

---

### 13. ProductVariant

This handles size/color/material combinations. A "Black Hoodie" product might have variants like "Black / Small", "Black / Medium", "Black / Large". Each variant tracks its own `stock` and can optionally override the base product price.

The `sku` is unique across the entire platform because SKUs are meant to be globally unique identifiers in inventory systems. `sortOrder` controls display order (e.g. S, M, L, XL rather than alphabetical).

**Key fields:**
- `productId` (FK) — which product this variant belongs to
- `name` — display name like "Black / Medium"
- `sku` (unique, optional) — globally unique stock keeping unit
- `priceInCents` (optional) — override product price if set
- `stock` — inventory count for this specific variant
- `color` / `size` / `material` — variant option attributes

---

### 14. ProductImage

Separated from Product because products have multiple images. `sortOrder` controls the gallery sequence, and `isPrimary` marks which image shows as the thumbnail in listings. Keeping images in their own table also makes it easy to add/remove/reorder images without touching the product record.

**Key fields:**
- `productId` (FK) — which product this image belongs to
- `url` — image file location
- `altText` — accessibility text
- `sortOrder` — gallery display order
- `isPrimary` — thumbnail image flag

---

### 15. ProductCategory

The join table between products and categories. A product can belong to multiple categories (a face cream could be in both "Skincare" and "Beauty Gifts"). The unique constraint prevents duplicate assignments.

**Key fields:**
- `productId` (FK) — the product
- `categoryId` (FK) — the category it belongs to

---

## AI Tagging & Discovery

### 16. Tag

Tags are the backbone of YIIVA's AI-powered discovery. Unlike categories (which are hierarchical and admin-managed), tags are flat, flexible labels like "minimalist", "summer", "handmade", "cotton".

The `isAiGenerated` flag distinguishes tags created by YIIVA's AI tagging engine from manually added ones. `usageCount` is denormalized so you can quickly show trending tags or popular search terms without counting joins.

**Key fields:**
- `name` (unique) — the tag text
- `slug` (unique) — URL-friendly version
- `isAiGenerated` — whether YIIVA's AI created this tag
- `usageCount` — denormalized count for trending/popular tags

---

### 17. ProductTag

The join table between products and tags, with an important addition: `confidence`. When the AI tags a product, it might be 95% confident it's "streetwear" but only 60% confident it's "vintage". Storing confidence lets you set thresholds — maybe you only show tags above 0.7 confidence to buyers, but show all of them to the merchant so they can confirm or remove them.

`isAiGenerated` on the join itself (not just the tag) tells you whether this specific product-tag association was made by AI or by the merchant.

**Key fields:**
- `productId` (FK) — the product
- `tagId` (FK) — the tag applied
- `confidence` (optional) — AI confidence score 0-1
- `isAiGenerated` — whether AI made this specific association

---

## Content / Shoppable Media

### 18. ContentPost

This is YIIVA's content-to-commerce feature — the thing that differentiates it from a plain marketplace. Brands upload images and videos that tell their brand story, and those media pieces are directly shoppable.

The `contentType` enum distinguishes images from videos because they render differently. `thumbnailUrl` is for video thumbnails. `viewCount` and `likeCount` are denormalized for the feed display. The `isPublished` flag with `publishedAt` lets merchants draft content before making it live.

**Key fields:**
- `storeId` (FK) — which brand posted this content
- `contentType` — IMAGE or VIDEO
- `mediaUrl` — the actual media file
- `thumbnailUrl` — video thumbnail
- `viewCount` / `likeCount` — denormalized engagement metrics
- `isPublished` / `publishedAt` — draft vs live state

---

### 19. ContentPostProduct

This is the "shoppable tag" — it links a product to a specific content post. The `positionX` and `positionY` fields store where the product tag sits on the image/video (as percentages, e.g. 0.35, 0.72). This lets the mobile app render a tappable product marker at the right position on the media.

A single content post can tag multiple products, and a single product can appear in multiple content posts.

**Key fields:**
- `contentPostId` (FK) — the content post
- `productId` (FK) — the product being tagged
- `positionX` / `positionY` — tag overlay position on the media (as percentage coordinates)

---

## Cart & Wishlist

### 20. Cart

One cart per user (`userId` is unique). We use a separate Cart model rather than just a list of CartItems because the cart itself has metadata (when it was created, when it was last updated) and it makes queries cleaner — you fetch the cart, then its items, rather than querying all cart items by userId.

**Key fields:**
- `userId` (FK, unique) — one cart per user

**Relations:** user, items (CartItem[])

---

### 21. CartItem

Each item in the cart references a product and optionally a variant. The `@@unique([cartId, productId, variantId])` constraint ensures a user can't add the same product+variant combination twice — instead, the quantity increments.

The variant is optional because some products don't have variants.

**Key fields:**
- `cartId` (FK) — which cart this item is in
- `productId` (FK) — the product
- `variantId` (FK, optional) — specific variant if applicable
- `quantity` — how many

---

### 22. WishlistItem

Simple save-for-later functionality. One entry per user-product pair. This is intentionally simpler than cart — no quantities, no variants, just "I'm interested in this product." It drives engagement features like "X items on your wishlist are now on sale."

**Key fields:**
- `userId` (FK) — the buyer
- `productId` (FK) — the saved product

---

## Orders

### 23. Order

This is where the schema gets most critical because orders involve money, and mistakes here are costly.

**Why we snapshot the address**: The `shippingName`, `shippingPhone`, `shippingAddress1`, `shippingCity`, etc. fields duplicate information from the Address model. This is intentional and essential. If a user changes or deletes their address after placing an order, the order must still show where it was shipped. The `addressId` reference is kept for convenience but the snapshots are the source of truth.

**Order per store**: Each order belongs to one store. If a buyer purchases from three different brands in one checkout, that creates three separate orders. This is important because each store handles its own fulfillment, has its own shipment, and receives its own payout. Splitting at the order level keeps fulfillment clean.

**Amounts breakdown**: `subtotalInCents` (sum of items), `shippingInCents`, `discountInCents`, and `totalInCents`. Storing all four lets you display the breakdown on receipts and dashboards without recalculating.

**Timestamp fields**: `placedAt`, `confirmedAt`, `dispatchedAt`, `deliveredAt`, `cancelledAt` — each represents a real business event. They're separate from the `status` enum because you might want to know both the current status AND when each transition happened (for analytics, SLA tracking, and dispute resolution).

**Key fields:**
- `orderNumber` (unique) — human-readable order reference
- `userId` (FK) — the buyer
- `storeId` (FK) — the seller (one order per store)
- `addressId` (FK) — reference to address record
- `status` — OrderStatus enum
- `subtotalInCents` / `shippingInCents` / `discountInCents` / `totalInCents` — full breakdown
- `shippingName` / `shippingPhone` / `shippingAddress1` / `shippingAddress2` / `shippingCity` / `shippingProvince` / `shippingPostalCode` / `shippingCountry` — full address snapshot at time of order
- `cancelReason` (optional) — reason stored when an order is cancelled
- `placedAt` / `confirmedAt` / `dispatchedAt` / `deliveredAt` / `cancelledAt` — lifecycle timestamps

**Relations:** user, store, address, items (OrderItem[]), payment, shipment, promotionUsage

---

### 24. OrderItem

Each line item in an order. We snapshot `productTitle`, `variantName`, and `productImageUrl` because products can be renamed, images changed, or products deleted after an order is placed. The customer's order history must always show what they actually bought.

`unitPriceInCents` and `totalInCents` are both stored because the price at time of purchase is locked in — even if the merchant changes the product price later.

**Key fields:**
- `orderId` (FK) — which order this item belongs to
- `productId` (FK) — reference to product
- `variantId` (FK, optional) — reference to variant
- `quantity` — how many purchased
- `unitPriceInCents` / `totalInCents` — locked-in pricing
- `productTitle` / `variantName` / `productImageUrl` — snapshots at time of purchase

---

## Payments

### 25. Payment

This model is designed specifically around PayFast's ITN (Instant Transaction Notification) system.

**`mPaymentId`**: This is YOUR unique reference that you generate and send to PayFast when initiating payment. PayFast sends it back in the ITN so you can match the notification to the right order. It's unique because each payment attempt must have a distinct ID.

**`pfPaymentId`**: PayFast's own internal transaction ID, returned in the ITN. You need this if you ever need to query PayFast's API about a transaction or process a refund.

**`amountGrossInCents`, `amountFeeInCents`, `amountNetInCents`**: PayFast tells you exactly how much was charged (gross), what their fee was, and what the merchant nets. Storing all three means you can reconcile payments and calculate platform economics accurately.

**`pfSignature`**: The MD5 signature PayFast includes for ITN verification. You validate this server-side to ensure the notification actually came from PayFast and wasn't spoofed.

**`customStr1`/`customInt1` etc.**: PayFast provides custom fields you can use to pass metadata through the payment flow. Useful for passing store IDs, internal references, or anything else you need on the other side.

**`itnPayload`**: The full raw JSON webhook body. This is your audit trail — if anything ever goes wrong with a payment, you have the complete original data from PayFast to investigate.

**Key fields:**
- `orderId` (FK, unique) — one payment per order
- `mPaymentId` (unique) — your payment reference sent to PayFast
- `pfPaymentId` — PayFast's transaction ID returned via ITN
- `status` — PaymentStatus enum
- `method` — PaymentMethod enum
- `amountGrossInCents` / `amountFeeInCents` / `amountNetInCents` — full financial breakdown
- `paymentStatus` — raw PayFast status string (COMPLETE, FAILED, PENDING)
- `merchantId` — PayFast merchant ID returned in the ITN for verification
- `pfSignature` — MD5 hash for ITN verification
- `customStr1` / `customStr2` / `customInt1` — PayFast custom passthrough fields for internal references (e.g. store ID, order reference)
- `pfNameFirst` / `pfNameLast` / `pfEmailAddress` — buyer info returned by PayFast in the ITN
- `pfToken` — PayFast token for tokenized/recurring billing if needed later
- `itnPayload` — full raw webhook body for audit

---

### 26. Payout

This tracks money flowing from YIIVA to merchants. When orders are fulfilled, YIIVA collects the payment (via PayFast) and periodically pays out merchants minus the platform commission.

`amountInCents` is the gross order revenue, `feeInCents` is YIIVA's cut, and `netAmountInCents` is what the merchant receives. `periodStart` and `periodEnd` define the payout window (e.g. "all orders from Feb 1-15"). The `reference` field stores the bank transfer reference for reconciliation.

**Key fields:**
- `storeId` (FK) — which merchant store receives the payout
- `amountInCents` — gross revenue for the period
- `feeInCents` — YIIVA's platform commission
- `netAmountInCents` — what the merchant actually receives
- `status` — PayoutStatus enum
- `reference` — bank transfer reference for reconciliation
- `periodStart` / `periodEnd` — payout period window
- `processedAt` — timestamp of when the bank transfer was submitted

---

## Shipping & Delivery

### 27. Shipment

Designed around ShipLogic's API, which is what The Courier Guy uses under the hood.

**`shiplogicShipmentId`**: ShipLogic's internal ID for the shipment, used for API calls to update or cancel.

**`waybillNumber`**: The primary identifier for tracking a parcel through TCG's system. This is what the buyer and merchant see.

**`serviceType`**: The delivery speed/service selected — LOF (Local Overnight Flyer) for small packages, LOX for bigger ones, ECO for economy, NFS for next-flight-out, etc. This affects price and delivery time.

**`shiplogicStatus`**: ShipLogic has its own status lifecycle (`creating`, `created`, `manifesting`, `manifested`, etc.) which is separate from our internal `ShipmentStatus` enum. We store both because our app might show simplified statuses to buyers while internally tracking the exact ShipLogic state.

**Rate fields**: `rateInCents` and `rateExVatInCents` store what ShipLogic quoted for the shipment. This is important for reconciling shipping costs.

**`deliveryOtp`**: TCG uses OTP-based delivery confirmation instead of physical signatures. The receiver gets an OTP that the driver enters to confirm delivery.

**`shiplogicPayload`**: Full API response stored for auditing and debugging.

**Key fields:**
- `orderId` (FK, unique) — one shipment per order
- `shiplogicShipmentId` (unique) — ShipLogic's internal ID
- `waybillNumber` (unique) — TCG tracking identifier
- `serviceType` — LOF, LOX, ECO, NFS etc.
- `shiplogicStatus` — raw ShipLogic status (creating, created, manifested, etc.)
- `status` — ShipmentStatus enum (YIIVA's simplified status)
- `quoteId` — ShipLogic quote reference used when creating the shipment
- `rateInCents` / `rateExVatInCents` — shipping cost (incl. and excl. VAT) from ShipLogic
- `parcelCount` / `totalWeightInGrams` / `parcelDescription` — parcel details sent to ShipLogic
- `collectionDate` — earliest collection date sent to ShipLogic when booking the shipment
- `deliveryOtp` — OTP for delivery confirmation
- `podUrl` — proof of delivery document
- `shiplogicPayload` — full API response for audit

**Relations:** order, trackingEvents (ShipmentTrackingEvent[])

---

### 28. ShipmentTrackingEvent

A separate table because a single shipment has many tracking events over its lifecycle (collected → at hub → in transit → out for delivery → delivered). Each event has a status, description, optional location (which branch/hub), and a timestamp from ShipLogic.

This lets you build a detailed tracking timeline in the app for buyers and merchants. The index on `[shipmentId, timestamp]` makes it fast to retrieve events in chronological order.

**Key fields:**
- `shipmentId` (FK) — which shipment this event belongs to
- `status` — event status (e.g. "Collected", "In Transit", "At Hub", "Delivered")
- `description` — detailed tracking message from ShipLogic
- `location` — branch/hub location if available
- `timestamp` — when the event occurred (from ShipLogic, not our system)

---

## Reviews

### 29. Review

One review per user per product (`@@unique([userId, productId])`). The `isVerified` flag indicates whether the reviewer actually bought the product — verified reviews build trust and you can filter by them. `isPublished` lets you moderate reviews (hide spam or abusive content).

The `rating` is 1-5, standard for e-commerce. When a review is created or updated, you'd recalculate the product's and store's `averageRating` denormalized fields.

**Key fields:**
- `userId` (FK) — the reviewer
- `productId` (FK) — the product being reviewed
- `rating` — 1 to 5
- `title` / `body` — review content
- `isVerified` — whether the reviewer purchased the product
- `isPublished` — moderation flag

---

## Promotions & Discounts

### 30. Promotion

Store-level discount codes. `discountType` handles three common patterns: percentage off, fixed Rand amount off, or free shipping. `discountValue` is flexible — it's 15.00 for 15% off or 50.00 for R50 off, depending on type.

`maxUsage` caps total uses across all customers, `maxUsagePerUser` prevents abuse (typically 1). `minOrderInCents` sets a minimum spend. `startsAt` and `expiresAt` control the promotion window.

The `@@unique([storeId, code])` ensures each store has unique codes but different stores can use the same code string.

**Key fields:**
- `storeId` (FK) — which store owns this promotion
- `code` — the discount code string
- `discountType` — PERCENTAGE, FIXED_AMOUNT, or FREE_SHIPPING
- `discountValue` — the numeric value (percentage or Rand amount)
- `minOrderInCents` — minimum order value to qualify
- `maxUsage` / `usageCount` / `maxUsagePerUser` — usage limits
- `isActive` — whether the promotion is currently available
- `startsAt` / `expiresAt` — promotion window

---

### 31. PromotionUsage

Tracks which promotions were applied to which orders. The `orderId` is unique because one order can only use one promotion code. This table lets you enforce usage limits and provides a clear audit trail.

**Key fields:**
- `promotionId` (FK) — which promotion was used
- `orderId` (FK, unique) — which order it was applied to

---

## Notifications

### 32. Notification

A flexible notification system for both buyers and merchants. The `type` enum covers all major events (order updates, payment events, new reviews, etc.). The `data` JSON field lets you attach any relevant context (like an orderId or productId) so the app can deep-link when the notification is tapped.

`isRead` and `readAt` support read/unread state and let you track notification engagement.

**Key fields:**
- `userId` (FK) — who receives the notification
- `type` — NotificationType enum
- `title` / `body` — notification display text
- `data` — JSON payload for deep-linking (orderId, productId, etc.)
- `isRead` / `readAt` — read state

---

## Customer Support

### 33. SupportTicket

Customer care with a ticket-based system. Tickets can optionally link to an order (`orderId`) since most support issues are order-related.

`priority` helps your support team triage, and `status` tracks the resolution lifecycle. The status options (`AWAITING_CUSTOMER`, `AWAITING_MERCHANT`) make it clear who needs to take action next.

**Key fields:**
- `userId` (FK) — who opened the ticket
- `orderId` (optional) — related order if applicable
- `subject` / `description` — ticket content
- `status` — SupportTicketStatus enum
- `priority` — SupportTicketPriority enum
- `resolvedAt` — when the issue was resolved

**Relations:** user, messages (SupportMessage[])

---

### 34. SupportMessage

The conversation thread within a support ticket. `senderType` distinguishes between the buyer, the merchant, and YIIVA admin staff.

`attachments` is JSON because messages might include multiple images (e.g. photos of a damaged product). This is a separate table from the ticket because a ticket has many messages back and forth.

**Key fields:**
- `ticketId` (FK) — which ticket this message belongs to
- `senderType` — "USER", "MERCHANT", or "ADMIN"
- `senderId` — ID of the person who sent the message
- `body` — message text
- `attachments` — JSON array of attachment URLs

---

## Standalone / Utility

### 35. WaitlistEntry

Simple pre-launch email collection. You're in this phase right now. Just an email and a source (to track where signups came from — social media, direct, referral). This table will be less relevant after launch but the data remains valuable for your initial merchant outreach.

**Key fields:**
- `email` (unique) — the signup email
- `source` — where the signup came from

---

### 36. AnalyticsEvent

A flexible event-tracking table for real-time insights — one of YIIVA's key features. Rather than creating separate tables for every type of analytics event, we use a single table with an `eventType` string and a `metadata` JSON field. This covers product views, searches, add-to-cart actions, purchases, and any future event types without schema changes.

The indexes on `[storeId, createdAt]` and `[productId, createdAt]` make it fast to query "show me all events for this store in the last 30 days" or "show me view trends for this product this week" — which powers the merchant dashboard's real-time insights feature.

This is intentionally a denormalized, append-only log. At scale, you might move this to a dedicated analytics database or time-series store, but for early stage this PostgreSQL approach works well and keeps your stack simple.

**Key fields:**
- `eventType` — e.g. "product_view", "search", "add_to_cart", "purchase"
- `userId` (optional) — who triggered the event (anonymous events are allowed)
- `storeId` (optional) — relevant store
- `productId` (optional) — relevant product
- `metadata` — flexible JSON payload for any additional event data
