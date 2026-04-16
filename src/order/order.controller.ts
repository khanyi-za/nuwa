import { Controller } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Merchant + admin order endpoints (placeholder).
 *
 * Populated in Phase 5 (merchant order management) and Phase 7 (admin views).
 * Registered here so the module can be imported in app.module.ts from Phase 1.
 */
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}
}
