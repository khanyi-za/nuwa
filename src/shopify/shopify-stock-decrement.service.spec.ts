import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyStockDecrementService } from './shopify-stock-decrement.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { encryptToken } from './token-crypto';

const KEY = randomBytes(32);
const ORDER_ID = 'order-1';

const mockPrisma = {
  order: { findUnique: jest.fn() },
  shopifyConnection: { findFirst: jest.fn() },
  shopifyProductLink: { findFirst: jest.fn() },
};
const mockClient = { graphql: jest.fn() };

const order = {
  id: ORDER_ID,
  storeId: 'store-1',
  items: [
    { productId: 'prod-1', variantId: 'var-1', quantity: 2 },
    { productId: 'prod-2', variantId: null, quantity: 1 },
  ],
};

const connection = {
  id: 'conn-1',
  shopDomain: 'fieldsstore.myshopify.com',
  encryptedToken: encryptToken('shpat_abcdef0123456789', KEY),
  primaryLocationId: '88',
  status: 'ACTIVE',
};

describe('ShopifyStockDecrementService', () => {
  let service: ShopifyStockDecrementService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShopifyStockDecrementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ShopifyConfig, useValue: { tokenKey: KEY } },
        { provide: ShopifyClient, useValue: mockClient },
      ],
    }).compile();
    service = module.get(ShopifyStockDecrementService);
    jest.clearAllMocks();
    mockPrisma.order.findUnique.mockResolvedValue(order);
    mockPrisma.shopifyConnection.findFirst.mockResolvedValue(connection);
    mockPrisma.shopifyProductLink.findFirst
      .mockResolvedValueOnce({ inventoryItemId: '5021' }) // var-1
      .mockResolvedValueOnce({ inventoryItemId: '5001' }); // bare prod-2
    mockClient.graphql.mockResolvedValue({
      inventoryAdjustQuantities: { userErrors: [] },
    });
  });

  it('no-ops for stores without an active Shopify connection', async () => {
    mockPrisma.shopifyConnection.findFirst.mockResolvedValue(null);
    await service.decrementForOrder(ORDER_ID);
    expect(mockClient.graphql).not.toHaveBeenCalled();
  });

  it('skips (with a warning) when no primary location is recorded', async () => {
    mockPrisma.shopifyConnection.findFirst.mockResolvedValue({
      ...connection,
      primaryLocationId: null,
    });
    await service.decrementForOrder(ORDER_ID);
    expect(mockClient.graphql).not.toHaveBeenCalled();
  });

  it('adjusts each linked item by -quantity at the primary location', async () => {
    await service.decrementForOrder(ORDER_ID);

    // Variant items match by variantId; bare items by productId+variantId null.
    expect(
      mockPrisma.shopifyProductLink.findFirst.mock.calls[0][0].where,
    ).toEqual({ connectionId: 'conn-1', variantId: 'var-1' });
    expect(
      mockPrisma.shopifyProductLink.findFirst.mock.calls[1][0].where,
    ).toEqual({ connectionId: 'conn-1', productId: 'prod-2', variantId: null });

    const [domain, token, , vars] = mockClient.graphql.mock.calls[0];
    expect(domain).toBe('fieldsstore.myshopify.com');
    expect(token).toBe('shpat_abcdef0123456789');
    expect(vars.input.changes).toEqual([
      {
        delta: -2,
        inventoryItemId: 'gid://shopify/InventoryItem/5021',
        locationId: 'gid://shopify/Location/88',
      },
      {
        delta: -1,
        inventoryItemId: 'gid://shopify/InventoryItem/5001',
        locationId: 'gid://shopify/Location/88',
      },
    ]);
  });

  it('skips unlinked items; no call when nothing is linked', async () => {
    mockPrisma.shopifyProductLink.findFirst.mockReset();
    mockPrisma.shopifyProductLink.findFirst.mockResolvedValue(null);

    await service.decrementForOrder(ORDER_ID);

    expect(mockClient.graphql).not.toHaveBeenCalled();
  });

  it('NEVER throws — Shopify failure is logged and swallowed', async () => {
    mockClient.graphql.mockRejectedValue(new Error('Shopify unreachable'));
    await expect(service.decrementForOrder(ORDER_ID)).resolves.toBeUndefined();
  });

  it('logs userErrors without throwing', async () => {
    mockClient.graphql.mockResolvedValue({
      inventoryAdjustQuantities: {
        userErrors: [{ field: null, message: 'Invalid location' }],
      },
    });
    await expect(service.decrementForOrder(ORDER_ID)).resolves.toBeUndefined();
  });
});
