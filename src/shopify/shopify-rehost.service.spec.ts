import { Test } from '@nestjs/testing';
import { v2 as cloudinary } from 'cloudinary';
import { ShopifyRehostService } from './shopify-rehost.service';
import { CloudinaryConfig } from '../uploads/cloudinary-config';

jest.mock('cloudinary', () => ({
  v2: { config: jest.fn(), uploader: { upload: jest.fn() } },
}));

const mockUpload = cloudinary.uploader.upload as jest.Mock;

const mockConfig = {
  cloudName: 'yiiva-dev',
  apiKey: 'key',
  apiSecret: 'secret',
};

const STORE_ID = 'store-1';
const SHOPIFY_URL = 'https://cdn.shopify.com/s/files/1/photo.jpg';

describe('ShopifyRehostService', () => {
  let service: ShopifyRehostService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyRehostService,
        { provide: CloudinaryConfig, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(ShopifyRehostService);
    jest.clearAllMocks();
  });

  it('uploads straight from the remote URL under a hash-keyed import public_id', async () => {
    mockUpload.mockResolvedValue({
      secure_url: 'https://res.cloudinary.com/yiiva-dev/stores/store-1/import/abc.jpg',
    });

    const url = await service.rehostImage(STORE_ID, SHOPIFY_URL);

    expect(url).toBe(
      'https://res.cloudinary.com/yiiva-dev/stores/store-1/import/abc.jpg',
    );
    const [source, opts] = mockUpload.mock.calls[0];
    expect(source).toBe(SHOPIFY_URL);
    expect(opts.public_id).toMatch(/^stores\/store-1\/import\/[0-9a-f]{16}$/);
    expect(opts.overwrite).toBe(false); // re-runs resume instead of re-uploading
  });

  it('is deterministic: the same source URL maps to the same public_id', async () => {
    mockUpload.mockResolvedValue({ secure_url: 'https://res.cloudinary.com/x.jpg' });

    await service.rehostImage(STORE_ID, SHOPIFY_URL);
    await service.rehostImage(STORE_ID, SHOPIFY_URL);

    expect(mockUpload.mock.calls[0][1].public_id).toBe(
      mockUpload.mock.calls[1][1].public_id,
    );
  });

  it('retries oversized Shopify-CDN originals via the width=2048 downscale', async () => {
    mockUpload
      .mockRejectedValueOnce({ message: 'File size too large' })
      .mockResolvedValueOnce({ secure_url: 'https://res.cloudinary.com/small.jpg' });

    const url = await service.rehostImage(STORE_ID, SHOPIFY_URL);

    expect(url).toBe('https://res.cloudinary.com/small.jpg');
    expect(mockUpload.mock.calls[1][0]).toBe(`${SHOPIFY_URL}?width=2048`);
  });

  it('does not downscale-retry non-Shopify URLs — fails to null', async () => {
    mockUpload.mockRejectedValue({ message: 'File size too large' });

    const url = await service.rehostImage(
      STORE_ID,
      'https://example.com/logo.png',
    );

    expect(url).toBeNull();
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('returns null (never throws) when both attempts fail', async () => {
    mockUpload.mockRejectedValue(new Error('network down'));

    await expect(
      service.rehostImage(STORE_ID, SHOPIFY_URL),
    ).resolves.toBeNull();
  });
});
