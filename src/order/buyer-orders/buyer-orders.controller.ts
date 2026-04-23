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
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { BuyerOrdersService } from './buyer-orders.service';
import { BuyerOrderQueryDto } from '../dto/buyer-order-query.dto';
import { BuyerCancelOrderDto } from '../dto/buyer-cancel-order.dto';

@Controller('orders')
@Roles(UserRole.BUYER)
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
