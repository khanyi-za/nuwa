import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { StoreService } from './store.service';

// Focused spec — covers the optional-auth behaviour of getPublicStore added
// for the mobile catalogue Phase 2. Other StoreService methods are not yet
// unit-tested at this level.

const STORE_ID = 'store-1';
const STORE_SLUG = 'awesome-store';
const USER_ID = 'user-1';

const baseStoreRow = {
  id: STORE_ID,
  displayName: 'Awesome Store',
  slug: STORE_SLUG,
  description: 'desc',
  story: 'story',
  logoUrl: null,
  bannerMedia: [],
  websiteUrl: null,
  averageRating: null,
  followerCount: 5,
  totalSales: 0,
  createdAt: new Date('2026-01-01'),
  addresses: [{ id: 'a-1', city: 'Cape Town' }, { id: 'a-2', city: 'Cape Town' }],
  _count: { products: 12 },
};

const mockPrisma: any = {
  store: { findFirst: jest.fn() },
  storeFollower: { findUnique: jest.fn() },
};

const mockEmail: any = {};

describe('StoreService.getPublicStore', () => {
  let service: StoreService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        StoreService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
      ],
    }).compile();
    service = module.get(StoreService);
  });

  it('returns the store with isFollowing: false when called without a user (mobile public browse)', async () => {
    mockPrisma.store.findFirst.mockResolvedValue(baseStoreRow);

    const result = await service.getPublicStore(STORE_SLUG, null);

    expect(mockPrisma.storeFollower.findUnique).not.toHaveBeenCalled();
    expect(result.isFollowing).toBe(false);
    expect(result.id).toBe(STORE_ID);
    expect(result.productCount).toBe(12);
    expect(result.locations).toEqual(['Cape Town']);
  });

  it('returns isFollowing: true when the user already follows the store', async () => {
    mockPrisma.store.findFirst.mockResolvedValue(baseStoreRow);
    mockPrisma.storeFollower.findUnique.mockResolvedValue({
      userId: USER_ID,
      storeId: STORE_ID,
    });

    const result = await service.getPublicStore(STORE_SLUG, USER_ID);

    expect(mockPrisma.storeFollower.findUnique).toHaveBeenCalledWith({
      where: { userId_storeId: { userId: USER_ID, storeId: STORE_ID } },
    });
    expect(result.isFollowing).toBe(true);
  });

  it('returns isFollowing: false when the user is authenticated but does not follow the store', async () => {
    mockPrisma.store.findFirst.mockResolvedValue(baseStoreRow);
    mockPrisma.storeFollower.findUnique.mockResolvedValue(null);

    const result = await service.getPublicStore(STORE_SLUG, USER_ID);

    expect(mockPrisma.storeFollower.findUnique).toHaveBeenCalled();
    expect(result.isFollowing).toBe(false);
  });

  it('throws 404 when the store does not exist or is not ACTIVE', async () => {
    mockPrisma.store.findFirst.mockResolvedValue(null);

    await expect(
      service.getPublicStore('missing-slug', null),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.storeFollower.findUnique).not.toHaveBeenCalled();
  });
});
