import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { CheckoutService } from './checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PAYMENT_SERVICE,
  IPaymentService,
} from '../contracts/payment-contract';
import {
  SHIPPING_SERVICE,
  IShippingService,
} from '../contracts/shipping-contract';
import * as stock from '../cart/stock';

// ─── Mock stock module ──────────────────────────────────────────────────────

jest.mock('../cart/stock', () => ({
  reserveStock: jest.fn(),
  releaseStock: jest.fn(),
}));

const reserveStockMock = stock.reserveStock as jest.Mock;
const releaseStockMock = stock.releaseStock as jest.Mock;

// ─── Shared fixtures ────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const ADDRESS_ID = 'addr-1';
const STORE_ID = 'store-1';
const PRODUCT_ID = 'prod-1';

const baseProduct = {
  id: PRODUCT_ID,
  storeId: STORE_ID,
  title: 'Jacaranda Throw',
  slug: 'jacaranda-throw',
  status: ProductStatus.ACTIVE,
  priceInCents: 45_000,
  totalStock: 10,
  reservedStock: 2,
  store: {
    id: STORE_ID,
    displayName: 'Jacaranda Studio',
    slug: 'jacaranda-studio',
  },
  images: [{ url: 'https://cdn.example/thumb.jpg', sortOrder: 0 }],
};

const baseAddress = {
  id: ADDRESS_ID,
  userId: USER_ID,
  recipientName: 'Thandi Dlamini',
  phone: '+27821234567',
  addressLine1: '10 Baker St',
  addressLine2: null,
  city: 'Durban',
  province: 'KwaZulu-Natal',
  postalCode: '4001',
  country: 'South Africa',
  isDefault: true,
  deletedAt: null,
};

const cartWithItems = {
  id: 'cart-1',
  userId: USER_ID,
  items: [
    {
      id: 'item-1',
      cartId: 'cart-1',
      productId: PRODUCT_ID,
      variantId: null,
      quantity: 2,
      product: baseProduct,
      variant: null,
    },
  ],
};

// ─── Prisma mock ────────────────────────────────────────────────────────────

