import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { CategoryLinkService } from './category-link.service';

@UseGuards(RolesGuard)
@Roles(UserRole.MERCHANT)
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
