import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ImageService } from './image.service';
import { AddImageDto } from '../dto/add-image.dto';
import { ReorderImagesDto } from '../dto/reorder-images.dto';

// Authz handled service-side via canManageStore + store-status check.
@Controller('stores/:storeId/products/:productId/images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Post()
  @HttpCode(201)
  addImage(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: AddImageDto,
  ) {
    return this.imageService.addImage(userId, storeId, productId, dto);
  }

  @Patch('reorder')
  @HttpCode(200)
  reorderImages(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: ReorderImagesDto,
  ) {
    return this.imageService.reorderImages(userId, storeId, productId, dto);
  }

  @Patch(':imageId/primary')
  @HttpCode(200)
  setPrimaryImage(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.imageService.setPrimaryImage(
      userId,
      storeId,
      productId,
      imageId,
    );
  }

  @Delete(':imageId')
  @HttpCode(200)
  removeImage(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.imageService.removeImage(userId, storeId, productId, imageId);
  }
}
