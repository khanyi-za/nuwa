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
    // WishlistController — added in Phase 9
  ],
  providers: [
    OrderService,
    AddressService,
    CartService,
    CheckoutService,
    { provide: SHIPPING_SERVICE, useClass: ShippingStubService },
    { provide: PAYMENT_SERVICE, useClass: PaymentStubService },
  ],
  exports: [OrderService],
})
export class OrderModule {}
