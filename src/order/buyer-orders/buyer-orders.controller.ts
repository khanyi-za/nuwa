import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { BuyerOrdersService } from './buyer-orders.service';
import { BuyerOrderQueryDto } from '../dto/buyer-order-query.dto';
import { BuyerCancelOrderDto } from '../dto/buyer-cancel-order.dto';

// JWT auth is global. The previous `@Roles(BUYER)` decorator was a no-op
// (no RolesGuard wired) and was removed for clarity on 2026-06-01. Any
// authenticated user can view their own orders — ownership is enforced
// service-side via the userId match.
@Controller('orders')
export class BuyerOrdersController {
  constructor(private readonly buyerOrders: BuyerOrdersService) {}

  @Get()
  list(@Req() req: any, @Query() query: BuyerOrderQueryDto) {
    return this.buyerOrders.listOrders(req.user.id, query);
  }

  @Get(':orderId')
  detail(@Req() req: any, @Param('orderId') orderId: string) {
    return this.buyerOrders.getOrderDetail(req.user.id, orderId);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @Body() dto: BuyerCancelOrderDto,
  ) {
    return this.buyerOrders.cancelOrder(req.user.id, orderId, dto);
  }
}
