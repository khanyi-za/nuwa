# YIIVA Mobile (maya) ↔ Backend (nuwa) — Integration Summary

> Durable reference for the mobile-app integration effort. Pairs with `STATUS.md`
> (session handoff) and the per-endpoint backend notes in
> `../../maya/docs/api/*.md`. **Last section = Follow-ups / ops action list.**
>
> Health at time of writing: **765 tests / 52 suites passing, `tsc` clean.**

---

## 1. What this is

The maya buyer app (Expo/RN, sibling repo at `deploy_yiiva/maya/`) was a UI
prototype on fixtures. This effort built the backend API it needs to run against
real data, **one screen at a time** through maya's 13 documented screens. The
work is backend-only (nuwa); maya wires to it separately (see §8).

Source of truth for what the app expects: `maya/docs/screens/<n>/` (UX +
api-contract) and `maya/docs/api/<domain>.md` (canonical specs, each endpoint now
flipped to ✅ with a "implemented in nuwa" note). Cross-cutting product decisions:
`maya/docs/open-questions.md`.

---

## 2. Architecture

- **Dedicated buyer/mobile surface** under the `/api` prefix — its own
  modules/controllers/services (`src/mobile/`, `src/chat/`). The existing
  web/admin/merchant routes (athena + dashboards) are **never modified**.
- **Response envelope** (scoped to `/api`, never global): success
  `{ success, data, pagination? }`, error `{ success:false, error:{ code, message } }`.
  Applied via the `MobileController` decorator (interceptor + exception filter).
- **Vocabulary translation:** maya `merchants` (keyed by `username`) → nuwa
  `Store` (slug-as-username); `bookmark` → `WishlistItem`; `follow` →
  `StoreFollower`. `isVerified` = true for buyer-visible stores.
- **Shared query core:** `queryFeedPage` (in `MobileProductsService`) backs feed,
  search (×4), and merchant catalogue — one source of truth for the product-card
  shape + cursor pagination.
- **Chat is its own real-time domain** (`src/chat/`): REST writes + socket.io
  WebSocket fan-out, dual buyer/merchant surface. See the `chat-module` memory.
- **"Phalo" seam:** trending, new-arrivals, search relevance, and trending-search
  are v1 heuristics behind thin service methods; a future Python sister project
  (Phalo) replaces the ranking without changing API shapes. Likes + AI-tagging
  are also Phalo-adjacent.

---

## 3. Cross-cutting contract maya must adopt

| Concern | Contract |
|---|---|
| Base URL | `/api` prefix (`api-client.ts` already targets it) |
| Envelope | `{ success, data, pagination? }` / `{ success:false, error:{ code, message } }` |
| Money | integer ZAR cents (already aligned) |
| **VAT** | **inclusive** — `tax` is the portion already in `total`, NOT added on top. **maya must stop adding 15%.** |
| Merchants | = `Store`; `username` = `slug` |
| Likes | local-only on device in v1 (no server model) |
| Auth | `Authorization: Bearer`; chat + cart mutations + addresses are auth-required |

---

## 4. Screen status (13)

| # | Screen | Status |
|---|---|---|
| 01 | Home | ✅ |
| 02 | Product Detail | ✅ |
| 03 | Cart | ✅ |
| 04 | Checkout | ✅ |
| 05 | Order Success | ✅ |
| 06 | Track Order | ✅ |
| 07 | Search | ✅ |
| 08 | Merchant Profile | ✅ |
| 09 | Wishlist | ✅ |
| 10 | Explore | 🛑 **scrapped** — orphan tab (hidden, no entry point), duplicates Home, EX-1 unresolved |
| 11 | Shop | ✅ |
| 12 | Chat | ✅ (real-time) |
| 13 | Video Player (reels) | ⏭ **skipped** — no entry point, no backend, renders images not video; maya votes remove |

---

## 5. Endpoint inventory

All under `/api` (enveloped) unless noted.

**Catalogue / discovery**
- `GET /products/feed` · `/products/new-arrivals` · `/products/:id` · `/products/:id/similar` · `POST /products/:id/view`
- `GET /categories`
- `GET /search` · `/search/category` · `/search/smart-category` · `/search/merchant` · `/search/suggestions` · `POST /search/track`
- `GET /merchants` (A–Z directory) · `/merchants/trending` · `/merchants/:username` · `/merchants/:username/products` · `POST /merchants/:id/view`

**Cart**
- `GET /cart` · `GET /cart/summary` · `POST /cart/items` · `PATCH /cart/items/:id` · `DELETE /cart/items/:id` · `DELETE /cart`

