import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyTokenService } from './shopify-token.service';
import { ShopifyConfig } from './shopify-config';
import { decryptToken, encryptToken } from './token-crypto';

const KEY = randomBytes(32);

const mockPrisma = {
  shopifyConnection: {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

const legacyConnection = {
  id: 'conn-legacy',
  shopDomain: 'fieldsstore.myshopify.com',
  encryptedToken: encryptToken('shpat_abcdef0123456789', KEY),
  clientId: null,
  clientSecretEncrypted: null,
  tokenExpiresAt: null,
};

const ccConnection = {
  id: 'conn-cc',
  shopDomain: 'doppler.myshopify.com',
  encryptedToken: encryptToken('cached-token-111', KEY),
  clientId: 'client-id-123456',
  clientSecretEncrypted: encryptToken('the-client-secret-000000', KEY),
  tokenExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12h left
};

describe('ShopifyTokenService', () => {
  let service: ShopifyTokenService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyTokenService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: { tokenKey: KEY } },
      ],
    }).compile();
    service = module.get(ShopifyTokenService);
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockPrisma.shopifyConnection.update.mockResolvedValue({});
  });

  describe('getTokenFor', () => {
    it('legacy connection: returns the stored permanent token, no exchange', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      const token = await service.getTokenFor(legacyConnection);

      expect(token).toBe('shpat_abcdef0123456789');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPrisma.shopifyConnection.update).not.toHaveBeenCalled();
    });

    it('client-credentials with a fresh cached token: returns it without refreshing', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');

      const token = await service.getTokenFor(ccConnection);

      expect(token).toBe('cached-token-111');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('expired cached token: exchanges, persists the new token + expiry, returns it', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-token-222', expires_in: 86399 }),
      } as Response);
      const expired = {
        ...ccConnection,
        tokenExpiresAt: new Date(Date.now() - 1000),
      };

      const token = await service.getTokenFor(expired);

      expect(token).toBe('fresh-token-222');
      const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://doppler.myshopify.com/admin/oauth/access_token');
      expect(init.body).toContain('grant_type=client_credentials');
      expect(init.body).toContain('client_id=client-id-123456');
      // decrypted secret went into the exchange, not the ciphertext
      expect(init.body).toContain('the-client-secret-000000');

      const update = mockPrisma.shopifyConnection.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'conn-cc' });
      expect(decryptToken(update.data.encryptedToken, KEY)).toBe(
        'fresh-token-222',
      );
      expect(update.data.tokenExpiresAt).toBeInstanceOf(Date);
      expect(update.data.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('token within the refresh margin (<2 min left) also triggers refresh', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-token-333', expires_in: 86399 }),
      } as Response);
      const nearlyExpired = {
        ...ccConnection,
        tokenExpiresAt: new Date(Date.now() + 60 * 1000), // 1 min left
      };

      const token = await service.getTokenFor(nearlyExpired);

      expect(token).toBe('fresh-token-333');
    });

    it('concurrent callers share ONE exchange (in-flight dedup)', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'fresh-token-444', expires_in: 86399 }),
      } as Response);
      const expired = {
        ...ccConnection,
        tokenExpiresAt: new Date(Date.now() - 1000),
      };

      const [a, b] = await Promise.all([
        service.getTokenFor(expired),
        service.getTokenFor(expired),
      ]);

      expect(a).toBe('fresh-token-444');
      expect(b).toBe('fresh-token-444');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('exchange', () => {
    it('4xx from Shopify → BadRequest INVALID_SHOPIFY_CREDENTIALS', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid client',
      } as Response);

      await expect(
        service.exchange('shop.myshopify.com', 'id', 'secret'),
      ).rejects.toThrow(BadRequestException);
    });

    it('5xx from Shopify → ServiceUnavailable', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'down',
      } as Response);

      await expect(
        service.exchange('shop.myshopify.com', 'id', 'secret'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('network failure → ServiceUnavailable SHOPIFY_UNREACHABLE', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.exchange('shop.myshopify.com', 'id', 'secret'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('computes expiresAt from expires_in', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 86399 }),
      } as Response);

      const before = Date.now();
      const { accessToken, expiresAt } = await service.exchange(
        'shop.myshopify.com',
        'id',
        'secret',
      );

      expect(accessToken).toBe('tok');
      const delta = expiresAt.getTime() - before;
      expect(delta).toBeGreaterThan(86_000_000);
      expect(delta).toBeLessThan(86_500_000);
    });
  });

  describe('getToken', () => {
    it('loads the connection by id and delegates', async () => {
      mockPrisma.shopifyConnection.findUniqueOrThrow.mockResolvedValue(
        legacyConnection,
      );

      const token = await service.getToken('conn-legacy');

      expect(token).toBe('shpat_abcdef0123456789');
      expect(
        mockPrisma.shopifyConnection.findUniqueOrThrow,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn-legacy' } }),
      );
    });
  });
});
