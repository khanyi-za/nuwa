import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CollectionService } from './collection.service';
import { CreateCollectionDto } from '../dto/create-collection.dto';
import { UpdateCollectionDto } from '../dto/update-collection.dto';

// Authz handled service-side via canManageStore + store-status check.
// GET (list) additionally allows ADMIN for any store — see service for the
// short-circuit. Mutations stay owner/employee-only.
@Controller('stores/:storeId/collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  // GET /stores/:storeId/collections — owner, active employee, OR any ADMIN.
  // Returns the store's collections ordered by sortOrder, name, with product
  // counts for the merchant editor's collection picker and the admin
  // launch-review drill-down.
  @Get()
  list(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: UserRole,
    @Param('storeId') storeId: string,
  ) {
    return this.collectionService.listForMerchant(userId, userRole, storeId);
  }

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
