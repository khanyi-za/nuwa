import { Module } from '@nestjs/common';
import { PaystackConfig } from './paystack/paystack-config';
import { PaystackClient } from './paystack/paystack-client.service';
import { PaystackService } from './paystack.service';
import { PaystackWebhookService } from './paystack-webhook.service';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { PaystackReconcileService } from './paystack-reconcile.service';
import { PaymentsAdminController } from './payments-admin.controller';
import { PayoutAccountController } from './payout-account/payout-account.controller';
import { PayoutAccountService } from './payout-account/payout-account.service';
import { ShippingModule } from '../shipping/shipping.module';
import { StoreModule } from '../store/store.module';

/**
 * PaymentsModule — owns the Paystack integration (the platform's payment
 * provider; replaced PayFast 2026-07 — decision record + phase history in
 * docs/payments-module/paystack-migration-foundation.md).
 *
 * - PaystackConfig     — boot-time env validation (secret key → mode)
 * - PaystackClient     — typed REST client (initialize / verify / refund)
 * - PaystackService    — IPaymentService implementation; bound to
 *                        PAYMENT_SERVICE in OrderModule via useClass, so
 *                        every constructor dep must stay exported here
 * - PaystackWebhookService/-Controller — POST /payments/webhook: HMAC-SHA512
 *                        verify → PaymentEvent idempotency → CAS transitions
 * - PaystackReconcileService — read-only stuck-payment investigation
 *                        (GET /admin/payments/groups/:id/reconcile)
 *
 * ShippingModule provides ShipmentCreationService for the post-payment
 * shipment-booking side effect (fired OUTSIDE the webhook's DB transaction).
 */
@Module({
  // StoreModule provides canManageStore for the payout-account surface
  // (same import pattern as ShippingModule's dispatch addresses).
  imports: [ShippingModule, StoreModule],
  controllers: [
    PaystackWebhookController,
    PaymentsAdminController,
    PayoutAccountController,
  ],
  providers: [
    PaystackConfig,
    PaystackClient,
    PaystackService,
    PaystackWebhookService,
    PaystackReconcileService,
    PayoutAccountService,
  ],
  exports: [PaystackConfig, PaystackClient, PaystackService],
})
export class PaymentsModule {}
