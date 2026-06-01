import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { WishlistService } from './wishlist.service';

// JWT auth is global; any authenticated user can save products. The
// previous `@Roles(BUYER)` decorator was a no-op (no RolesGuard wired)
// and was removed for clarity on 2026-06-01.
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.wishlist.list(req.user.id, cursor, take);
  }

  @Post(':productId')
  @HttpCode(HttpStatus.CREATED)
  add(@Req() req: any, @Param('productId') productId: string) {
    return this.wishlist.add(req.user.id, productId);
  }

  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: any, @Param('itemId') itemId: string) {
    await this.wishlist.remove(req.user.id, itemId);
  }
}
