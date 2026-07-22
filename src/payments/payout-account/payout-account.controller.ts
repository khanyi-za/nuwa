import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PayoutAccountService } from './payout-account.service';
import { SetPayoutAccountDto } from './dto/set-payout-account.dto';

/**
 * Merchant settlement-account endpoints (Paystack split payouts, Phase 6).
 * Same surface style as dispatch addresses: nested under the store, JWT via
 * the global guard, canManageStore inside the service (404-not-403).
 *
 *   GET  /stores/:storeId/payout-account        — current status (configured, bank, last4)
 *   POST /stores/:storeId/payout-account        — create/update from bank details
 *   GET  /stores/:storeId/payout-account/banks  — SA bank list for the form
 */
@Controller('stores/:storeId/payout-account')
export class PayoutAccountController {
  constructor(private readonly service: PayoutAccountService) {}

  @Get()
  get(@CurrentUser('id') userId: string, @Param('storeId') storeId: string) {
    return this.service.get(userId, storeId);
  }

  @Post()
  set(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: SetPayoutAccountDto,
  ) {
    return this.service.set(userId, storeId, dto);
  }

  @Get('banks')
  banks() {
    return this.service.listBanks();
  }
}
