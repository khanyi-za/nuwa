import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BannerMediaService } from './banner-media.service';
import { AddBannerMediaDto } from './dto/add-banner-media.dto';
import { ReorderBannerMediaDto } from './dto/reorder-banner-media.dto';

// Banner media is a sub-resource of a store — three operations:
// add, remove, reorder. List-via-GET is intentionally not exposed; the
// gallery is returned as part of GET /stores/me and the admin queue endpoints.
//
// @UseGuards(RolesGuard) is set at class level for consistency with the
// other store-module controllers (per the fix in the May 2026 session).
// The actual per-store authz happens in the service via canManageStore.
@Controller('stores/:storeId/banner-media')
@UseGuards(RolesGuard)
export class BannerMediaController {
  constructor(private readonly bannerMediaService: BannerMediaService) {}

  // POST /stores/:storeId/banner-media — append an item to the gallery
  @Post()
  add(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: AddBannerMediaDto,
  ) {
    return this.bannerMediaService.addBannerMedia(userId, storeId, dto);
  }

  // PATCH /stores/:storeId/banner-media/reorder — full-gallery reorder
  // Declared BEFORE /:id route so 'reorder' isn't matched as an ID param.
  @Patch('reorder')
  @HttpCode(200)
  reorder(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: ReorderBannerMediaDto,
  ) {
    return this.bannerMediaService.reorderBannerMedia(userId, storeId, dto);
  }

  // DELETE /stores/:storeId/banner-media/:id — remove an item
  @Delete(':id')
  @HttpCode(200)
  remove(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.bannerMediaService.removeBannerMedia(userId, storeId, id);
  }
}
