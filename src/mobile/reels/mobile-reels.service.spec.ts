import { Test } from '@nestjs/testing';
import { MediaType, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MobileReelsService } from './mobile-reels.service';
import { encodeOffsetCursor } from '../common/cursor';

const STORE = { slug: 'sakanya', displayName: 'SAKANYA', logoUrl: 'https://res.cloudinary.com/x/logo.png' };

const videoRow = (n: number) => ({
  id: `img-${n}`,
  url: `https://res.cloudinary.com/x/video-${n}.mp4`,
  product: {
    id: `prod-${n}`,
    title: `Product ${n}`,
    description: `Description ${n}`,
    priceInCents: 100_00 * n,
    store: STORE,
  },
});

const mockPrisma = {
  productImage: { findMany: jest.fn() },
};

describe('MobileReelsService', () => {
  let service: MobileReelsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileReelsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(MobileReelsService);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('serves reels in the fixture wire shape, ACTIVE-only', async () => {
      mockPrisma.productImage.findMany.mockResolvedValue([videoRow(1)]);

      const result = await service.list({ limit: 20 });

      expect(mockPrisma.productImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            mediaType: MediaType.VIDEO,
            product: {
              status: ProductStatus.ACTIVE,
              store: { status: StoreStatus.ACTIVE },
            },
          },
        }),
      );
      expect(result.data).toEqual({
        reels: [
          {
            id: 'img-1',
            video: 'https://res.cloudinary.com/x/video-1.mp4',
            productId: 'prod-1',
            productName: 'Product 1',
            description: 'Description 1',
            priceInCents: 10000,
            merchant: { username: 'sakanya', displayName: 'SAKANYA', logo: STORE.logoUrl },
          },
        ],
      });
      expect(result.pagination).toEqual({ limit: 20, hasMore: false, nextCursor: null });
    });

    it('paginates with the offset cursor and trims the sentinel row', async () => {
      mockPrisma.productImage.findMany.mockResolvedValue([videoRow(1), videoRow(2), videoRow(3)]);

      const result = await service.list({ limit: 2 });

      expect((result.data as { reels: unknown[] }).reels).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe(encodeOffsetCursor(2));
    });

    it('resumes from a cursor offset', async () => {
      mockPrisma.productImage.findMany.mockResolvedValue([]);

      await service.list({ limit: 2, cursor: encodeOffsetCursor(4) });

      expect(mockPrisma.productImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 4, take: 3 }),
      );
    });

    it('degrades null description and logo to empty strings', async () => {
      const row = videoRow(1);
      row.product.description = null as unknown as string;
      row.product.store = { ...STORE, logoUrl: null as unknown as string };
      mockPrisma.productImage.findMany.mockResolvedValue([row]);

      const result = await service.list({ limit: 20 });
      const reel = (result.data as { reels: any[] }).reels[0];

      expect(reel.description).toBe('');
      expect(reel.merchant.logo).toBe('');
    });
  });
});
