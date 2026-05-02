import { Controller, Get, Param } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsReconcileService } from './payments-reconcile.service';

/**
 * Admin-only payments tooling. Phase 6: a single read-only reconciliation
 * endpoint for investigating stuck PaymentGroups. No mutations.
 *
 * Future phases may add: aggregate reports, force-reconcile actions,
 * manual refund initiation by ops.
 */
@Controller('admin/payments')
@Roles(UserRole.ADMIN)
export class PaymentsAdminController {
  constructor(
    private readonly reconcileService: PaymentsReconcileService,
  ) {}

  /**
   * GET /admin/payments/groups/:id/reconcile
   *
   * Cross-check a PaymentGroup against PayFast's transactions/history and
   * return a structured verdict. Read-only — does not mutate any state.
   */
  @Get('groups/:id/reconcile')
  reconcile(@Param('id') id: string) {
    return this.reconcileService.reconcile(id);
  }
}
