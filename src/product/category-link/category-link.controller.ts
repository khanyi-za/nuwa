import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CategoryLinkService } from './category-link.service';

// Authz handled service-side via canManageStore + store-status check.
@Controller('stores/:storeId/products/:productId/categories')
export class CategoryLinkController {
  constructor(private readonly categoryLinkService: CategoryLinkService) {}

  @Post(':categoryId')
  @HttpCode(200)
  linkCategory(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoryLinkService.linkCategory(
      userId,
      storeId,
      productId,
      categoryId,
    );
  }

  @Delete(':categoryId')
  @HttpCode(200)
  unlinkCategory(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.categoryLinkService.unlinkCategory(
      userId,
      storeId,
      productId,
      categoryId,
    );
  }
}
