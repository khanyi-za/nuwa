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
import { MobileMerchantsService } from './mobile-merchants.service';
import { MobileProductsService } from '../products/mobile-products.service';
import { MobileSocialService } from '../social/mobile-social.service';
import { TrendingQueryDto } from './dto/trending-query.dto';
import { MerchantProductsQueryDto } from './dto/merchant-products-query.dto';
import { MerchantDirectoryQueryDto } from './dto/merchant-directory-query.dto';

@MobileController('api/merchants')
export class MobileMerchantsController {
  constructor(
    private readonly service: MobileMerchantsService,
    private readonly products: MobileProductsService,
    private readonly social: MobileSocialService,
  ) {}

  // Auth: optional. A–Z brand directory (Shop tab). Bare /api/merchants.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  directory(
    @Query() dto: MerchantDirectoryQueryDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.service.directory(
      {
        genderType: dto.genderType,
        letter: dto.letter,
        sort: dto.sort,
        cursor: dto.cursor,
        limit: dto.limit ?? 100,
      },
      userId,
    );
  }

  // Auth: optional — returns isFollowedByMe when a token is present.
  // Declared before :username so the literal route isn't shadowed.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('trending')
  trending(@Query() dto: TrendingQueryDto, @CurrentUser('id') userId?: string) {
    return this.service.trending({
      genderType: dto.genderType,
      limit: dto.limit ?? 10,
      userId,
    });
  }

  // Auth: optional. `username` = Store slug.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':username/products')
  products_(
    @Param('username') username: string,
    @Query() dto: MerchantProductsQueryDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.products.merchantProducts(
      username,
      {
        clothingType: dto.clothingType,
        cursor: dto.cursor,
        limit: dto.limit ?? 20,
      },
      userId,
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':username')
  profile(
    @Param('username') username: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.service.getProfile(username, userId);
  }

  // Auth: optional. Fire-and-forget analytics. merchantId = Store id.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':merchantId/view')
  @HttpCode(200)
  view(
    @Param('merchantId') merchantId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.service.recordView(merchantId, userId);
  }

  // Auth: required. Idempotent follow (= StoreFollower). merchantId is Store id.
  @Put(':merchantId/follow')
  follow(
    @Param('merchantId') merchantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.social.setFollow(userId, merchantId, true);
  }

  @Delete(':merchantId/follow')
  unfollow(
    @Param('merchantId') merchantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.social.setFollow(userId, merchantId, false);
  }
}
