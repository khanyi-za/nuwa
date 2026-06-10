import { Body, HttpCode, Post } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileCheckoutService } from './mobile-checkout.service';
import { QuoteDto } from './dto/quote.dto';

// Auth-required (uses the authenticated buyer's server cart).
@MobileController('api/checkout')
export class MobileCheckoutController {
  constructor(private readonly service: MobileCheckoutService) {}

  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: QuoteDto, @CurrentUser('id') userId: string) {
    return this.service.quote(userId, dto);
  }
}