const mockPrisma = {
  cart: { findUnique: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
  address: { findUnique: jest.fn() },
  product: { findUnique: jest.fn() },
  productVariant: { findUnique: jest.fn() },
  storeDispatchAddress: { findFirst: jest.fn() },
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  order: {
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  orderItem: { deleteMany: jest.fn() },
  paymentGroup: {
    create: jest.fn(),
    delete: jest.fn(),
  },
  payment: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $transaction: jest.fn((fn: (tx: typeof mockPrisma) => unknown) =>
    fn(mockPrisma),
  ),
};

// ─── Stubs ──────────────────────────────────────────────────────────────────

const mockShipping: IShippingService = {
  getRate: jest.fn().mockResolvedValue({
    quoteId: 'stub-quote-1',
    rateInCents: 11_000,
    rateExVatInCents: 11_000,
    serviceTier: 'ECO',
    estimatedDeliveryDate: new Date('2026-05-01'),
  }),
};

const mockPayment: IPaymentService = {
  initializePayment: jest.fn().mockResolvedValue({
    actionUrl: 'https://sandbox.payfast.co.za/eng/process',
    fields: {
      merchant_id: '10000100',
      m_payment_id: 'm-stub',
      amount: '550.00',
      item_name: 'YIIVA Order YV-2026-001234',
      signature: 'stub-sig',
    },
  }),
  refundPayment: jest.fn(),
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('CheckoutService', () => {
  let service: CheckoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SHIPPING_SERVICE, useValue: mockShipping },
        { provide: PAYMENT_SERVICE, useValue: mockPayment },
      ],
    }).compile();

    service = module.get<CheckoutService>(CheckoutService);
    jest.clearAllMocks();

    // Re-bind $transaction after clearAllMocks.
    mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

    // Default: every store has a primary dispatch address.
    mockPrisma.storeDispatchAddress.findFirst.mockResolvedValue({
      id: 'disp-1',
      storeId: 'store-1',
      isPrimary: true,
      deletedAt: null,
      addressLine1: '194 Bancor Avenue',
      addressLine2: null,
      suburb: 'Menlyn',
      city: 'Pretoria',
      province: 'Gauteng',
      postalCode: '0181',
      country: 'South Africa',
    });

    // Re-prime shipping rate mock after clearAllMocks (the inline value above
    // is wiped by clearAllMocks since it was set with mockResolvedValue at
    // declaration time).
    (mockShipping.getRate as jest.Mock).mockResolvedValue({
      quoteId: 'stub-quote-1',
      rateInCents: 11_000,
      rateExVatInCents: 11_000,
      serviceTier: 'ECO',
      estimatedDeliveryDate: new Date('2026-05-01'),
    });
  });

  // ─── Input validation ────────────────────────────────────────────────────

  describe('input validation', () => {
    it('rejects authenticated buyers without addressId', async () => {
      await expect(
        service.quote(USER_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects authenticated buyers who also send guest info', async () => {
      await expect(
        service.quote(USER_ID, {
          addressId: ADDRESS_ID,
          guest: {
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            phone: '0821234567',
            address: {
              recipientName: 'A B',
              phone: '0821234567',
              addressLine1: '1 St',
              city: 'CT',
              province: 'Western Cape',
              postalCode: '8001',
            },
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects guests without guest info', async () => {
      await expect(service.quote(null, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects guests without items', async () => {
      await expect(
        service.quote(null, {
          guest: {
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            phone: '0821234567',
            address: {
              recipientName: 'A B',
              phone: '0821234567',
              addressLine1: '1 St',
              city: 'CT',
              province: 'Western Cape',
              postalCode: '8001',
            },
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Quote (authenticated) ───────────────────────────────────────────────

  describe('quote (authenticated buyer)', () => {
    beforeEach(() => {
      mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems);
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
    });

    it('returns grouped totals with per-store shipping and commission', async () => {
      const result = await service.quote(USER_ID, { addressId: ADDRESS_ID });

      expect(result.stores).toHaveLength(1);
      expect(result.stores[0]).toMatchObject({
        storeId: STORE_ID,
        subtotalInCents: 90_000, // 45000 × 2
        shippingInCents: 11_000, // per-store ShipLogic quote
        commissionInCents: 4_950, // 90000 × 0.055 (shipping is NOT commissionable)
        totalInCents: 101_000, // subtotal + per-store shipping
      });
      expect(result.grandSubtotalInCents).toBe(90_000);
      expect(result.grandShippingInCents).toBe(11_000);
      expect(result.grandTotalInCents).toBe(101_000);
      // shippingQuoteId is now a composite of per-store quote IDs joined by '|'.
      expect(result.shippingQuoteId).toContain('stub-quote-1');
    });

    it('throws 400 when the cart is empty', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(null);

      await expect(
        service.quote(USER_ID, { addressId: ADDRESS_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when the address is not owned by the buyer', async () => {
      mockPrisma.address.findUnique.mockResolvedValue({
        ...baseAddress,
        userId: 'other-user',
      });

      await expect(
        service.quote(USER_ID, { addressId: ADDRESS_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 409 when a cart item is partially out of stock', async () => {
      // totalStock dropped below reservedStock + quantity.
      mockPrisma.cart.findUnique.mockResolvedValue({
        ...cartWithItems,
        items: [
          {
            ...cartWithItems.items[0],
            quantity: 5,
            product: { ...baseProduct, totalStock: 3, reservedStock: 5 },
          },
        ],
      });

      await expect(
        service.quote(USER_ID, { addressId: ADDRESS_ID }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Commit (authenticated) ──────────────────────────────────────────────

  describe('commit (authenticated buyer)', () => {
    let orderCounter: number;

    beforeEach(() => {
      orderCounter = 0;
      mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems);
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      mockPrisma.order.findUnique.mockResolvedValue(null); // no collision
      mockPrisma.order.create.mockImplementation(() => {
        orderCounter++;
        return Promise.resolve({
          id: `order-${orderCounter}`,
          orderNumber: `YV-2026-TEST${orderCounter}`,
        });
      });
      mockPrisma.paymentGroup.create.mockResolvedValue({
        id: 'pg-1',
        mPaymentId: 'm-1',
      });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'buyer@example.com',
        firstName: 'Thandi',
        lastName: 'Dlamini',
      });
    });

    it('creates orders, payments, calls PayFast, clears cart', async () => {
      const result = await service.commit(USER_ID, {
        addressId: ADDRESS_ID,
        returnUrl: 'https://yiiva.co.za/return',
        cancelUrl: 'https://yiiva.co.za/cancel',
      });

      expect(result.orderNumbers).toHaveLength(1);
      expect(result.payfast.actionUrl).toContain('sandbox.payfast');
      expect(result.payfast.fields.signature).toBeDefined();
      expect(result.paymentGroupId).toBeDefined();
      expect(result.mPaymentId).toBeDefined();

      // Order created with snapshot — per-store shipping populated (Phase 4).
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storeId: STORE_ID,
            subtotalInCents: 90_000,
            shippingInCents: 11_000, // per-store ShipLogic rate
            totalInCents: 101_000, // subtotal + per-store shipping
            shippingDispatchAddressId: 'disp-1', // dispatch from primary
            shippingQuoteId: 'stub-quote-1',
            shippingServiceTier: 'ECO',
            shippingName: 'Thandi Dlamini',
            shippingCity: 'Durban',
          }),
        }),
      );

      // PaymentGroup created with shipping at group level.
      expect(mockPrisma.paymentGroup.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.paymentGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shippingInCents: 11_000,
          }),
        }),
      );

      // Payment holds merchant's slice only (no shipping).
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountGrossInCents: 90_000,
            platformCommissionInCents: 4_950,
            merchantPayoutInCents: 85_050, // 90000 - 4950
          }),
        }),
      );

      // PayFast called with grand total (subtotal + shipping).
      expect(mockPayment.initializePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          totalAmountInCents: 101_000,
          buyerEmail: 'buyer@example.com',
        }),
      );

      // Cart cleared (without releasing stock — raw deleteMany).
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cart: { userId: USER_ID } },
      });
    });

    it('rolls back orders on PayFast init failure', async () => {
      (mockPayment.initializePayment as jest.Mock).mockRejectedValueOnce(
        new Error('PayFast timeout'),
      );

      await expect(
        service.commit(USER_ID, {
          addressId: ADDRESS_ID,
          returnUrl: 'https://yiiva.co.za/return',
          cancelUrl: 'https://yiiva.co.za/cancel',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      // Compensating TX ran.
      expect(mockPrisma.payment.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.order.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.paymentGroup.delete).toHaveBeenCalled();

      // Cart NOT cleared.
      expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('does not release stock for authenticated buyers on rollback', async () => {
      (mockPayment.initializePayment as jest.Mock).mockRejectedValueOnce(
        new Error('fail'),
      );

      await expect(
        service.commit(USER_ID, {
          addressId: ADDRESS_ID,
          returnUrl: 'r',
          cancelUrl: 'c',
        }),
      ).rejects.toThrow();

      // releaseStock NOT called — authenticated buyers' stock is still
      // reserved in the cart (cart is untouched).
      expect(releaseStockMock).not.toHaveBeenCalled();
    });
  });

  // ─── Quote (guest) ───────────────────────────────────────────────────────

  describe('quote (guest)', () => {
    const guestDto = {
      guest: {
        email: 'guest@example.com',
        firstName: 'Guest',
        lastName: 'Buyer',
        phone: '0821234567',
        address: {
          recipientName: 'Guest Buyer',
          phone: '0821234567',
          addressLine1: '1 Main Rd',
          city: 'Durban',
          province: 'KwaZulu-Natal',
          postalCode: '4001',
        },
      },
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    };

    it('returns totals from DTO items (no cart read)', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(baseProduct);

      const result = await service.quote(null, guestDto);

      expect(result.stores).toHaveLength(1);
      expect(result.grandSubtotalInCents).toBe(45_000);
      expect(result.grandTotalInCents).toBe(56_000); // 45000 + 11000

      // Cart was NOT read (guest has no server cart).
      expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 when a guest item references a non-ACTIVE product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...baseProduct,
        status: ProductStatus.ARCHIVED,
      });

      await expect(service.quote(null, guestDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Commit (guest) ──────────────────────────────────────────────────────

  describe('commit (guest)', () => {
    const guestCommitDto = {
      guest: {
        email: 'guest@example.com',
        firstName: 'Guest',
        lastName: 'Buyer',
        phone: '0821234567',
        address: {
          recipientName: 'Guest Buyer',
          phone: '0821234567',
          addressLine1: '1 Main Rd',
          city: 'Durban',
          province: 'KwaZulu-Natal',
          postalCode: '4001',
        },
      },
      items: [{ productId: PRODUCT_ID, quantity: 2 }],
      returnUrl: 'https://yiiva.co.za/return',
      cancelUrl: 'https://yiiva.co.za/cancel',
    };

    const guestAddress = {
      id: 'guest-addr-1',
      recipientName: 'Guest Buyer',
      phone: '+27821234567',
      addressLine1: '1 Main Rd',
      addressLine2: null,
      city: 'Durban',
      province: 'KwaZulu-Natal',
      postalCode: '4001',
      country: 'South Africa',
      userId: 'guest-user-1',
      isDefault: true,
      deletedAt: null,
    };

    beforeEach(() => {
      mockPrisma.product.findUnique.mockResolvedValue(baseProduct);
      // user.findUnique is called twice:
      // 1. Inside tx: email collision check → null (no existing account)
      // 2. After tx: fetch buyer info for PayFast request
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          email: 'guest@example.com',
          firstName: 'Guest',
          lastName: 'Buyer',
        });
      mockPrisma.user.create.mockResolvedValue({ id: 'guest-user-1' });
      (mockPrisma as any).address = {
        ...mockPrisma.address,
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'guest-addr-1' }),
      };
      // address.findUnique is called for the snapshot after creation.
      mockPrisma.address.findUnique.mockResolvedValue(guestAddress);
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-guest-1',
        orderNumber: 'YV-2026-GUEST',
      });
      mockPrisma.paymentGroup.create.mockResolvedValue({
        id: 'pg-g1',
        mPaymentId: 'm-g1',
      });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-g1' });
    });

    it('materializes a guest user, reserves stock, creates orders', async () => {
      const result = await service.commit(null, guestCommitDto);

      expect(result.orderNumbers).toHaveLength(1);
      expect(result.payfast.actionUrl).toContain('sandbox.payfast');
      expect(result.payfast.fields.signature).toBeDefined();

      // Guest user created.
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'guest@example.com',
            isGuestAccount: true,
          }),
        }),
      );

      // Stock reserved for guest items.
      expect(reserveStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        2,
      );

      // Cart NOT cleared (guest had no server cart).
      expect(mockPrisma.cartItem.deleteMany).not.toHaveBeenCalled();
    });

    it('throws 409 when guest email belongs to a non-guest account', async () => {
      mockPrisma.user.findUnique.mockReset();
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user',
        isGuestAccount: false,
      });

      await expect(
        service.commit(null, guestCommitDto),
      ).rejects.toThrow(ConflictException);
    });

    it('releases guest stock on PayFast failure rollback', async () => {
      // Re-mock user.findUnique for this test (beforeEach mocks consumed).
      mockPrisma.user.findUnique.mockReset();
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null) // email collision check
        .mockResolvedValueOnce({
          email: 'guest@example.com',
          firstName: 'Guest',
          lastName: 'Buyer',
        });
      (mockPayment.initializePayment as jest.Mock).mockRejectedValueOnce(
        new Error('PayFast down'),
      );

      await expect(
        service.commit(null, guestCommitDto),
      ).rejects.toThrow(InternalServerErrorException);

      // Guest stock released in compensating TX.
      expect(releaseStockMock).toHaveBeenCalledWith(
        mockPrisma,
        PRODUCT_ID,
        null,
        2,
      );
    });
  });

  // ─── Phase 10 gap tests ─────────────────────────────────────────────────

  describe('input validation — edge cases', () => {
    it('rejects authenticated buyer with empty string addressId', async () => {
      await expect(
        service.quote(USER_ID, { addressId: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects guest checkout with empty items array', async () => {
      await expect(
        service.quote(null, {
          guest: {
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            phone: '0821234567',
            address: {
              recipientName: 'A B',
              phone: '0821234567',
              addressLine1: '1 St',
              city: 'CT',
              province: 'Western Cape',
              postalCode: '8001',
            },
          },
          items: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveItemsFromDto — edge cases', () => {
    it('throws 400 when variant does not belong to the product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(baseProduct);
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'var-wrong',
        productId: 'some-other-product',
      });

      await expect(
        service.quote(null, {
          guest: {
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            phone: '0821234567',
            address: {
              recipientName: 'A B',
              phone: '0821234567',
              addressLine1: '1 St',
              city: 'CT',
              province: 'Western Cape',
              postalCode: '8001',
            },
          },
          items: [{ productId: PRODUCT_ID, variantId: 'var-wrong', quantity: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when variant does not exist', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(baseProduct);
      mockPrisma.productVariant.findUnique.mockResolvedValue(null);

      await expect(
        service.quote(null, {
          guest: {
            email: 'a@b.com',
            firstName: 'A',
            lastName: 'B',
            phone: '0821234567',
            address: {
              recipientName: 'A B',
              phone: '0821234567',
              addressLine1: '1 St',
              city: 'CT',
              province: 'Western Cape',
              postalCode: '8001',
            },
          },
          items: [{ productId: PRODUCT_ID, variantId: 'nonexistent', quantity: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rollbackOrders', () => {
    it('deletes in correct FK order: payments → order items → orders → payment group', async () => {
      const callOrder: string[] = [];
      mockPrisma.payment.deleteMany.mockImplementation(() => {
        callOrder.push('payment.deleteMany');
        return Promise.resolve();
      });
      mockPrisma.orderItem.deleteMany.mockImplementation(() => {
        callOrder.push('orderItem.deleteMany');
        return Promise.resolve();
      });
      mockPrisma.order.deleteMany.mockImplementation(() => {
        callOrder.push('order.deleteMany');
        return Promise.resolve();
      });
      mockPrisma.paymentGroup.delete.mockImplementation(() => {
        callOrder.push('paymentGroup.delete');
        return Promise.resolve();
      });

      // Set up for a commit that will fail at PayFast.
      mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems);
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'YV-2026-TEST1',
      });
      mockPrisma.paymentGroup.create.mockResolvedValue({
        id: 'pg-1',
        mPaymentId: 'm-1',
      });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'buyer@example.com',
        firstName: 'Thandi',
        lastName: 'Dlamini',
      });
      (mockPayment.initializePayment as jest.Mock).mockRejectedValueOnce(
        new Error('PayFast down'),
      );

      await expect(
        service.commit(USER_ID, {
          addressId: ADDRESS_ID,
          returnUrl: 'r',
          cancelUrl: 'c',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(callOrder).toEqual([
        'payment.deleteMany',
        'orderItem.deleteMany',
        'order.deleteMany',
        'paymentGroup.delete',
      ]);
    });
  });

  describe('order number collision', () => {
    it('retries on collision and succeeds', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue(cartWithItems);
      mockPrisma.address.findUnique.mockResolvedValue(baseAddress);
      // First call: collision found, second call: no collision.
      mockPrisma.order.findUnique
        .mockResolvedValueOnce({ id: 'existing' }) // collision
        .mockResolvedValueOnce(null);               // no collision
      mockPrisma.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'YV-2026-TEST1',
      });
      mockPrisma.paymentGroup.create.mockResolvedValue({
        id: 'pg-1',
        mPaymentId: 'm-1',
      });
      mockPrisma.payment.create.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.user.findUnique.mockResolvedValue({
        email: 'buyer@example.com',
        firstName: 'Thandi',
        lastName: 'Dlamini',
      });

      const result = await service.commit(USER_ID, {
        addressId: ADDRESS_ID,
        returnUrl: 'r',
        cancelUrl: 'c',
      });

      expect(result.orderNumbers).toHaveLength(1);
    });
  });
});
