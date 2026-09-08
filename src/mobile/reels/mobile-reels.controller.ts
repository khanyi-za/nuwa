import { Get, Query } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { MobileReelsService } from './mobile-reels.service';
import { ReelsQueryDto } from './dto/reels-query.dto';

/**
 * GET /api/reels — public browse surface (same auth posture as the product
 * feed: guests scroll reels before signing up).
 */
@MobileController('api/reels')
export class MobileReelsController {
  constructor(private readonly service: MobileReelsService) {}

  @Public()
  @Get()
  list(@Query() query: ReelsQueryDto) {
    return this.service.list(query);
  }
}
