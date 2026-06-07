import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { SHIPPING_SERVICE } from '../order/contracts/shipping-contract';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import { ShipLogicClient } from './shiplogic/shiplogic-client.service';
import { DispatchAddressController } from './dispatch-address/dispatch-address.controller';
import { DispatchAddressService } from './dispatch-address/dispatch-address.service';
import { ShippingService } from './shipping.service';
import { ShipmentCreationService } from './shipment-creation.service';
import { ShipmentCancellationService } from './shipment-cancellation.service';
import { ShipmentLabelService } from './shipment-label.service';
import { ShipmentLabelController } from './shipment-label.controller';
import { ShippingWebhookService } from './shipping-webhook.service';
import { ShippingWebhookController } from './shipping-webhook.controller';

/**
 * ShippingModule — Phase 6 complete; module feature-complete for v1.
 *
 * Phases (per `docs/shipping-module/shipping-module-foundation.md` §15):
 *   1. Foundation — module scaffold, env config, ShipLogicClient                 ✓
 *   2. Schema deltas (Address.suburb, ShipmentEvent table)                       ✓
 *   3. Dispatch addresses CRUD                                                   ✓
 *   4. Real rate quotes — bind SHIPPING_SERVICE to real ShippingService          ✓
 *   5. Shipment creation on Order.CONFIRMED + label download + cancel propagate  ✓
 *   6. Tracking webhook + status mapping                                         ✓
 *
 * StoreModule is imported so DispatchAddressService + ShipmentLabelService can
 * use StoreService.canManageStore for owner-or-employee authz.
 *
 * Exports:
 *   - SHIPPING_SERVICE token (real ShippingService) — consumed by OrderModule.
 *   - ShipmentCreationService — consumed by PaymentsModule (post-ITN hook).
 *   - ShipmentCancellationService — consumed by OrderModule (buyer-cancel hook).
 */
@Module({
  imports: [StoreModule],
  controllers: [
    DispatchAddressController,
    ShipmentLabelController,
    ShippingWebhookController,
  ],
  providers: [
    ShipLogicConfig,
    ShipLogicClient,
    DispatchAddressService,
    ShippingService,
    ShipmentCreationService,
    ShipmentCancellationService,
    ShipmentLabelService,
    ShippingWebhookService,
    { provide: SHIPPING_SERVICE, useExisting: ShippingService },
  ],
  exports: [
    ShipLogicConfig,
    ShipLogicClient,
    SHIPPING_SERVICE,
    ShipmentCreationService,
    ShipmentCancellationService,
  ],
})
export class ShippingModule {}
