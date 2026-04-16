import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PAYMENT_SERVICE } from '../contracts/payment-contract';
import type { IPaymentService } from '../contracts/payment-contract';
import { SHIPPING_SERVICE } from '../contracts/shipping-contract';
import type { IShippingService } from '../contracts/shipping-contract';

/**
 * Phase 4 — multi-brand checkout split, rate lookup (via IShippingService),
 * order creation, payment initialization (via IPaymentService), stock commit.
 * Placeholder in Phase 1; the injected contracts are currently bound to stubs.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_SERVICE) private readonly shipping: IShippingService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}
}
