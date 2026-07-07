import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import { ReturnActionDto } from '../dto/return-request.dto';

/**
 * Merchant returns queue — raw shapes (athena BFF consumer, not the mobile
 * envelope). Authz service-side via canManageStore.
 *
 * Lifecycle: REQUESTED → approve/reject; APPROVED → received; RECEIVED →
 * close (after the admin refund tool has moved the money).
 */
@Controller('stores/:storeId/returns')
export class MerchantReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.returns.listForStore(userId, storeId, { status, cursor, take });
  }

  @Post(':returnId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('returnId') returnId: string,
    @Body() dto: ReturnActionDto,
  ) {
    return this.returns.approve(userId, storeId, returnId, dto.notes);
  }

  @Post(':returnId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('returnId') returnId: string,
    @Body() dto: ReturnActionDto,
  ) {
    return this.returns.reject(userId, storeId, returnId, dto.notes);
  }

  @Post(':returnId/received')
  @HttpCode(HttpStatus.OK)
  markReceived(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('returnId') returnId: string,
    @Body() dto: ReturnActionDto,
  ) {
    return this.returns.markReceived(userId, storeId, returnId, dto.notes);
  }

  @Post(':returnId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('returnId') returnId: string,
    @Body() dto: ReturnActionDto,
  ) {
    return this.returns.close(userId, storeId, returnId, dto.notes);
  }
}
