import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyWebhookRegistrationService } from './shopify-webhook-registration.service';
import { decryptToken, encryptToken } from './token-crypto';

const USER_ID = 'user-1';
const KEY = randomBytes(32);

const mockPrisma = {
  shopifyConnection: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};
const mockClient = { fetchShopInfo: jest.fn() };
const mockRegistration = {
  registerForConnection: jest.fn(),
  unregisterForConnection: jest.fn(),
};

const shopInfo = {
  name: 'FIELDS',
  email: 'owner@fields.co.za',
  currencyCode: 'ZAR',
  myshopifyDomain: 'fieldsstore.myshopify.com',
  primaryDomain: 'fieldsstore.co.za',
  productsCount: 52,
};

const connectionRow = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  shopName: 'FIELDS',
  currencyCode: 'ZAR',
  storeId: null,
  createdAt: new Date('2026-07-22T10:00:00Z'),
};

describe('ShopifyConnectionService', () => {
  let service: ShopifyConnectionService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyConnectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: { tokenKey: KEY } },
        { provide: ShopifyClient, useValue: mockClient },
        {
          provide: ShopifyWebhookRegistrationService,
          useValue: mockRegistration,
        },
      ],
    }).compile();
    service = module.get(ShopifyConnectionService);
    jest.clearAllMocks();
    mockClient.fetchShopInfo.mockResolvedValue(shopInfo);
    mockPrisma.shopifyConnection.findUnique.mockResolvedValue(null);
    mockPrisma.shopifyConnection.upsert.mockResolvedValue(connectionRow);
  });

  describe('connect', () => {
    const dto = {
      shopDomain: 'fieldsstore.myshopify.com',
      accessToken: 'shpat_abcdef0123456789',
    };

    it('validates live, stores the token ENCRYPTED, returns the preview', async () => {
      const view = await service.connect(USER_ID, dto);

      expect(mockClient.fetchShopInfo).toHaveBeenCalledWith(
        'fieldsstore.myshopify.com',
        dto.accessToken,
      );

      const upsert = mockPrisma.shopifyConnection.upsert.mock.calls[0][0];
      expect(upsert.create.encryptedToken).not.toContain('shpat_');
      expect(decryptToken(upsert.create.encryptedToken, KEY)).toBe(
        dto.accessToken,
      );

      expect(view).toMatchObject({
        shopDomain: 'fieldsstore.myshopify.com',
        shopName: 'FIELDS',
        currencyCode: 'ZAR',
        currencySupported: true,
        productsCount: 52,
        websiteDomain: 'fieldsstore.co.za',
      });
    });

    it.each([
      ['fieldsstore', 'fieldsstore.myshopify.com'],
      ['https://fieldsstore.myshopify.com/admin', 'fieldsstore.myshopify.com'],
      ['FieldsStore.MyShopify.com', 'fieldsstore.myshopify.com'],
    ])('normalizes %s → %s', async (input, expected) => {
      await service.connect(USER_ID, { ...dto, shopDomain: input });
      expect(mockClient.fetchShopInfo.mock.calls[0][0]).toBe(expected);
    });

    it('rejects non-myshopify domains with a helpful error', async () => {
      await expect(
        service.connect(USER_ID, { ...dto, shopDomain: 'fields.co.za' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockClient.fetchShopInfo).not.toHaveBeenCalled();
    });

    it('trusts the shop-reported canonical domain over user input', async () => {
      mockClient.fetchShopInfo.mockResolvedValue({
        ...shopInfo,
        myshopifyDomain: 'Fields-Store.myshopify.com',
      });

      await service.connect(USER_ID, dto);

      expect(
        mockPrisma.shopifyConnection.upsert.mock.calls[0][0].where.shopDomain,
      ).toBe('fields-store.myshopify.com');
    });

    it("refuses a shop already connected to a DIFFERENT user's account", async () => {
      mockPrisma.shopifyConnection.findUnique.mockResolvedValue({
        id: 'conn-x',
        userId: 'someone-else',
      });

      await expect(service.connect(USER_ID, dto)).rejects.toThrow(
        /already connected/,
      );
      expect(mockPrisma.shopifyConnection.upsert).not.toHaveBeenCalled();
    });

    it('flags unsupported currencies in the preview', async () => {
      mockClient.fetchShopInfo.mockResolvedValue({
        ...shopInfo,
        currencyCode: 'USD',
      });
      mockPrisma.shopifyConnection.upsert.mockResolvedValue({
        ...connectionRow,
        currencyCode: 'USD',
      });

      const view = await service.connect(USER_ID, dto);
      expect(view.currencySupported).toBe(false);
    });
  });

  describe('getActiveWithToken', () => {
    it('returns the connection with the token DECRYPTED', async () => {
      mockPrisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        shopDomain: 'fieldsstore.myshopify.com',
        encryptedToken: encryptToken('shpat_abcdef0123456789', KEY),
        currencyCode: 'ZAR',
        storeId: null,
      });

      const result = await service.getActiveWithToken(USER_ID);

      expect(result).toEqual({
        id: 'conn-1',
        shopDomain: 'fieldsstore.myshopify.com',
        currencyCode: 'ZAR',
        storeId: null,
        accessToken: 'shpat_abcdef0123456789',
      });
      expect(
        mockPrisma.shopifyConnection.findFirst.mock.calls[0][0].where,
      ).toEqual({ userId: USER_ID, status: 'ACTIVE' });
    });

    it('404s when nothing is connected', async () => {
      mockPrisma.shopifyConnection.findFirst.mockResolvedValue(null);
      await expect(service.getActiveWithToken(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMine / disconnect', () => {
    it('404s when nothing is connected', async () => {
      mockPrisma.shopifyConnection.findFirst.mockResolvedValue(null);
      await expect(service.getMine(USER_ID)).rejects.toThrow(NotFoundException);
      await expect(service.disconnect(USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('disconnect is a soft status flip', async () => {
      mockPrisma.shopifyConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        shopDomain: 'fieldsstore.myshopify.com',
      });
      mockPrisma.shopifyConnection.update.mockResolvedValue({});

      const res = await service.disconnect(USER_ID);

      expect(res).toEqual({ disconnected: true });
      expect(mockPrisma.shopifyConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { status: 'DISCONNECTED' },
      });
      // Best-effort webhook cleanup fires on disconnect.
      expect(mockRegistration.unregisterForConnection).toHaveBeenCalledWith(
        'conn-1',
      );
    });
  });
});
