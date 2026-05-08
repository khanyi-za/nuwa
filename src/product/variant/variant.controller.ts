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
import { VariantService } from './variant.service';
import { CreateVariantDto } from '../dto/create-variant.dto';
import { UpdateVariantDto } from '../dto/update-variant.dto';

// Authz handled service-side via canManageStore + store-status check.
@Controller('stores/:storeId/products/:productId/variants')
export class VariantController {
  constructor(private readonly variantService: VariantService) {}

  @Post()
  @HttpCode(201)
  createVariant(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.variantService.createVariant(userId, storeId, productId, dto);
  }

  @Patch(':variantId')
  @HttpCode(200)
  updateVariant(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variantService.updateVariant(
      userId,
      storeId,
      productId,
      variantId,
      dto,
    );
  }

  @Delete(':variantId')
  @HttpCode(200)
  deleteVariant(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.variantService.deleteVariant(
      userId,
      storeId,
      productId,
      variantId,
    );
  }
}
