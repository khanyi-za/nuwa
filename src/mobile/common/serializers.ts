import { GenderType, MediaType, StoreStatus } from '@prisma/client';
import { genderEnumToParam } from './gender';

/**
 * Pure mappers from nuwa DB row shapes → the maya buyer-app response shapes.
 * Vocabulary translation lives here: `Store` → `merchant` (slug → username),
 * `title` → `name`, `priceInCents` → `price`. See `mobile-buyer-api-architecture`
 * memory + maya `docs/api/`.
 */

interface StoreLike {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
}

/** Personalised flags included only on authenticated requests. */
export interface PersonalFlags {
  isLikedByMe?: boolean;
  isBookmarkedByMe?: boolean;
  isFollowedByMe?: boolean;
}

export function toMerchantSubdoc(store: StoreLike, isFollowedByMe?: boolean) {
  return {
    id: store.id,
    username: store.slug,
    displayName: store.displayName,
    logo: store.logoUrl ?? null,
    // Buyers only ever see go-live/ACTIVE stores, which are verified by
    // definition — no separate field needed.
    isVerified: true,
    ...(isFollowedByMe !== undefined ? { isFollowedByMe } : {}),
  };
}

interface FeedProductRow {
  id: string;
  title: string;
  priceInCents: number;
  genderType: GenderType | null;
  images: { url: string }[];
  categories: { category: { slug: string; name: string } }[];
  store: StoreLike;
}

/**
 * Full feed/grid product card. When `flags` is provided (authed request),
 * personalised fields are included; for guests they are omitted (maya treats
 * absent as false). `isLikedByMe` is always false in v1 — likes are local-only
 * on maya, no server model yet (see phalo-smart-engine memory).
 */
export function toFeedProduct(p: FeedProductRow, flags?: PersonalFlags) {
  const primaryCategory = p.categories[0]?.category;
  return {
    id: p.id,
    name: p.title,
    price: p.priceInCents,
    currency: 'ZAR',
    primaryImage: p.images[0]?.url ?? null,
    merchant: toMerchantSubdoc(p.store, flags?.isFollowedByMe),
    category: primaryCategory?.slug ?? null,
    clothingType: primaryCategory?.name ?? null,
    genderType: genderEnumToParam(p.genderType),
    ...(flags
      ? {
          isLikedByMe: flags.isLikedByMe ?? false,
          isBookmarkedByMe: flags.isBookmarkedByMe ?? false,
        }
      : {}),
  };
}

interface CarouselRow {
  id: string;
  title: string;
  priceInCents: number;
  images: { url: string }[];
  store: { displayName: string };
}

/** Lightweight carousel card (new-arrivals, similar). No personalised fields. */
export function toCarouselProduct(p: CarouselRow) {
  return {
    id: p.id,
    name: p.title,
    price: p.priceInCents,
    currency: 'ZAR',
    image: p.images[0]?.url ?? null,
    merchant: { displayName: p.store.displayName },
  };
}

interface TrendingStoreRow {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  followerCount: number;
}

/** A–Z directory card (merchants.md §4) — lighter than the full profile. */
export function toMerchantDirectoryCard(
  s: TrendingStoreRow,
  opts: { productCount: number; isFollowedByMe?: boolean },
) {
  return {
    id: s.id,
    username: s.slug,
    displayName: s.displayName,
    logo: s.logoUrl ?? null,
    isVerified: true,
    followerCount: s.followerCount,
    productCount: opts.productCount,
    ...(opts.isFollowedByMe !== undefined
      ? { isFollowedByMe: opts.isFollowedByMe }
      : {}),
  };
}

export function toTrendingMerchant(
  s: TrendingStoreRow,
  isFollowedByMe?: boolean,
) {
  return {
    id: s.id,
    username: s.slug,
    displayName: s.displayName,
    logo: s.logoUrl ?? null,
    followerCount: s.followerCount,
    isVerified: true,
    ...(isFollowedByMe !== undefined ? { isFollowedByMe } : {}),
  };
}

interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  size: string | null;
  stock: number;
  reservedStock: number;
}

interface DetailRow {
  id: string;
  title: string;
  description: string | null;
  priceInCents: number;
  genderType: GenderType | null;
  totalStock: number;
  reservedStock: number;
  images: { url: string; mediaType: MediaType }[];
  variants: VariantRow[];
  categories: { category: { slug: string; name: string } }[];
  tags: { tag: { name: string } }[];
  store: {
    id: string;
    slug: string;
    displayName: string;
    logoUrl: string | null;
    description: string | null;
  };
}

/**
 * Full product-detail shape (maya products.md §4). `inventoryType`/`leadTime`
 * are intentionally omitted — made-to-order is a deprecated prototype feature,
 * not in v1 (D1). `variants[]` map from nuwa ProductVariant; bare products get
 * `variants: []`. Personalised fields (isLiked/isBookmarked/likeCount,
 * merchant.isFollowedByMe) only when `flags` is provided (authed). likeCount is
 * 0 and isLikedByMe false — likes are local-only on maya in v1.
 */
