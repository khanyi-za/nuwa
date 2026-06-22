import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { MobileCategoriesController } from './categories/mobile-categories.controller';
import { MobileCategoriesService } from './categories/mobile-categories.service';
import { MobileProductsController } from './products/mobile-products.controller';
import { MobileProductsService } from './products/mobile-products.service';
import { MobileMerchantsController } from './merchants/mobile-merchants.controller';
import { MobileMerchantsService } from './merchants/mobile-merchants.service';
import { MobileCartController } from './cart/mobile-cart.controller';
import { MobileCartService } from './cart/mobile-cart.service';
import { MobileSocialService } from './social/mobile-social.service';
import { MobileMeController } from './social/mobile-me.controller';
import { MobileAddressesController } from './addresses/mobile-addresses.controller';
import { MobileAddressesService } from './addresses/mobile-addresses.service';
import { MobileCheckoutController } from './checkout/mobile-checkout.controller';
import { MobileCheckoutService } from './checkout/mobile-checkout.service';
import { MobileOrdersController } from './orders/mobile-orders.controller';
import { MobileOrdersService } from './orders/mobile-orders.service';
import { MobileSearchController } from './search/mobile-search.controller';
import { MobileSearchService } from './search/mobile-search.service';
import { MobileNotificationsController } from './notifications/mobile-notifications.controller';
import { MobileNotificationsService } from './notifications/mobile-notifications.service';

/**
 * Buyer/mobile API surface (maya, Expo/RN). All routes are under the `/api`
 * prefix and wrapped in the maya response envelope via the per-controller
 * `MobileController` decorator. Never reshapes the existing web/admin/merchant
 * routes. See mobile-buyer-api-architecture memory.
 *
 * Imports OrderModule to reuse the delicate, tested AddressService +
 * CheckoutService (Screen 04). Those services' web routes are unaffected.
 *
 * Screens covered: 01 Home, 02 Product Detail, 03 Cart, 04 Checkout,
 * 05 Order Success, 06 Track Order, 07 Search.
 */
@Module({
  imports: [OrderModule],
  controllers: [
    MobileCategoriesController,
    MobileProductsController,
    MobileMerchantsController,
    MobileCartController,
    MobileAddressesController,
    MobileCheckoutController,
    MobileOrdersController,
    MobileSearchController,
    MobileMeController,
    MobileNotificationsController,
  ],
  providers: [
    MobileCategoriesService,
    MobileProductsService,
    MobileMerchantsService,
    MobileCartService,
    MobileSocialService,
    MobileAddressesService,
    MobileCheckoutService,
    MobileOrdersService,
    MobileSearchService,
    MobileNotificationsService,
  ],
})
export class MobileModule {}
