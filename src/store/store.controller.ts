import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { ListPendingStoresDto } from './dto/list-pending-stores.dto';
import { ReviewStoreDto } from './dto/review-store.dto';
import { ReviewGoLiveDto } from './dto/review-go-live.dto';
import { StoreService } from './store.service';

@Controller('stores')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  // ── Specific routes declared first to prevent parameterised routes swallowing them ──

  // GET /stores/admin/pending — admin work queue of stores awaiting first review
  @Get('admin/pending')
  @Roles(UserRole.ADMIN)
  listPending(@Query() query: ListPendingStoresDto) {
    return this.storeService.listPending(query);
  }

  // GET /stores/admin/pending-go-live — admin work queue of stores awaiting go-live review
  @Get('admin/pending-go-live')
  @Roles(UserRole.ADMIN)
  listPendingGoLive(@Query() query: ListPendingStoresDto) {
    return this.storeService.listPendingGoLive(query);
  }

  // ── Action routes ────────────────────────────────────────────────────────────

  // POST /stores — create a new store in DRAFT status
  // Any authenticated user can call this (no @Roles — service enforces one store per user)
  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateStoreDto) {
    return this.storeService.create(userId, dto);
  }

  // POST /stores/:id/submit — submit store for admin review (owner only, enforced in service)
  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser('id') userId: string, @Param('id') storeId: string) {
    return this.storeService.submit(userId, storeId);
  }

  // POST /stores/:id/review — admin approves or rejects a pending store
  @Post(':id/review')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  review(
    @CurrentUser('id') adminId: string,
    @Param('id') storeId: string,
    @Body() dto: ReviewStoreDto,
  ) {
    return this.storeService.review(adminId, storeId, dto);
  }

  // POST /stores/:id/request-go-live — merchant requests second review (owner only, enforced in service)
  @Post(':id/request-go-live')
  @Roles(UserRole.MERCHANT)
  @HttpCode(200)
  requestGoLive(@CurrentUser('id') userId: string, @Param('id') storeId: string) {
    return this.storeService.requestGoLive(userId, storeId);
  }

  // POST /stores/:id/review-go-live — admin approves or rejects a pending go-live
  @Post(':id/review-go-live')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  reviewGoLive(
    @CurrentUser('id') adminId: string,
    @Param('id') storeId: string,
    @Body() dto: ReviewGoLiveDto,
  ) {
    return this.storeService.reviewGoLive(adminId, storeId, dto);
  }

  // PATCH /stores/:id — update store details (owner only, enforced in service)
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') storeId: string,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.storeService.update(userId, storeId, dto);
  }
}
