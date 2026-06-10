import { Test } from '@nestjs/testing';
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
    // Only root categories.
    expect(mockPrisma.category.findMany.mock.calls[0][0].where).toEqual({
      parentId: null,
    });
  });
});