**Social / me**
- `PUT/DELETE /products/:id/bookmark` · `PUT/DELETE /merchants/:id/follow` · `GET /me/bookmarks`
- `GET/POST/PATCH/DELETE /me/addresses` · `PATCH /me/addresses/:id/default`

**Checkout / orders**
- `POST /checkout/quote` · `POST /orders`
- `GET /orders/:id` · `/orders/:id/tracking` · `/orders/:id/preview` · `POST /orders/:id/cancel`

**Chat** (auth-required; guests can't chat)
- Buyer (`/api`): `GET /conversations/by-merchant/:username` · `GET/POST /conversations/:id/messages` · `PATCH /conversations/:id/read` · `POST /conversations/:id/report`
- Merchant (**not** `/api` — raw, `canManageStore`): `GET /stores/:storeId/conversations` · `GET/POST /stores/:storeId/conversations/:id/messages` · `PATCH /stores/:storeId/conversations/:id/read`
- WebSocket: `/chat` namespace (JWT handshake; `join {conversationId}` → `message:new` / `read`)

**Uploads:** new `chat_attachment` Cloudinary signed-upload context (images use signed-direct, not multipart).

---

## 6. Schema changes & migrations

| Migration | Adds |
|---|---|
| `20260608100000_product_gender_type` | `GenderType` enum + `Product.genderType` (+ index) |
| `20260610120000_chat_module` | `Conversation`, `Message`, `ConversationReport` + `MessageSenderType` / `ConversationReportReason` enums |

⚠️ **Neither migration has been applied to a database** — only `prisma generate`
was run (for types/tests). See §9.

---

## 7. Deferrals (intentional, documented)

| Area | Deferred | Reason |
|---|---|---|
| Likes | server-side likes / `likeCount` | local-only v1 (Phalo-adjacent) |
| Price drift | `priceChanged` (cart + wishlist) | no add-time price column |
| Guest cart | server cart via `X-Cart-Session` | guests sign in to buy v1 |
| Notifications | unread-count, push, inbox | module on hold |
| Checkout | Apple Pay, Payflex, saved cards, promo, pickup, rate selection | not built / on hold |
| Made-to-order | `inventoryType` / `leadTime` | outdated prototype feature, dropped |
| Orders | `GET /orders` list, retry-payment, recovery query filters | Account/My-Orders screen TBD; OS-3 |
| Search | real relevance, trending signal | Phalo; smart-cats sparse until AI-tagging worker |
| Explore | `GET /products/featured` | scrapped with the screen |
| Chat | product-card attachments, conversation-list screen, read receipts, per-store `messagingEnabled` toggle, `avgResponseTime` | v2 |
| Returns | returns/exchange flow | product TBD |

---

## 8. How maya wires up (frontend side, not done here)

1. Flip `lib/api-client.ts` `USE_FIXTURES = false`.
2. Confirm base URL hits the `/api` prefix; adopt the `{success,data}` envelope in
   the fetch wrapper.
3. **Stop adding 15% VAT** — render the server's inclusive `tax`/`total`.
4. Wire the screens' "prototype-only behavior to deprecate" tables to the real
   endpoints (each screen doc lists them).
5. Chat: connect the socket.io `/chat` namespace (JWT in handshake), `join` the
   conversation, render `message:new`. Images via the `chat_attachment` signed
   upload.

---

## 9. Follow-ups / ops action list (PICK UP HERE)

**Must-do before this runs live:**
1. **Apply both migrations** (`npx prisma migrate dev`) — `product_gender_type`
   + `chat_module`.
2. **Seed `Product.genderType`** on products — the gender-filtered feeds return
   empty without it.
3. **Create the `chat_attachment` signed upload preset** in the Cloudinary
   dashboard (matches the new upload context).
4. **Boot + WebSocket smoke test** — there is no e2e harness, so the DI graph
   (incl. `MobileModule`→`OrderModule` import and the `ChatGateway`) and the
   socket flow are not boot-tested. Run `npm run start:dev`, connect a socket to
   `/chat`, send a message.

**Pending verification (pre-existing):**
5. **PayFast sandbox smoke test** (Phase 3+4 end-to-end) — still outstanding.
6. **ShipLogic webhook delivery** — sandbox doesn't fire; tracking endpoint
   returns 404 until production webhooks are verified.
7. **`npm audit`** warnings surfaced when installing the WebSocket deps.

**Frontend handoff:**
8. maya wiring per §8 (USE_FIXTURES, envelope, VAT-inclusive, socket).

**Open product decisions (block re-scoping, not v1 builds):**
9. EX-1 — what IS Explore vs Home (gates reviving Explore + collections).
10. VP-1 — keep/remove Video Player (currently skipped).
11. P-4 / ST-7 — "Home & Lifestyle" gender axis (empty placeholder today).
