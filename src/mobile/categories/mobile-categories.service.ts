import { Injectable } from '@nestjs/common';
import { ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GenderParam,
  genderExactValue,
  genderFilterValues,
} from '../common/gender';
import { toCategoryChip } from '../common/serializers';

// A category with ZERO gender-exact products still earns a chip on a gender
// tab when it holds at least this many UNISEX products (genuinely-unisex
// categories: eyewear, headwear). Below the threshold, a stray unisex item
// can't drag a category onto the wrong tab (the bug: "Lingerie" on Men via
// 3 unisex-labelled products).
const MIN_UNISEX_ONLY_PRODUCTS = 5;

// The synthetic "All" chip renders a 2×2 collage — how many distinct covers
// the gendered response supplies for it.
const ALL_CHIP_COVER_COUNT = 4;

// Primary-image-first single-image select for chip covers.
const PRIMARY_IMAGE = {
  orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
  take: 1,
  select: { url: true },
};

@Injectable()
export class MobileCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Top-level admin-created categories for the Home chip rail + Shop grid.
   *
   * Gendered call (women/men tab):
   *   - Membership: ≥1 gender-EXACT ACTIVE product, OR ≥MIN_UNISEX_ONLY_PRODUCTS
   *     unisex ones. Categories themselves stay ungendered; tab membership
   *     derives from stock, so an unstocked category simply renders no chip.
   *   - Chip cover: the newest gender-EXACT product's primary image (a men's
   *     shot on the men tab), falling back to the newest any-match (incl.
   *     unisex), then to the curated Category.imageUrl.
   *   - productCount stays the full gender-scoped total (exact + unisex) —
   *     it must match what the category's product grid will show.
   *
   * Ungendered call: all top-level categories, curated imageUrl, full counts.
   */
  async list(genderType?: GenderParam) {
    if (!genderType) return this.listAll();

    const exactGender = genderExactValue(genderType);
    const productScope = {
      product: {
        status: ProductStatus.ACTIVE,
        genderType: { in: genderFilterValues(genderType) },
      },
    };
    const exactScope = {
      product: { status: ProductStatus.ACTIVE, genderType: exactGender },
    };

    const [categories, exactCounts] = await Promise.all([
      this.prisma.category.findMany({
        where: { parentId: null, products: { some: productScope } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          imageUrl: true,
          sortOrder: true,
          // Newest any-match cover — the fallback when no gender-exact
          // product exists (unisex-only categories).
          products: {
            where: productScope,
            take: 1,
            orderBy: { product: { createdAt: 'desc' as const } },
            select: { product: { select: { images: PRIMARY_IMAGE } } },
          },
          _count: { select: { products: { where: productScope } } },
        },
      }),
      this.prisma.productCategory.groupBy({
        by: ['categoryId'],
        where: exactScope,
        _count: { _all: true },
      }),
    ]);

    const exactByCategory = new Map(
      exactCounts.map((g) => [g.categoryId, g._count._all]),
    );

    const members = categories.filter((c) => {
      const exact = exactByCategory.get(c.id) ?? 0;
      const unisexOnly = c._count.products - exact;
      return exact >= 1 || unisexOnly >= MIN_UNISEX_ONLY_PRODUCTS;
    });

    // Gender-exact cover per member category (skip the lookup where no exact
    // product exists). ≤ ~20 parallel indexed findFirsts on a low-QPS,
    // client-cached endpoint.
    const exactCovers = await Promise.all(
      members.map((c) =>
        (exactByCategory.get(c.id) ?? 0) > 0
          ? this.prisma.productCategory.findFirst({
              where: { categoryId: c.id, ...exactScope },
              orderBy: { product: { createdAt: 'desc' } },
              select: { product: { select: { images: PRIMARY_IMAGE } } },
            })
          : Promise.resolve(null),
      ),
    );

    const chips = members.map((c, i) => {
      const anyMatchCover = c.products[0]?.product.images[0]?.url;
      const exactCover = exactCovers[i]?.product.images[0]?.url;
      return toCategoryChip(
        { ...c, imageUrl: exactCover ?? anyMatchCover ?? c.imageUrl },
        c._count.products,
      );
    });

    return {
      categories: chips,
      // Covers for the client's synthetic "All" chip — a 2×2 collage of
      // gender-appropriate product images, each guaranteed distinct from
      // every category chip's cover (a single borrowed image made "All" a
      // visual duplicate of its neighbour).
      allImages: await this.allChipCovers(
        genderType,
        new Set(chips.map((c) => c.image).filter((u): u is string => !!u)),
      ),
    };
  }

  /**
   * Up to ALL_CHIP_COVER_COUNT gendered product images for the "All" collage,
   * none already used as chip covers. Newest-first is batch-import-clustered
   * (4 near-identical items from one brand's drop), so the greedy pick is
   * diversity-constrained and relaxes in passes over the combined pool
   * (exact-gender candidates ranked ahead of the tab's unisex ones):
   *   1. distinct category AND distinct store
   *   2. distinct store
   *   3. any unused image
   * Diversity outranks gender-exactness on purpose — a varied collage with a
   * unisex item beats four shots of one brand's drop. May return fewer on a
   * thin catalogue; the client degrades gracefully.
   */
  private async allChipCovers(
    genderType: GenderParam,
    usedCovers: Set<string>,
  ): Promise<string[]> {
    const fetchPool = (genders: ReturnType<typeof genderFilterValues>) =>
      this.prisma.product.findMany({
        where: {
          status: ProductStatus.ACTIVE,
          store: { status: StoreStatus.ACTIVE },
          genderType: { in: genders },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 80,
        select: {
          storeId: true,
          images: PRIMARY_IMAGE,
          categories: { take: 1, select: { categoryId: true } },
        },
      });

    const exact = genderExactValue(genderType);
    const widenValues = genderFilterValues(genderType).filter(
      (g) => g !== exact,
    );
    const [exactPool, widePool] = await Promise.all([
      fetchPool([exact]),
      widenValues.length > 0
        ? fetchPool(widenValues)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchPool>>),
    ]);
    const combined = [...exactPool, ...widePool];

    const picked: string[] = [];
    const seenCategories = new Set<string>();
    const seenStores = new Set<string>();
    const passes: ((c: (typeof combined)[number]) => boolean)[] = [
      (c) =>
        !seenCategories.has(c.categories[0]?.categoryId ?? '') &&
        !seenStores.has(c.storeId),
      (c) => !seenStores.has(c.storeId),
      () => true,
    ];
    for (const admissible of passes) {
      for (const c of combined) {
        if (picked.length >= ALL_CHIP_COVER_COUNT) return picked;
        const url = c.images[0]?.url;
        if (!url || usedCovers.has(url) || picked.includes(url)) continue;
        if (!admissible(c)) continue;
        picked.push(url);
        if (c.categories[0]) seenCategories.add(c.categories[0].categoryId);
        seenStores.add(c.storeId);
      }
    }
    return picked;
  }

  private async listAll() {
    const categories = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    });
    return {
      categories: categories.map((c) => toCategoryChip(c, c._count.products)),
    };
  }
}
