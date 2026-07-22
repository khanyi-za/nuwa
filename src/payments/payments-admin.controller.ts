import { Controller, Get, Param } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaystackReconcileService } from './paystack-reconcile.service';

/**
 * Admin-only payments tooling: a read-only reconciliation endpoint for
 * investigating stuck PaymentGroups against Paystack's records
 * (GET /transaction/verify by our reference). No mutations.
 */
@Controller('admin/payments')
@Roles(UserRole.ADMIN)
export class PaymentsAdminController {
  constructor(private readonly reconcileService: PaystackReconcileService) {}

  /**
   * GET /admin/payments/groups/:id/reconcile
   *
   * Cross-check a PaymentGroup against Paystack and return a structured
   * verdict (MATCH / MISMATCH / NOT_FOUND / MATCH_PENDING).
   */
  @Get('groups/:id/reconcile')
  reconcile(@Param('id') id: string) {
    return this.reconcileService.reconcile(id);
  }
}
