import { Controller } from '@nestjs/common';
import { CartService } from './cart.service';

/** Phase 3 — cart endpoints. Placeholder. */
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}
}
