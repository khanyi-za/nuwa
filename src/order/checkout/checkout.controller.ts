import { Controller } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

/** Phase 4 — checkout endpoints. Placeholder. */
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}
}
