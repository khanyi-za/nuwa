import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('stores/:storeId/products')
@UseGuards(RolesGuard)
@Roles(UserRole.MERCHANT)
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  listProducts(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Query() query: ListProductsDto,
  ) {
    return this.productService.listProducts(userId, storeId, query);
  }

  @Get(':id')
  getProduct(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') productId: string,
  ) {
    return this.productService.getProduct(userId, storeId, productId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productService.create(userId, storeId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productService.update(userId, storeId, productId, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') productId: string,
  ) {
    return this.productService.activate(userId, storeId, productId);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') productId: string,
  ) {
    return this.productService.archive(userId, storeId, productId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') productId: string,
  ) {
    return this.productService.delete(userId, storeId, productId);
  }
}
