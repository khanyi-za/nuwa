import { Body, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileProductsService } from '../products/mobile-products.service';
import { MobileSearchService } from './mobile-search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { CategorySearchDto } from './dto/category-search.dto';
import { SmartCategorySearchDto } from './dto/smart-category-search.dto';
import { MerchantSearchDto } from './dto/merchant-search.dto';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto';
import { TrackSearchDto } from './dto/track-search.dto';

// Search reuses MobileProductsService's shared feed-grid query for §1-§4 (same
// card shape); MobileSearchService owns suggestions + track. Auth optional
// (personalised fields when present), except suggestions (none).
@MobileController('api/search')
export class MobileSearchController {
  constructor(
    private readonly products: MobileProductsService,
    private readonly search: MobileSearchService,
  ) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  universal(@Query() dto: SearchQueryDto, @CurrentUser('id') userId?: string) {
    return this.products.searchUniversal(
      {
        q: dto.q,
        genderType: dto.genderType,
        category: dto.category,
        cursor: dto.cursor,
        limit: dto.limit ?? 20,
      },
      userId,
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('category')
  category(@Query() dto: CategorySearchDto, @CurrentUser('id') userId?: string) {
    return this.products.searchByCategory(
      {
        category: dto.category,
        genderType: dto.genderType,
        cursor: dto.cursor,
        limit: dto.limit ?? 20,
      },
      userId,
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('smart-category')
  smartCategory(
    @Query() dto: SmartCategorySearchDto,
    @CurrentUser('id') userId?: string,
  ) {
    return this.products.searchBySmartCategory(
      {
        smartCategory: dto.smartCategory,
        genderType: dto.genderType,
        cursor: dto.cursor,
        limit: dto.limit ?? 20,
      },
      userId,
    );
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('merchant')
  merchant(@Query() dto: MerchantSearchDto, @CurrentUser('id') userId?: string) {
    return this.products.searchByMerchant(
      {
        merchantName: dto.merchantName,
        genderType: dto.genderType,
        cursor: dto.cursor,
        limit: dto.limit ?? 20,
      },
      userId,
    );
  }

  // Auth: none.
  @Public()
  @Get('suggestions')
  suggestions(@Query() dto: SuggestionsQueryDto) {
    return this.search.suggestions(dto);
  }

  // Auth: optional. Fire-and-forget analytics.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('track')
  @HttpCode(200)
  track(@Body() dto: TrackSearchDto, @CurrentUser('id') userId?: string) {
    return this.search.track(dto, userId);
  }
}
