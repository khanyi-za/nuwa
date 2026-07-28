import { Test } from '@nestjs/testing';
import { GenderType, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileCategoriesService } from './mobile-categories.service';

const mockPrisma = {
  category: { findMany: jest.fn() },
  // Gender-exact counts (membership rule) + gender-exact chip covers.
  productCategory: {
    groupBy: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  // allImage candidate pool (the synthetic "All" chip's cover).
  product: { findMany: jest.fn().mockResolvedValue([]) },
};

describe('MobileCategoriesService', () => {
  let service: MobileCategoriesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileCategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileCategoriesService);
    jest.clearAllMocks();
  });

  it('maps top-level categories to chip shape with productCount', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      {
        id: 'c-shoes',
        slug: 'shoes',
        name: 'Shoes',
        imageUrl: 'https://cdn.yiiva.co.za/shoes.png',
        sortOrder: 1,
        products: [],
        _count: { products: 142 },
      },
    ]);

    const { categories } = await service.list('women');

    expect(categories[0]).toEqual({
      slug: 'shoes',
      displayName: 'Shoes',
      image: 'https://cdn.yiiva.co.za/shoes.png',
      productCount: 142,
      order: 1,
    });
  });

  it('scopes categories and counts to the gender tab (UNISEX included)', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    await service.list('women');

    const args = mockPrisma.category.findMany.mock.calls[0][0];
    const scope = {
      product: {
        status: ProductStatus.ACTIVE,
        genderType: { in: [GenderType.WOMEN, GenderType.UNISEX] },
      },
    };
    expect(args.where).toEqual({ parentId: null, products: { some: scope } });
    expect(args.select._count).toEqual({ select: { products: { where: scope } } });
  });

  it('serves the full ungendered tree when no genderType is given', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    await service.list();

    const args = mockPrisma.category.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ parentId: null });
    expect(args.select._count).toEqual({ select: { products: true } });
  });

  it('a unisex request is exact (no WOMEN/MEN bleed-in)', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    await service.list('unisex');

    const args = mockPrisma.category.findMany.mock.calls[0][0];
    expect(args.where.products.some.product.genderType).toEqual({
      in: [GenderType.UNISEX],
    });
  });

  it('gendered calls serve a matching product image as the chip image', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      {
        id: 'c-knit',
        slug: 'knitwear',
        name: 'Knitwear',
        imageUrl: 'https://cdn.yiiva.co.za/seeded-knitwear.png',
        sortOrder: 2,
        products: [
          {
            product: {
              images: [{ url: 'https://cdn.yiiva.co.za/womens-knit.jpg' }],
            },
          },
        ],
        _count: { products: 15 },
      },
      // No imaged product for this one → seeded image stays.
      {
        id: 'c-shorts',
        slug: 'shorts',
        name: 'Shorts',
        imageUrl: 'https://cdn.yiiva.co.za/seeded-shorts.png',
        sortOrder: 3,
        products: [],
        _count: { products: 2 },
      },
    ]);
    // shorts has 2 gender-EXACT products (membership via exact≥1); knitwear
    // is unisex-only but over the threshold.
    mockPrisma.productCategory.groupBy.mockResolvedValueOnce([
      { categoryId: 'c-shorts', _count: { _all: 2 } },
    ]);

    const { categories } = await service.list('women');

    expect(categories[0].image).toBe('https://cdn.yiiva.co.za/womens-knit.jpg');
    expect(categories[1].image).toBe('https://cdn.yiiva.co.za/seeded-shorts.png');
    // The any-match cover source is scoped to the SAME gender rule as the chips.
    const sel = mockPrisma.category.findMany.mock.calls[0][0].select;
    expect(sel.products.where.product.genderType).toEqual({
      in: [GenderType.WOMEN, GenderType.UNISEX],
    });
    expect(sel.products.take).toBe(1);
  });

  it('a gender-exact cover beats a newer any-match (unisex) cover', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      {
        id: 'c-pants',
        slug: 'pants',
        name: 'Pants',
        imageUrl: 'https://cdn.yiiva.co.za/seeded-pants.png',
        sortOrder: 1,
        products: [
          {
            product: {
              images: [{ url: 'https://cdn.yiiva.co.za/newest-unisex.jpg' }],
            },
          },
        ],
        _count: { products: 30 },
      },
    ]);
    mockPrisma.productCategory.groupBy.mockResolvedValueOnce([
      { categoryId: 'c-pants', _count: { _all: 12 } },
    ]);
    mockPrisma.productCategory.findFirst.mockResolvedValueOnce({
      product: { images: [{ url: 'https://cdn.yiiva.co.za/mens-pants.jpg' }] },
    });

    const { categories } = await service.list('men');

    expect(categories[0].image).toBe('https://cdn.yiiva.co.za/mens-pants.jpg');
    // The exact-cover lookup is scoped to the exact gender only.
    const coverArgs = mockPrisma.productCategory.findFirst.mock.calls[0][0];
    expect(coverArgs.where.product.genderType).toBe(GenderType.MEN);
  });

  it('a stray-unisex category is excluded from the gender tab below the threshold', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      {
        id: 'c-lingerie',
        slug: 'lingerie-underwear',
        name: 'Lingerie & Underwear',
        imageUrl: null,
        sortOrder: 1,
        products: [],
        _count: { products: 3 }, // 3 unisex, 0 men-exact → off the Men tab
      },
      {
        id: 'c-eyewear',
        slug: 'eyewear',
        name: 'Eyewear',
        imageUrl: null,
        sortOrder: 2,
        products: [],
        _count: { products: 84 }, // 84 unisex → genuinely unisex, stays
      },
    ]);
    mockPrisma.productCategory.groupBy.mockResolvedValueOnce([]);

    const { categories } = await service.list('men');

    expect(categories.map((c) => c.slug)).toEqual(['eyewear']);
    // No exact products anywhere → no cover lookups fired.
    expect(mockPrisma.productCategory.findFirst).not.toHaveBeenCalled();
  });

  it('ungendered calls do not fetch product covers (seeded images untouched)', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    const result = await service.list();

    const sel = mockPrisma.category.findMany.mock.calls[0][0].select;
    expect(sel.products).toBeUndefined();
    // No synthetic-All covers on the ungendered surface either.
    expect('allImages' in result).toBe(false);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it('allImages are gendered product images DISTINCT from every chip cover', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      {
        id: 'c-tees',
        slug: 'tees',
        name: 'T-Shirts',
        imageUrl: null,
        sortOrder: 1,
        products: [
          { product: { images: [{ url: 'https://cdn.yiiva.co.za/tee.jpg' }] } },
        ],
        _count: { products: 20 },
      },
    ]);
    mockPrisma.productCategory.groupBy.mockResolvedValueOnce([
      { categoryId: 'c-tees', _count: { _all: 20 } },
    ]);
    mockPrisma.productCategory.findFirst.mockResolvedValueOnce({
      product: { images: [{ url: 'https://cdn.yiiva.co.za/tee.jpg' }] },
    });
    // Exact-gender pool is ONE brand's drop (same store+category, first image
    // colliding with the tees chip cover). Diversity passes must prefer the
    // unisex pool's varied brands/categories over same-drop clones — clones
    // only fill the final slot.
    const drop = (url: string) => ({
      storeId: 's-a',
      categories: [{ categoryId: 'c-1' }],
      images: [{ url }],
    });
    mockPrisma.product.findMany
      .mockResolvedValueOnce([
        drop('https://cdn.yiiva.co.za/tee.jpg'),
        drop('https://cdn.yiiva.co.za/a1.jpg'),
        drop('https://cdn.yiiva.co.za/a2.jpg'),
        drop('https://cdn.yiiva.co.za/a3.jpg'),
      ])
      .mockResolvedValueOnce([
        {
          storeId: 's-b',
          categories: [{ categoryId: 'c-2' }],
          images: [{ url: 'https://cdn.yiiva.co.za/b1.jpg' }],
        },
        {
          storeId: 's-c',
          categories: [{ categoryId: 'c-3' }],
          images: [{ url: 'https://cdn.yiiva.co.za/c1.jpg' }],
        },
      ]);

    const result = await service.list('men');

    expect(result.categories[0].image).toBe('https://cdn.yiiva.co.za/tee.jpg');
    expect((result as { allImages?: string[] }).allImages).toEqual([
      'https://cdn.yiiva.co.za/a1.jpg', // exact, new store+category
      'https://cdn.yiiva.co.za/b1.jpg', // unisex, diverse — beats a2/a3 clones
      'https://cdn.yiiva.co.za/c1.jpg', // unisex, diverse
      'https://cdn.yiiva.co.za/a2.jpg', // clone admitted only for the last slot
    ]);
  });
});