export function toProductDetail(p: DetailRow, flags?: PersonalFlags) {
  const primaryCategory = p.categories[0]?.category;

  const variants = p.variants.map((v) => {
    const available = Math.max(0, v.stock - v.reservedStock);
    return {
      id: v.id,
      size: v.size ?? v.name,
      sku: v.sku ?? null,
      available: available > 0,
      stockCount: available,
    };
  });

  const stockAvailable =
    variants.length > 0
      ? variants.some((v) => v.available)
      : p.totalStock - p.reservedStock > 0;

  const merchant = {
    id: p.store.id,
    username: p.store.slug,
    displayName: p.store.displayName,
    logo: p.store.logoUrl ?? null,
    isVerified: true,
    bio: p.store.description ?? null,
    location: null as string | null,
    ...(flags?.isFollowedByMe !== undefined
      ? { isFollowedByMe: flags.isFollowedByMe }
      : {}),
  };

  return {
    id: p.id,
    name: p.title,
    description: p.description ?? null,
    price: p.priceInCents,
    currency: 'ZAR',
    category: primaryCategory?.slug ?? null,
    clothingType: primaryCategory?.name ?? null,
    genderType: genderEnumToParam(p.genderType),
    smartCategories: p.tags.map((t) => t.tag.name),
    variants,
    stock: { available: stockAvailable },
    media: p.images.map((img) => ({
      type: img.mediaType === MediaType.VIDEO ? 'video' : 'image',
      url: img.url,
    })),
    merchant,
    ...(flags
      ? {
          isLikedByMe: false,
          isBookmarkedByMe: flags.isBookmarkedByMe ?? false,
          likeCount: 0,
        }
      : {}),
    returnPolicy: {
      windowDays: 30,
      type: 'free_exchange_or_return',
      displayText: 'Free exchange or return within 30 days',
    },
  };
}

interface MerchantProfileRow {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  description: string | null;
  status: StoreStatus;
  followerCount: number;
  contactEmail: string | null;
  bannerMedia: { url: string }[];
  addresses: { city: string }[];
}

/** Brand-page catalogue tab: the merchant's own collection, in their order. */
export interface MerchantProfileCollection {
  slug: string;
  name: string;
  image: string | null;
  productCount: number;
}

/**
 * Full merchant profile (merchants.md §2). `heroMedia` ← StoreBannerMedia,
 * `bio` ← store description, `location` ← first public StoreAddress city,
 * `contact.email` ← store.contactEmail. `isVerified` true for ACTIVE stores
 * (buyer-visible = verified). `messagingEnabled` is always true in v1 (no
 * per-store toggle; Chat backend is Screen 12). `followingCount` is 0 (skipped
 * per MP-1). Only ACTIVE/SUSPENDED/CLOSED stores reach here — the service 404s
 * never-live ones; SUSPENDED/CLOSED return with `status` so maya shows the
 * unavailable placeholder. `collections` mirrors the merchant's own site
 * sections (StoreCollection, sortOrder ascending, only collections with ≥1
 * ACTIVE product).
 */
export function toMerchantProfile(
  s: MerchantProfileRow,
  opts: {
    postCount: number;
    isFollowedByMe?: boolean;
    collections?: MerchantProfileCollection[];
  },
) {
  const status =
    s.status === StoreStatus.SUSPENDED
      ? 'SUSPENDED'
      : s.status === StoreStatus.CLOSED
        ? 'CLOSED'
        : 'ACTIVE';
  return {
    id: s.id,
    username: s.slug,
    displayName: s.displayName,
    logo: s.logoUrl ?? null,
    heroMedia: s.bannerMedia.map((m) => m.url),
    bio: s.description ?? null,
    location: s.addresses[0]?.city ?? null,
    isVerified: s.status === StoreStatus.ACTIVE,
    status,
    followerCount: s.followerCount,
    followingCount: 0,
    postCount: opts.postCount,
    ...(opts.isFollowedByMe !== undefined
      ? { isFollowedByMe: opts.isFollowedByMe }
      : {}),
    messagingEnabled: true,
    contact: { email: s.contactEmail ?? null },
    collections: opts.collections ?? [],
  };
}

interface AddressRow {
  id: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string;
  postalCode: string;
  isDefault: boolean;
  label: string | null;
}

/**
 * nuwa Address → maya address shape (addresses.md §Address shape). maya uses
 * `line1`/`line2` and an ISO `country` (ZA in v1); nuwa's `suburb` isn't part
 * of the maya shape.
 */
export function toAddress(a: AddressRow) {
  return {
    id: a.id,
    recipientName: a.recipientName,
    phone: a.phone,
    line1: a.addressLine1,
    line2: a.addressLine2 ?? null,
    city: a.city,
    province: a.province,
    postalCode: a.postalCode,
    country: 'ZA',
    isDefault: a.isDefault,
    label: a.label ?? null,
  };
}

interface CategoryRow {
  slug: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
}

export function toCategoryChip(c: CategoryRow, productCount?: number) {
  return {
    slug: c.slug,
    displayName: c.name,
    image: c.imageUrl ?? null,
    ...(productCount !== undefined ? { productCount } : {}),
    order: c.sortOrder,
  };
}
