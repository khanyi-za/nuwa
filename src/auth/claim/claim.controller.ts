import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { ClaimService } from './claim.service';
import { ClaimAccountDto } from '../dto/claim-account.dto';

@Controller('auth')
@Public()
export class ClaimController {
  constructor(private readonly claimService: ClaimService) {}

  @Post('claim')
  claim(@Body() dto: ClaimAccountDto) {
    return this.claimService.claimAccount(dto);
  }
}
