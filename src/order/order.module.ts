import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { ProductModule } from '../product/product.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';

import { OrderController } from './order.controller';
import { OrderService } from './order.service';

import { AddressController } from './address/address.controller';
import { AddressService } from './address/address.service';

import { CartController } from './cart/cart.controller';
import { CartService } from './cart/cart.service';

import { CheckoutController } from './checkout/checkout.controller';
import { CheckoutService } from './checkout/checkout.service';

import { MerchantOrdersController } from './merchant-orders/merchant-orders.controller';
import { MerchantOrdersService } from './merchant-orders/merchant-orders.service';

import { BuyerOrdersController } from './buyer-orders/buyer-orders.controller';
import { BuyerOrdersService } from './buyer-orders/buyer-orders.service';

import { AdminOrdersController } from './admin-orders/admin-orders.controller';
import { AdminOrdersService } from './admin-orders/admin-orders.service';

import { OrderCleanupService } from './cron/order-cleanup.service';

import { WishlistController } from './wishlist/wishlist.controller';
import { WishlistService } from './wishlist/wishlist.service';

import { PAYMENT_SERVICE } from './contracts/payment-contract';
import { SHIPPING_SERVICE } from './contracts/shipping-contract';
import { ShippingStubService } from './contracts/stubs/shipping-stub.service';

/**
 * OrderModule — owns orders, cart, checkout, addresses, and wishlist.
 *
 * Payments and Shipping are consumed via injection-token contracts
 * (`PAYMENT_SERVICE`, `SHIPPING_SERVICE`).
 *
 * - PAYMENT_SERVICE: bound to the real `PaymentsService` (Phase 3 onward).
 *   PaymentsModule is imported so PaymentsService's deps (PayfastConfig,
 *   PayfastSignatureService, PayfastClient) resolve from PaymentsModule's
 *   exports. All three must stay exported — `useClass` constructs a fresh
 *   PaymentsService here, so every constructor dep must be visible.
 * - SHIPPING_SERVICE: still on `ShippingStubService` until Shipping module ships.
 */
@Module({
  imports: [StoreModule, ProductModule, PaymentsModule],
  controllers: [
    OrderController,
    AddressController,
    CartController,
    CheckoutController,
    MerchantOrdersController,
    BuyerOrdersController,
    AdminOrdersController,
    WishlistController,
  ],
  providers: [
    OrderService,
    AddressService,
    CartService,
    CheckoutService,
    MerchantOrdersService,
    BuyerOrdersService,
    AdminOrdersService,
    OrderCleanupService,
    WishlistService,
    { provide: SHIPPING_SERVICE, useClass: ShippingStubService },
    { provide: PAYMENT_SERVICE, useClass: PaymentsService },
  ],
  exports: [OrderService],
})
export class OrderModule {}
