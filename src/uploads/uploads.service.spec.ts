import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CloudinaryConfig } from './cloudinary-config';
import { UploadContext } from './dto/cloudinary-signature-request.dto';
import { UploadsService } from './uploads.service';

// Fixtures
const USER_ID = 'user-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';
const COLLECTION_ID = 'coll-1';
const CATEGORY_ID = 'cat-1';
const OTHER_STORE_ID = 'store-2';

const CLOUD_NAME = 'yiiva-dev';
const API_KEY = '255575148964243';
const API_SECRET = 'test-secret-value';

const mockPrisma = {
  store: { findUnique: jest.fn() },
  product: { findUnique: jest.fn() },
  storeCollection: { findUnique: jest.fn() },
  category: { findUnique: jest.fn() },
};

const mockStoreService = {
  canManageStore: jest.fn(),
};

const mockCloudinaryConfig = {
  cloudName: CLOUD_NAME,
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  urlPrefix: `https://res.cloudinary.com/${CLOUD_NAME}/`,
};

describe('UploadsService', () => {
  let service: UploadsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StoreService, useValue: mockStoreService },
        { provide: CloudinaryConfig, useValue: mockCloudinaryConfig },
      ],
    }).compile();

    service = module.get(UploadsService);
  });

  describe('generateSignature — store_logo', () => {
    it('returns signed payload for the store owner', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });

      expect(result).toMatchObject({
        cloudName: CLOUD_NAME,
        apiKey: API_KEY,
        preset: 'store_logo',
        folder: `stores/${STORE_ID}/logo`,
        resourceType: 'image',
      });
      expect(typeof result.signature).toBe('string');
      expect(result.signature).toMatch(/^[a-f0-9]{40}$/);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('throws 404 when store does not exist', async () => {
      mockPrisma.store.findUnique.mockResolvedValue(null);

      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.STORE_LOGO,
          storeId: 'missing-store',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 403 when user cannot manage the store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(false);

      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.STORE_LOGO,
          storeId: STORE_ID,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateSignature — store_banner', () => {
    it('resolves the banner folder', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_BANNER,
        storeId: STORE_ID,
      });

      expect(result.preset).toBe('store_banner');
      expect(result.folder).toBe(`stores/${STORE_ID}/banner`);
      expect(result.resourceType).toBe('image');
    });
  });

  describe('generateSignature — product_image', () => {
    it('returns signed payload when product belongs to the user\'s store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: STORE_ID,
      });

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.PRODUCT_IMAGE,
        storeId: STORE_ID,
        productId: PRODUCT_ID,
      });

      expect(result.preset).toBe('product_image');
      expect(result.folder).toBe(`products/${PRODUCT_ID}/images`);
      expect(result.resourceType).toBe('image');
    });

    it('throws 404 when product belongs to a different store (anti-enumeration)', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: OTHER_STORE_ID, // different store
      });

      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.PRODUCT_IMAGE,
          storeId: STORE_ID,
          productId: PRODUCT_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when product does not exist', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.PRODUCT_IMAGE,
          storeId: STORE_ID,
          productId: 'missing-prod',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateSignature — product_video', () => {
    it('resolves to the video folder + resourceType=video', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.product.findUnique.mockResolvedValue({
        id: PRODUCT_ID,
        storeId: STORE_ID,
      });

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.PRODUCT_VIDEO,
        storeId: STORE_ID,
        productId: PRODUCT_ID,
      });

      expect(result.preset).toBe('product_video');
      expect(result.folder).toBe(`products/${PRODUCT_ID}/videos`);
      expect(result.resourceType).toBe('video');
    });
  });

  describe('generateSignature — collection_image', () => {
    it('returns signed payload when collection belongs to the store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeCollection.findUnique.mockResolvedValue({
        id: COLLECTION_ID,
        storeId: STORE_ID,
      });

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.COLLECTION_IMAGE,
        storeId: STORE_ID,
        collectionId: COLLECTION_ID,
      });

      expect(result.preset).toBe('collection_image');
      expect(result.folder).toBe(
        `stores/${STORE_ID}/collections/${COLLECTION_ID}`,
      );
    });

    it('throws 404 when collection belongs to a different store', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);
      mockPrisma.storeCollection.findUnique.mockResolvedValue({
        id: COLLECTION_ID,
        storeId: OTHER_STORE_ID,
      });

      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.COLLECTION_IMAGE,
          storeId: STORE_ID,
          collectionId: COLLECTION_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateSignature — category_image', () => {
    it('returns signed payload when caller is ADMIN', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({ id: CATEGORY_ID });

      const result = await service.generateSignature(USER_ID, UserRole.ADMIN, {
        uploadContext: UploadContext.CATEGORY_IMAGE,
        categoryId: CATEGORY_ID,
      });

      expect(result.preset).toBe('category_image');
      expect(result.folder).toBe(`categories/${CATEGORY_ID}`);
      expect(result.resourceType).toBe('image');
    });

    it('throws 403 when caller is MERCHANT (not ADMIN)', async () => {
      await expect(
        service.generateSignature(USER_ID, UserRole.MERCHANT, {
          uploadContext: UploadContext.CATEGORY_IMAGE,
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toThrow(ForbiddenException);

      // Should not even reach the category lookup
      expect(mockPrisma.category.findUnique).not.toHaveBeenCalled();
    });

    it('throws 403 when caller is BUYER', async () => {
      await expect(
        service.generateSignature(USER_ID, UserRole.BUYER, {
          uploadContext: UploadContext.CATEGORY_IMAGE,
          categoryId: CATEGORY_ID,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when category does not exist', async () => {
      mockPrisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.generateSignature(USER_ID, UserRole.ADMIN, {
          uploadContext: UploadContext.CATEGORY_IMAGE,
          categoryId: 'missing-cat',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not consult StoreService for category_image', async () => {
      mockPrisma.category.findUnique.mockResolvedValue({ id: CATEGORY_ID });

      await service.generateSignature(USER_ID, UserRole.ADMIN, {
        uploadContext: UploadContext.CATEGORY_IMAGE,
        categoryId: CATEGORY_ID,
      });

      expect(mockStoreService.canManageStore).not.toHaveBeenCalled();
      expect(mockPrisma.store.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('signature computation', () => {
    it('is deterministic for the same params', async () => {
      // Freeze time so timestamp is identical
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      const a = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });
      const b = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });

      expect(a.signature).toBe(b.signature);
      expect(a.timestamp).toBe(b.timestamp);
    });

    it('produces different signatures for different folders', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      const logo = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });
      const banner = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_BANNER,
        storeId: STORE_ID,
      });

      expect(logo.signature).not.toBe(banner.signature);
    });

    it('produces different signatures for different timestamps', async () => {
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const a = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });

      jest.spyOn(Date, 'now').mockReturnValue(1700000010000); // 10s later
      const b = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });

      expect(a.signature).not.toBe(b.signature);
      expect(a.timestamp).not.toBe(b.timestamp);
    });

    it('matches the documented Cloudinary algorithm (manual hash check)', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      mockPrisma.store.findUnique.mockResolvedValue({ id: STORE_ID });
      mockStoreService.canManageStore.mockResolvedValue(true);

      const result = await service.generateSignature(USER_ID, UserRole.MERCHANT, {
        uploadContext: UploadContext.STORE_LOGO,
        storeId: STORE_ID,
      });

      // Manually compute the expected SHA-1 to lock the algorithm down.
      const { createHash } = require('crypto');
      const expectedParams = `folder=stores/${STORE_ID}/logo&timestamp=${result.timestamp}&upload_preset=store_logo`;
      const expected = createHash('sha1')
        .update(expectedParams + API_SECRET)
        .digest('hex');

      expect(result.signature).toBe(expected);
    });
  });
});
