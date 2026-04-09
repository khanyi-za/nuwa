import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { StoreService } from './store.service';

// These two endpoints are intentionally NOT nested under /stores/:storeId because
// the recipient only has a token at this point — they don't know the store ID yet.
@Controller('employees/invites')
export class EmployeeInviteController {
  constructor(private readonly storeService: StoreService) {}

  // GET /employees/invites/validate?token=xxx
  // Public — the token IS the authentication at this stage.
  // Returns store branding info so the frontend can show a meaningful accept screen.
  @Public()
  @Get('validate')
  validateInvite(@Query('token') token: string) {
    return this.storeService.validateInvite(token);
  }

  // POST /employees/invites/accept
  // Requires authentication — the recipient must be logged in (or freshly registered)
  // before they can link their account to the invite.
  @Post('accept')
  acceptInvite(@CurrentUser('id') userId: string, @Body() dto: AcceptInviteDto) {
    return this.storeService.acceptInvite(userId, dto);
  }
}
