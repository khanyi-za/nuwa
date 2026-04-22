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
  Req,
} from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { MerchantOrdersService } from './merchant-orders.service';
import { MerchantOrderQueryDto } from '../dto/merchant-order-query.dto';
import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';
import { CancelOrderDto } from '../dto/cancel-order.dto';

@Controller('stores/:storeId/orders')
@Roles(UserRole.MERCHANT)
export class MerchantOrdersController {
  constructor(private readonly merchantOrders: MerchantOrdersService) {}

  @Get()
  list(
    @Req() req: any,
    @Param('storeId') storeId: string,
    @Query() query: MerchantOrderQueryDto,
  ) {
    return this.merchantOrders.listOrders(req.user.id, storeId, query);
  }

  @Get(':orderId')
  detail(
    @Req() req: any,
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.merchantOrders.getOrderDetail(req.user.id, storeId, orderId);
  }

  @Patch(':orderId/status')
  updateStatus(
    @Req() req: any,
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.merchantOrders.updateStatus(
      req.user.id,
      storeId,
      orderId,
      dto.status,
    );
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Req() req: any,
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.merchantOrders.cancelOrder(req.user.id, storeId, orderId, dto);
  }
}
