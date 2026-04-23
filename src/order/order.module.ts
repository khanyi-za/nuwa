import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { ProductModule } from '../product/product.module';

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
import { PaymentStubService } from './contracts/stubs/payment-stub.service';
import { ShippingStubService } from './contracts/stubs/shipping-stub.service';

/**
 * OrderModule — owns orders, cart, checkout, addresses, and (later) wishlist.
 *
 * Payments and Shipping are consumed via injection-token contracts
 * (`PAYMENT_SERVICE`, `SHIPPING_SERVICE`). Until those modules land, the
 * tokens resolve to stub services that throw `NotImplementedException`.
 * Swap the `useClass` binding when the real implementations ship; no
 * consumer code changes.
 */
@Module({
  imports: [StoreModule, ProductModule],
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
    { provide: PAYMENT_SERVICE, useClass: PaymentStubService },
  ],
  exports: [OrderService],
})
export class OrderModule {}
