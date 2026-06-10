import {
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileCartService } from './mobile-cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@MobileController('api/cart')
export class MobileCartController {
  constructor(private readonly service: MobileCartService) {}

  // Auth: optional. Guests get an empty summary (no server cart yet).
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('summary')
  summary(@CurrentUser('id') userId?: string) {
    return this.service.summary(userId);
  }

  // Auth: optional. Guests get the empty cart shape.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  getCart(@CurrentUser('id') userId?: string) {
    return this.service.getCart(userId);
  }

  // Auth: required (v1). Guests get 401 → maya opens its login modal.
  @Post('items')
  @HttpCode(200)
  addItem(@Body() dto: AddCartItemDto, @CurrentUser('id') userId: string) {
    return this.service.addItem(userId, dto);
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.updateItem(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  removeItem(
    @Param('itemId') itemId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.removeItem(userId, itemId);
  }

  @Delete()
  clear(@CurrentUser('id') userId: string) {
    return this.service.clear(userId);
  }
}
