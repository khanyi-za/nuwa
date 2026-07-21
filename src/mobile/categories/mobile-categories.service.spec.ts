import { Test } from '@nestjs/testing';
import { GenderType, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileCategoriesService } from './mobile-categories.service';

const mockPrisma = {
  category: { findMany: jest.fn() },
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
        slug: 'shoes',
        name: 'Shoes',
        imageUrl: 'https://cdn.yiiva.co.za/shoes.png',
        sortOrder: 1,
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
        slug: 'shorts',
        name: 'Shorts',
        imageUrl: 'https://cdn.yiiva.co.za/seeded-shorts.png',
        sortOrder: 3,
        products: [],
        _count: { products: 2 },
      },
    ]);

    const { categories } = await service.list('women');

    expect(categories[0].image).toBe('https://cdn.yiiva.co.za/womens-knit.jpg');
    expect(categories[1].image).toBe('https://cdn.yiiva.co.za/seeded-shorts.png');
    // The cover source is scoped to the SAME gender rule as the chips.
    const sel = mockPrisma.category.findMany.mock.calls[0][0].select;
    expect(sel.products.where.product.genderType).toEqual({
      in: [GenderType.WOMEN, GenderType.UNISEX],
    });
    expect(sel.products.take).toBe(1);
  });

  it('ungendered calls do not fetch product covers (seeded images untouched)', async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);

    await service.list();

    const sel = mockPrisma.category.findMany.mock.calls[0][0].select;
    expect(sel.products).toBeUndefined();
  });
});
