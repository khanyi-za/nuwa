import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { TagService } from './tag.service';
import { AddTagDto } from '../dto/add-tag.dto';

// Authz handled service-side via canManageStore + store-status check.
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
