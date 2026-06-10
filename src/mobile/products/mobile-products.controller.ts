import {
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileProductsService } from './mobile-products.service';
import { MobileSocialService } from '../social/mobile-social.service';
import { FeedQueryDto } from './dto/feed-query.dto';
import { NewArrivalsQueryDto } from './dto/new-arrivals-query.dto';
import { SimilarQueryDto } from './dto/similar-query.dto';

@MobileController('api/products')
export class MobileProductsController {
  constructor(
    private readonly service: MobileProductsService,
    private readonly social: MobileSocialService,
  ) {}

  // Auth: optional — personalised fields included when a token is present.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('feed')
  feed(@Query() dto: FeedQueryDto, @CurrentUser('id') userId?: string) {
    return this.service.feed(dto, userId);
  }

  // Auth: optional (no personalised fields consumed by the carousel).
  @Public()
  @Get('new-arrivals')
  newArrivals(@Query() dto: NewArrivalsQueryDto) {
    return this.service.newArrivals(dto);
  }

  // Declared after the literal routes above so they don't shadow :productId.
  @Public()
  @Get(':productId/similar')
  similar(
    @Param('productId') productId: string,
    @Query() dto: SimilarQueryDto,
  ) {
    return this.service.similar(productId, dto.limit ?? 6);
  }

  // Auth: optional — personalised fields included when a token is present.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':productId')
  detail(
    @Param('productId') productId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.service.detail(productId, userId);
  }

  // Auth: optional. Fire-and-forget analytics (Phalo consumes later).
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':productId/view')
  @HttpCode(200)
  view(
    @Param('productId') productId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.service.recordView(productId, userId);
  }

  // Auth: required. Idempotent bookmark (= wishlist) toggle.
  @Put(':productId/bookmark')
  bookmark(
    @Param('productId') productId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.social.setBookmark(userId, productId, true);
  }

  @Delete(':productId/bookmark')
  unbookmark(
    @Param('productId') productId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.social.setBookmark(userId, productId, false);
  }
}
