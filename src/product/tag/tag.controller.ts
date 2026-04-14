import {
  Body,
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
import { TagService } from './tag.service';
import { AddTagDto } from '../dto/add-tag.dto';

@UseGuards(RolesGuard)
@Roles(UserRole.MERCHANT)
@Controller('stores/:storeId/products/:productId/tags')
export class TagController {
  constructor(private readonly tagService: TagService) {}

  @Post()
  @HttpCode(200)
  addTag(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: AddTagDto,
  ) {
    return this.tagService.addTag(userId, storeId, productId, dto);
  }

  @Delete(':tagId')
  @HttpCode(200)
  removeTag(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('tagId') tagId: string,
  ) {
    return this.tagService.removeTag(userId, storeId, productId, tagId);
  }
}
