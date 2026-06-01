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
import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { AddressService } from './address.service';

/**
 * Buyer address endpoints. JWT auth is applied globally via `JwtAuthGuard`
 * (APP_GUARD in AuthModule). Any authenticated user can manage their own
 * addresses — MERCHANT-role users who shop on mobile are first-class buyers
 * here (BUYER role gate dropped on 2026-06-01).
 *
 * Admin address views for support live in a separate controller (Phase 7).
 * Guest checkout creates addresses via the same `AddressService.create()` —
 * the guest User is auto-created first, so standard ownership semantics hold.
 */
@Controller('addresses')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.addressService.list(userId);
  }

  @Get(':id')
  getById(
    @CurrentUser('id') userId: string,
    @Param('id') addressId: string,
  ) {
    return this.addressService.getById(userId, addressId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addressService.create(userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.update(userId, addressId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  delete(
    @CurrentUser('id') userId: string,
    @Param('id') addressId: string,
  ) {
    return this.addressService.delete(userId, addressId);
  }
}
