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
import { CollectionService } from './collection.service';
import { CreateCollectionDto } from '../dto/create-collection.dto';
import { UpdateCollectionDto } from '../dto/update-collection.dto';

// Authz handled service-side via canManageStore + store-status check.
@Controller('stores/:storeId/collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateCollectionDto,
  ) {
    return this.collectionService.create(userId, storeId, dto);
  }

  @Patch(':collectionId')
  @HttpCode(200)
  update(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('collectionId') collectionId: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collectionService.update(userId, storeId, collectionId, dto);
  }

  @Delete(':collectionId')
  @HttpCode(200)
  delete(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('collectionId') collectionId: string,
  ) {
    return this.collectionService.delete(userId, storeId, collectionId);
  }

  @Post(':collectionId/products/:productId')
  @HttpCode(200)
  addProduct(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionService.addProduct(
      userId,
      storeId,
      collectionId,
      productId,
    );
  }

  @Delete(':collectionId/products/:productId')
  @HttpCode(200)
  removeProduct(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('collectionId') collectionId: string,
    @Param('productId') productId: string,
  ) {
    return this.collectionService.removeProduct(
      userId,
      storeId,
      collectionId,
      productId,
    );
  }
}
