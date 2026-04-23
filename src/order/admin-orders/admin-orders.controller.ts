import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrderQueryDto } from '../dto/admin-order-query.dto';
import { AdminCancelOrderDto } from '../dto/admin-cancel-order.dto';
import { AdminEditOrderDto } from '../dto/admin-edit-order.dto';

@Controller('admin/orders')
@Roles(UserRole.ADMIN)
export class AdminOrdersController {
  constructor(private readonly adminOrders: AdminOrdersService) {}

  @Get()
  list(@Query() query: AdminOrderQueryDto) {
    return this.adminOrders.listOrders(query);
  }

  @Get(':orderId')
  detail(@Param('orderId') orderId: string) {
    return this.adminOrders.getOrderDetail(orderId);
  }

  @Patch(':orderId')
  edit(
    @Param('orderId') orderId: string,
    @Body() dto: AdminEditOrderDto,
  ) {
    return this.adminOrders.editOrder(orderId, dto);
  }

  @Post(':orderId/confirm')
  @HttpCode(HttpStatus.OK)
  forceConfirm(@Param('orderId') orderId: string) {
    return this.adminOrders.forceConfirm(orderId);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('orderId') orderId: string,
    @Body() dto: AdminCancelOrderDto,
  ) {
    return this.adminOrders.cancelOrder(orderId, dto);
  }

  @Post(':orderId/refund')
  @HttpCode(HttpStatus.OK)
  requestRefund(@Param('orderId') orderId: string) {
    return this.adminOrders.requestRefund(orderId);
  }
}
