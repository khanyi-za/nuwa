import { Body, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileOrdersService } from './mobile-orders.service';
import { OrdersQueryDto } from './dto/orders-query.dto';
import { PlaceOrderDto } from './dto/place-order.dto';

// Auth-required (v1 — guest checkout deferred).
@MobileController('api/orders')
export class MobileOrdersController {
  constructor(private readonly service: MobileOrdersService) {}

  @Get()
  list(@Query() dto: OrdersQueryDto, @CurrentUser('id') userId: string) {
    return this.service.listOrders(userId, {
      limit: dto.limit ?? 20,
      cursor: dto.cursor,
    });
  }

  @Post()
  @HttpCode(200)
  placeOrder(@Body() dto: PlaceOrderDto, @CurrentUser('id') userId: string) {
    return this.service.placeOrder(userId, dto);
  }

  @Get(':orderId')
  getOrder(
    @Param('orderId') orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.getOrder(userId, orderId);
  }

  @Get(':orderId/preview')
  preview(
    @Param('orderId') orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.getOrderPreview(userId, orderId);
  }

  @Get(':orderId/tracking')
  tracking(
    @Param('orderId') orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.getTracking(userId, orderId);
  }

  @Post(':orderId/cancel')
  @HttpCode(200)
  cancel(
    @Param('orderId') orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.cancelOrder(userId, orderId);
  }
}
