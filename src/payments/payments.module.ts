import { Module } from '@nestjs/common';
import { PayfastConfig } from './payfast/payfast-config';
import { PayfastSignatureService } from './payfast/payfast-signature.service';
import { PayfastClient } from './payfast/payfast-client.service';
import { PayfastIpAllowlistService } from './payfast/payfast-ip-allowlist.service';
import { PaymentsController } from './payments.controller';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsNotifyService } from './payments-notify.service';
import { PaymentsReconcileService } from './payments-reconcile.service';

/**
 * PaymentsModule — owns the real PayFast integration.
 *
 * Phase 1 — PayfastConfig (boot-time env validation)
 * Phase 2 — PayfastSignatureService (form/API signing, ITN verification)
 * Phase 3 — PaymentsService bound to PAYMENT_SERVICE in OrderModule via useClass
 * Phase 4 — PayfastClient + PayfastIpAllowlistService + PaymentsNotifyService
 *           + PaymentsController (POST /payments/notify webhook)
 * Phase 5 — Refund API on PaymentsService + PayfastClient.createRefund;
 *           refund-ITN handling in PaymentsNotifyService
 * Phase 6 — PaymentsAdminController + PaymentsReconcileService
 *           (GET /admin/payments/groups/:id/reconcile)
 */
@Module({
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [
    PayfastConfig,
    PayfastSignatureService,
    PayfastClient,
    PayfastIpAllowlistService,
    PaymentsNotifyService,
    PaymentsReconcileService,
  ],
  exports: [PayfastConfig, PayfastSignatureService],
})
export class PaymentsModule {}
