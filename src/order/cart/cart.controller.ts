import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AddCartItemDto } from '../dto/add-cart-item.dto';
import { UpdateCartItemDto } from '../dto/update-cart-item.dto';
import { CartService } from './cart.service';

/**
 * Buyer cart endpoints. JWT auth is applied globally via `JwtAuthGuard`.
 * Any authenticated user can use the cart — MERCHANT-role users who also
 * shop on the mobile app are first-class buyers here (the role gate was
 * dropped on 2026-06-01 to support that).
 *
 * Anonymous carts are not persisted server-side — the frontend stashes
 * items in `localStorage` until login and replays them via `POST /items`
 * (Phase 3 decision #11).
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  get(@CurrentUser('id') userId: string) {
    return this.cartService.get(userId);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  addItem(
    @CurrentUser('id') userId: string,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(userId, dto);
  }

  @Patch('items/:itemId')
  updateItem(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(userId, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(HttpStatus.OK)
  removeItem(
    @CurrentUser('id') userId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.cartService.removeItem(userId, itemId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  clear(@CurrentUser('id') userId: string) {
    return this.cartService.clear(userId);
  }
}
