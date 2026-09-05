import { Body, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileController } from '../common/mobile-controller.decorator';
import { CancelOrderDto } from '../../order/dto/cancel-order.dto';
import { MobileMerchantService } from './mobile-merchant.service';
import { MerchantSalesQueryDto } from './dto/merchant-sales-query.dto';
import { UpdateSaleStatusDto } from './dto/update-sale-status.dto';

/**
 * Mobile merchant surface — maya's "Manage my store" dashboard. Auth-required
 * (global JwtAuthGuard); the store is always resolved from the caller, so no
 * storeId appears in these routes. UI copy calls these "sales" — route and
 * identifier vocabulary stays "orders" (see sales-vocabulary convention).
 *
 * Singular `api/merchant` — the plural `api/merchants` is the buyer-facing
 * brand directory.
 */
@MobileController('api/merchant')
export class MobileMerchantController {
  constructor(private readonly merchant: MobileMerchantService) {}

  @Get('store')
  getStore(@CurrentUser('id') userId: string) {
    return this.merchant.getStore(userId);
  }

  @Get('overview')
  getOverview(@CurrentUser('id') userId: string) {
    return this.merchant.getOverview(userId);
  }

  @Get('orders')
  listOrders(
    @CurrentUser('id') userId: string,
    @Query() query: MerchantSalesQueryDto,
  ) {
    return this.merchant.listOrders(userId, query);
  }

  @Get('orders/:orderId')
  getOrder(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.merchant.getOrderDetail(userId, orderId);
  }

  @Post('orders/:orderId/status')
  @HttpCode(200)
  updateStatus(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateSaleStatusDto,
  ) {
    return this.merchant.updateStatus(userId, orderId, dto);
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(200)
  cancelOrder(
    @CurrentUser('id') userId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.merchant.cancelOrder(userId, orderId, dto);
  }

  @Get('low-stock')
  getLowStock(@CurrentUser('id') userId: string) {
    return this.merchant.getLowStock(userId);
  }
}
