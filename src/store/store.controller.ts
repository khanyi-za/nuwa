import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { ListPendingStoresDto } from './dto/list-pending-stores.dto';
import { ReviewStoreDto } from './dto/review-store.dto';
import { ReviewGoLiveDto } from './dto/review-go-live.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { StoreService } from './store.service';

@Controller('stores')
@UseGuards(RolesGuard)
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  // ── Specific routes declared first to prevent parameterised routes swallowing them ──

  // GET /stores/me — authenticated owner's full private store view (null if no store)
  // Must be before any :slug or :id routes or NestJS will match "me" as a slug param
  @Get('me')
  getMyStore(@CurrentUser('id') userId: string) {
    return this.storeService.getMyStore(userId);
  }

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

  // ── Address sub-resource routes ──────────────────────────────────────────────

  // POST /stores/:storeId/addresses — add a physical location (owner or active employee)
  @Post(':storeId/addresses')
  addAddress(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: CreateAddressDto,
  ) {
    return this.storeService.addAddress(userId, storeId, dto);
  }

  // PATCH /stores/:storeId/addresses/:addressId — update a location
  @Patch(':storeId/addresses/:addressId')
  updateAddress(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.storeService.updateAddress(userId, storeId, addressId, dto);
  }

  // DELETE /stores/:storeId/addresses/:addressId — remove a location
  @Delete(':storeId/addresses/:addressId')
  @HttpCode(200)
  deleteAddress(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('addressId') addressId: string,
  ) {
    return this.storeService.deleteAddress(userId, storeId, addressId);
  }

  // ── Employee sub-resource routes (owner-only management) ─────────────────────

  // POST /stores/:storeId/employees — send an invite to an email
  @Post(':storeId/employees')
  inviteEmployee(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Body() dto: InviteEmployeeDto,
  ) {
    return this.storeService.inviteEmployee(userId, storeId, dto);
  }

  // GET /stores/:storeId/employees — list all employees and pending invites
  @Get(':storeId/employees')
  listEmployees(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.storeService.listEmployees(userId, storeId);
  }

  // POST /stores/:storeId/employees/:employeeId/resend — resend invite with a fresh token
  @Post(':storeId/employees/:employeeId/resend')
  @HttpCode(200)
  resendInvite(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.storeService.resendInvite(userId, storeId, employeeId);
  }

  // POST /stores/:storeId/employees/:employeeId/deactivate — revoke access
  @Post(':storeId/employees/:employeeId/deactivate')
  @HttpCode(200)
  deactivateEmployee(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.storeService.deactivateEmployee(userId, storeId, employeeId);
  }

  // POST /stores/:storeId/employees/:employeeId/reactivate — restore access
  @Post(':storeId/employees/:employeeId/reactivate')
  @HttpCode(200)
  reactivateEmployee(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.storeService.reactivateEmployee(userId, storeId, employeeId);
  }

  // DELETE /stores/:storeId/employees/:employeeId — permanently remove the record
  @Delete(':storeId/employees/:employeeId')
  @HttpCode(200)
  removeEmployee(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('employeeId') employeeId: string,
  ) {
    return this.storeService.removeEmployee(userId, storeId, employeeId);
  }

  // POST /stores/:id/follow — follow a store (any authenticated user)
  @Post(':id/follow')
  @HttpCode(200)
  followStore(@CurrentUser('id') userId: string, @Param('id') storeId: string) {
    return this.storeService.followStore(userId, storeId);
  }

  // DELETE /stores/:id/follow — unfollow a store (any authenticated user)
  @Delete(':id/follow')
  @HttpCode(200)
  unfollowStore(@CurrentUser('id') userId: string, @Param('id') storeId: string) {
    return this.storeService.unfollowStore(userId, storeId);
  }

  // ── Catch-all parameterised route — MUST be declared last ────────────────────

  // GET /stores/:slug — public store profile (ACTIVE stores only, whitelist fields).
  // Declared last so it doesn't swallow /me, /admin/pending, /admin/pending-go-live.
  // Public-with-optional-auth: unauthenticated buyers can view the profile; if a
  // JWT is present, `isFollowing` is computed against the current user.
  // `@Public()` bypasses the global JwtAuthGuard; `OptionalJwtAuthGuard` populates
  // request.user if a valid JWT exists, otherwise leaves it null.
  @Get(':slug')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  getPublicStore(
    @CurrentUser('id') userId: string | undefined,
    @Param('slug') slug: string,
  ) {
    return this.storeService.getPublicStore(slug, userId ?? null);
  }
}
