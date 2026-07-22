import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { ProductModule } from '../product/product.module';
import { PaymentsModule } from '../payments/payments.module';
import { PaystackService } from '../payments/paystack.service';
import { ShippingModule } from '../shipping/shipping.module';

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

import { MerchantReturnsController } from './returns/merchant-returns.controller';
import { ReturnsService } from './returns/returns.service';

import { PAYMENT_SERVICE } from './contracts/payment-contract';

/**
 * OrderModule — owns orders, cart, checkout, addresses, and wishlist.
 *
 * Payments and Shipping are consumed via injection-token contracts
 * (`PAYMENT_SERVICE`, `SHIPPING_SERVICE`).
 *
 * - PAYMENT_SERVICE: bound to `PaystackService` (Paystack migration Phase 5
 *   cutover switch — docs/payments-module/paystack-migration-foundation.md).
 *   PaymentsModule is imported so PaystackService's deps (PaystackConfig,
 *   PaystackClient) resolve from PaymentsModule's exports — `useClass`
 *   constructs the service here, so every constructor dep must be visible.
 *   PayFast predecessor deleted at migration Phase 5 (2026-07-21).
 * - SHIPPING_SERVICE: bound to the real `ShippingService` (shipping-module
 *   Phase 4). ShippingModule is imported and exports the token; OrderModule
 *   gets the real implementation by importing the module.
 */
@Module({
  imports: [StoreModule, ProductModule, PaymentsModule, ShippingModule],
  controllers: [
    OrderController,
    AddressController,
    CartController,
    CheckoutController,
    MerchantOrdersController,
    BuyerOrdersController,
    AdminOrdersController,
    WishlistController,
    MerchantReturnsController,
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
    ReturnsService,
    { provide: PAYMENT_SERVICE, useClass: PaystackService },
  ],
  // AddressService + CheckoutService + BuyerOrdersService + ReturnsService are
  // exported for reuse by the mobile/buyer API surface (MobileModule). The web
  // routes that own them are unaffected.
  exports: [
    OrderService,
    AddressService,
    CheckoutService,
    BuyerOrdersService,
    ReturnsService,
  ],
})
export class OrderModule {}
