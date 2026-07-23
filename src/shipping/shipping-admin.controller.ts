import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ShipmentTrackingReconcileService,
  TrackingReconcileSummary,
} from './shipment-tracking-reconcile.service';

/**
 * Admin shipping ops. POST /admin/shipping/reconcile-tracking runs the
 * tracking-reconcile sweep on demand — the same job the cron runs at :10/:40
 * — and returns its summary. Built for the production webhook smoke test
 * ("did we miss events?" answerable without waiting for the cron) and for
 * ops triage after a suspected webhook outage.
 */
@Controller('admin/shipping')
@Roles(UserRole.ADMIN)
export class ShippingAdminController {
  constructor(
    private readonly reconcile: ShipmentTrackingReconcileService,
  ) {}

  @Post('reconcile-tracking')
  @HttpCode(HttpStatus.OK)
  reconcileTracking(): Promise<TrackingReconcileSummary> {
    return this.reconcile.reconcileTracking();
  }
}
