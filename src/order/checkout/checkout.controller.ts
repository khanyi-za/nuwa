import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CheckoutQuoteDto } from '../dto/checkout-quote.dto';
import { CheckoutCommitDto } from '../dto/checkout-commit.dto';
import { CheckoutService } from './checkout.service';

/**
 * Checkout endpoints — quote (preview) and commit (create orders + pay).
 *
 * Both routes accept either an authenticated buyer (JWT) or a guest (no JWT
 * + guest info in body). The `@Public()` decorator bypasses the global
 * JwtAuthGuard APP_GUARD; `OptionalJwtAuthGuard` tries to extract a user
 * from the JWT if present, but doesn't fail if absent.
 */
@Controller('checkout')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Req() req: any, @Body() dto: CheckoutQuoteDto) {
    const userId: string | null = req.user?.id ?? null;
    return this.checkoutService.quote(userId, dto);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  commit(@Req() req: any, @Body() dto: CheckoutCommitDto) {
    const userId: string | null = req.user?.id ?? null;
    return this.checkoutService.commit(userId, dto);
  }
}
