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
import { CreateDispatchAddressDto } from './dto/create-dispatch-address.dto';
import { UpdateDispatchAddressDto } from './dto/update-dispatch-address.dto';
import { DispatchAddressService } from './dispatch-address.service';

/**
 * Merchant dispatch-address CRUD. JWT auth is global; authz is service-side
 * via `canManageStore` (owner OR active accepted employee).
 *
 * Mounted at `/stores/:storeId/dispatch-addresses`.
 */
@Controller('stores/:storeId/dispatch-addresses')
export class DispatchAddressController {
  constructor(private readonly service: DispatchAddressService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.service.list(userId, storeId);
  }

  @Get(':id')
  getById(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.service.getById(userId, storeId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateDispatchAddressDto,
  ) {
    return this.service.create(userId, storeId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDispatchAddressDto,
  ) {
    return this.service.update(userId, storeId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(userId, storeId, id);
  }

  @Post(':id/set-primary')
  @HttpCode(HttpStatus.OK)
  setPrimary(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('id') id: string,
  ) {
    return this.service.setPrimary(userId, storeId, id);
  }
}
