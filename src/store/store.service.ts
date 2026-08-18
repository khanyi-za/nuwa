import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StoreStatus, UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { ListPendingStoresDto } from './dto/list-pending-stores.dto';
import { ReviewStoreDto, ReviewDecision } from './dto/review-store.dto';
import { ReviewGoLiveDto, GoLiveDecision } from './dto/review-go-live.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { slugify } from './utils/slugify';

// Fields returned on every store response — no sensitive internal fields excluded,
// but kept explicit to remain consistent with the select pattern used across the codebase.
const storeSelect = {
  id: true,
  ownerId: true,
  companyName: true,
  displayName: true,
  slug: true,
  description: true,
  story: true,
  websiteUrl: true,
  logoUrl: true,
  status: true,
  rejectionReason: true,
  contactEmail: true,
  contactPhone: true,
  businessRegNo: true,
  vatNumber: true,
  bankName: true,
  bankAccountNo: true,
  bankBranchCode: true,
  bankAccountType: true,
  totalSales: true,
  totalRevenue: true,
  averageRating: true,
  followerCount: true,
  createdAt: true,
  updatedAt: true,
  // The store contract (athena storeSchema) requires bannerMedia on every
  // store response — omitting it makes athena's zod .parse() throw AFTER a
  // successful mutation (phantom "Something went wrong" on save/submit).
  bannerMedia: { orderBy: { sortOrder: 'asc' } },
} as const;

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  // ─── Create Store (Draft) ────────────────────────────────────────────────────

  async create(userId: string, dto: CreateStoreDto) {
    // 1. One store per user — check regardless of existing store's status
    const existingStore = await this.prisma.store.findUnique({
      where: { ownerId: userId },
    });

    if (existingStore) {
      throw new ConflictException('You already have a store');
    }

    // 2. Check companyName uniqueness — explicit check gives a specific error message
    const companyNameTaken = await this.prisma.store.findUnique({
      where: { companyName: dto.companyName },
    });

    if (companyNameTaken) {
      throw new ConflictException('A store with that company name already exists');
    }

    // 3. Check displayName uniqueness
    const displayNameTaken = await this.prisma.store.findUnique({
      where: { displayName: dto.displayName },
    });

    if (displayNameTaken) {
      throw new ConflictException('A store with that display name already exists');
    }

    // 4. Generate slug from displayName — unique because displayName is unique
    const slug = slugify(dto.displayName);

    // 5. Create the store in DRAFT status — role stays BUYER until admin approves
    return this.prisma.store.create({
      data: {
        ownerId: userId,
        companyName: dto.companyName,
        displayName: dto.displayName,
        slug,
        description: dto.description,
        story: dto.story,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
        status: StoreStatus.DRAFT,
      },
      select: storeSelect,
    });
  }

  // ─── Update Store ────────────────────────────────────────────────────────────

  async update(userId: string, storeId: string, dto: UpdateStoreDto) {
    // 1. Verify the user can manage this store (owner or active employee)
    const canManage = await this.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to edit this store');
    }

    // 2. Fetch the store for the rest of the update logic
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    })!;

    // 3. Only DRAFT, APPROVED, and ACTIVE stores can be edited
    const editableStatuses: StoreStatus[] = [StoreStatus.DRAFT, StoreStatus.APPROVED, StoreStatus.ACTIVE];

    if (!editableStatuses.includes(store!.status)) {
      throw new BadRequestException('Store cannot be edited in its current status');
    }

    // 5. If companyName is changing, check uniqueness
    if (dto.companyName && dto.companyName !== store!.companyName) {
      const companyNameTaken = await this.prisma.store.findUnique({
        where: { companyName: dto.companyName },
      });

      if (companyNameTaken) {
        throw new ConflictException('A store with that company name already exists');
      }
    }

    // 6. If displayName is changing, check uniqueness and regenerate slug
    let newSlug: string | undefined;

    if (dto.displayName && dto.displayName !== store!.displayName) {
      const displayNameTaken = await this.prisma.store.findUnique({
        where: { displayName: dto.displayName },
      });

      if (displayNameTaken) {
        throw new ConflictException('A store with that display name already exists');
      }

      newSlug = slugify(dto.displayName);
    }

    // 7. Build update data — Prisma ignores undefined values so only provided fields change
    const updateData: Record<string, unknown> = {
      ...dto,
      ...(newSlug !== undefined && { slug: newSlug }),
    };

    // 8. If the store is in DRAFT with a stale rejectionReason, clear it
    //    The merchant is addressing the feedback — the old reason is no longer relevant
    if (store!.status === StoreStatus.DRAFT && store!.rejectionReason) {
      updateData.rejectionReason = null;
    }

    // 9. Execute the update
    return this.prisma.store.update({
      where: { id: storeId },
      data: updateData,
      select: storeSelect,
    });
  }

  // ─── Submit Store for Review ─────────────────────────────────────────────────

  async submit(userId: string, storeId: string) {
    // 1. Find the store and verify ownership
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    if (store.ownerId !== userId) {
      throw new ForbiddenException('You do not have permission to submit this store');
    }

    // 2. Only DRAFT stores can be submitted
    if (store.status === StoreStatus.PENDING_REVIEW) {
      throw new BadRequestException('Store has already been submitted for review');
    }

    if (store.status === StoreStatus.ACTIVE) {
      throw new BadRequestException('Store is already active');
    }

    if (store.status === StoreStatus.SUSPENDED || store.status === StoreStatus.CLOSED) {
      throw new BadRequestException('Store cannot be submitted in its current status');
    }

    // 3. Validate all required fields — collect every missing field before throwing
    //    so the merchant can fix everything in one pass
    const missingFields: string[] = [];

    if (!store.description) missingFields.push('description');
    if (!store.logoUrl) missingFields.push('logoUrl');
    if (!store.contactEmail) missingFields.push('contactEmail');
    if (!store.contactPhone) missingFields.push('contactPhone');
    if (!store.businessRegNo) missingFields.push('businessRegNo');
    if (!store.bankName) missingFields.push('bankName');
    if (!store.bankAccountNo) missingFields.push('bankAccountNo');
    if (!store.bankBranchCode) missingFields.push('bankBranchCode');
    if (!store.bankAccountType) missingFields.push('bankAccountType');

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `The following fields are required before submission: ${missingFields.join(', ')}`,
      );
    }

    // 4. Move to PENDING_REVIEW and clear any stale rejectionReason
    return this.prisma.store.update({
      where: { id: storeId },
      data: {
        status: StoreStatus.PENDING_REVIEW,
        rejectionReason: null,
      },
      select: storeSelect,
    });
  }

  // ─── Admin: List Pending Stores ──────────────────────────────────────────────

  async listPending(query: ListPendingStoresDto) {
    const { page, limit, sortOrder } = query;
    const skip = (page - 1) * limit;

    // Batch both queries in a single transaction — one DB round-trip
    const [stores, total] = await this.prisma.$transaction([
      this.prisma.store.findMany({
        where: { status: StoreStatus.PENDING_REVIEW },
        orderBy: { createdAt: sortOrder },
        skip,
        take: limit,
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.store.count({
        where: { status: StoreStatus.PENDING_REVIEW },
      }),
    ]);

    return {
      data: stores,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Admin: Review Store (Approve or Reject) ─────────────────────────────────

  async review(adminId: string, storeId: string, dto: ReviewStoreDto) {
    // 1. Find the store — include owner for role upgrade and email notification
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // 2. Only PENDING_REVIEW stores can be reviewed
    if (store.status !== StoreStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        'Only stores in PENDING_REVIEW status can be reviewed',
      );
    }

    if (dto.decision === ReviewDecision.APPROVE) {
      // 3a. Atomic transaction — store APPROVED + owner MERCHANT must both succeed or both fail
      //     APPROVED (not ACTIVE): store is not yet visible to buyers; second gate (go-live review) required
      await this.prisma.$transaction([
        this.prisma.store.update({
          where: { id: storeId },
          data: { status: StoreStatus.APPROVED, rejectionReason: null },
        }),
        this.prisma.user.update({
          where: { id: store.ownerId },
          data: { role: UserRole.MERCHANT },
        }),
      ]);

      // 4a. Notify owner — non-blocking, approval stands regardless of email outcome
      const emailResult = await this.emailService.sendStoreApprovalEmail(
        store.owner.email,
        store.owner.firstName,
        store.displayName,
      );
      if (!emailResult.success) {
        this.logger.warn(
          `Store approval email failed for store ${storeId}: ${emailResult.error}`,
        );
      }
    } else {
      // 3b. Belt-and-suspenders reason check (DTO @ValidateIf catches this first)
      if (!dto.reason || dto.reason.trim().length < 10) {
        throw new BadRequestException(
          'A rejection reason is required and must be at least 10 characters',
        );
      }

      // 4b. Return store to DRAFT with admin feedback — no role change
      await this.prisma.store.update({
        where: { id: storeId },
        data: { status: StoreStatus.DRAFT, rejectionReason: dto.reason },
      });

      // 5b. Notify owner — non-blocking, rejection stands regardless of email outcome
      const emailResult = await this.emailService.sendStoreRejectionEmail(
        store.owner.email,
        store.owner.firstName,
        store.displayName,
        dto.reason,
      );
      if (!emailResult.success) {
        this.logger.warn(
          `Store rejection email failed for store ${storeId}: ${emailResult.error}`,
        );
      }
    }

    // 5. Return updated store with owner so the admin can confirm the outcome
    return this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  // ─── Merchant: Request Go-Live ───────────────────────────────────────────────

  async requestGoLive(userId: string, storeId: string) {
    // 1. Find the store with addresses, active product count, and banner media count
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        addresses: true,
        _count: {
          select: {
            products: { where: { status: 'ACTIVE' } },
            bannerMedia: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // 2. Verify ownership — only the owner can trigger this
    if (store.ownerId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to request go-live for this store',
      );
    }

    // 3. Verify the store is in APPROVED status — give a specific message for each state
    if (store.status !== StoreStatus.APPROVED) {
      let message: string;
      switch (store.status) {
        case StoreStatus.DRAFT:
          message =
            'Your store must be approved before requesting to go live. Please submit it for review first.';
          break;
        case StoreStatus.PENDING_REVIEW:
          message =
            'Your store is currently under initial review. Please wait for the review to complete.';
          break;
        case StoreStatus.PENDING_GO_LIVE:
          message = 'Your store is already in the go-live review queue.';
          break;
        case StoreStatus.ACTIVE:
          message = 'Your store is already live.';
          break;
        case StoreStatus.SUSPENDED:
          message = 'Your store is currently suspended and cannot request to go live.';
          break;
        case StoreStatus.CLOSED:
          message = 'Your store is closed and cannot request to go live.';
          break;
        default:
          message = 'Your store cannot request to go live in its current status.';
      }
      throw new BadRequestException(message);
    }

    // 4. Validate all launch requirements — collect every issue before throwing
    const missingRequirements: string[] = [];

    // The 11 first-submission fields must still be present
    if (!store.description) missingRequirements.push('description');
    if (!store.logoUrl) missingRequirements.push('logoUrl');
    if (!store.contactEmail) missingRequirements.push('contactEmail');
    if (!store.contactPhone) missingRequirements.push('contactPhone');
    if (!store.businessRegNo) missingRequirements.push('businessRegNo');
    if (!store.bankName) missingRequirements.push('bankName');
    if (!store.bankAccountNo) missingRequirements.push('bankAccountNo');
    if (!store.bankBranchCode) missingRequirements.push('bankBranchCode');
    if (!store.bankAccountType) missingRequirements.push('bankAccountType');

    // Additional go-live fields
    if (store._count.bannerMedia === 0) {
      missingRequirements.push('at least one banner item (image or video)');
    }
    if (!store.story) missingRequirements.push('story');

    // Relation requirements
    if (store.addresses.length === 0) {
      missingRequirements.push('at least one store address');
    }

    if (store._count.products < 7) {
      missingRequirements.push(
        `at least 7 active products (currently has ${store._count.products})`,
      );
    }

    if (missingRequirements.length > 0) {
      throw new BadRequestException(
        `Cannot request go-live. Missing requirements: ${missingRequirements.join(', ')}`,
      );
    }

    // 5. Move to PENDING_GO_LIVE and clear any stale rejectionReason from a prior go-live rejection
    return this.prisma.store.update({
      where: { id: storeId },
      data: {
        status: StoreStatus.PENDING_GO_LIVE,
        rejectionReason: null,
      },
      select: storeSelect,
    });
  }

  // ─── Admin: List Pending Go-Lives ────────────────────────────────────────────

  async listPendingGoLive(query: ListPendingStoresDto) {
    const { page, limit, sortOrder } = query;
    const skip = (page - 1) * limit;

    const [stores, total] = await this.prisma.$transaction([
      this.prisma.store.findMany({
        where: { status: StoreStatus.PENDING_GO_LIVE },
        orderBy: { createdAt: sortOrder },
        skip,
        take: limit,
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          addresses: true,
          bannerMedia: { orderBy: { sortOrder: 'asc' } },
          _count: {
            select: {
              products: { where: { status: 'ACTIVE' } },
              bannerMedia: true,
            },
          },
        },
      }),
      this.prisma.store.count({
        where: { status: StoreStatus.PENDING_GO_LIVE },
      }),
    ]);

    return {
      data: stores,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Owner: Get My Store ─────────────────────────────────────────────────────

  async getMyStore(userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { ownerId: userId },
      include: {
        addresses: true,
        bannerMedia: { orderBy: { sortOrder: 'asc' } },
        employees: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        _count: {
          select: {
            products: true,
            orders: true,
            followers: true,
          },
        },
      },
    });

    if (!store) {
      return null;
    }

    return store;
  }

  // ─── Public: Get Store Profile ────────────────────────────────────────────────

  async getPublicStore(slug: string, userId: string | null) {
    const store = await this.prisma.store.findFirst({
      where: {
        slug,
        status: StoreStatus.ACTIVE,
      },
      select: {
        id: true,
        displayName: true,
        slug: true,
        description: true,
        story: true,
        logoUrl: true,
        bannerMedia: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            url: true,
            mediaType: true,
            sortOrder: true,
            isPrimary: true,
          },
        },
        websiteUrl: true,
        averageRating: true,
        followerCount: true,
        totalSales: true,
        createdAt: true,
        addresses: {
          select: {
            id: true,
            city: true,
          },
        },
        _count: {
          select: {
            products: {
              where: { status: 'ACTIVE' },
            },
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // Skip the follower lookup for unauthenticated buyers (mobile public browse).
    const follower = userId
      ? await this.prisma.storeFollower.findUnique({
          where: {
            userId_storeId: {
              userId,
              storeId: store.id,
            },
          },
        })
      : null;

    const locations = [...new Set(store.addresses.map((addr) => addr.city))];

    return {
      id: store.id,
      displayName: store.displayName,
      slug: store.slug,
      description: store.description,
      story: store.story,
      logoUrl: store.logoUrl,
      bannerMedia: store.bannerMedia,
      websiteUrl: store.websiteUrl,
      averageRating: store.averageRating,
      followerCount: store.followerCount,
      totalSales: store.totalSales,
      createdAt: store.createdAt,
      locations,
      productCount: store._count.products,
      isFollowing: follower !== null,
    };
  }

  // ─── Follow Store ─────────────────────────────────────────────────────────────

  async followStore(userId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: {
        id: storeId,
        status: StoreStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const existingFollow = await this.prisma.storeFollower.findUnique({
      where: {
        userId_storeId: { userId, storeId },
      },
    });

    if (existingFollow) {
      throw new ConflictException('You are already following this store');
    }

    await this.prisma.$transaction([
      this.prisma.storeFollower.create({
        data: { userId, storeId },
      }),
      this.prisma.store.update({
        where: { id: storeId },
        data: { followerCount: { increment: 1 } },
      }),
    ]);

    return { message: 'Store followed', isFollowing: true };
  }

  // ─── Unfollow Store ───────────────────────────────────────────────────────────

  async unfollowStore(userId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const follow = await this.prisma.storeFollower.findUnique({
      where: {
        userId_storeId: { userId, storeId },
      },
    });

    if (!follow) {
      throw new NotFoundException('You are not following this store');
    }

    await this.prisma.$transaction([
      this.prisma.storeFollower.delete({
        where: { id: follow.id },
      }),
      this.prisma.store.update({
        where: { id: storeId },
        data: { followerCount: { decrement: 1 } },
      }),
    ]);

    return { message: 'Store unfollowed', isFollowing: false };
  }

  // ─── Admin: Review Go-Live (Approve or Reject) ───────────────────────────────

  async reviewGoLive(adminId: string, storeId: string, dto: ReviewGoLiveDto) {
    // 1. Find the store with owner for email notification
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // 2. Only PENDING_GO_LIVE stores can be reviewed here
    if (store.status !== StoreStatus.PENDING_GO_LIVE) {
      throw new BadRequestException(
        'Only stores in PENDING_GO_LIVE status can be reviewed for go-live',
      );
    }

    if (dto.decision === GoLiveDecision.APPROVE) {
      // 3a. Update store to ACTIVE — no role change (owner is already MERCHANT)
      await this.prisma.store.update({
        where: { id: storeId },
        data: { status: StoreStatus.ACTIVE, rejectionReason: null },
      });

      // 4a. Send celebratory email — non-blocking
      const emailResult = await this.emailService.sendStoreLiveEmail(
        store.owner.email,
        store.owner.firstName,
        store.displayName,
        store.slug,
      );
      if (!emailResult.success) {
        this.logger.warn(
          `Store live email failed for store ${storeId}: ${emailResult.error}`,
        );
      }
    } else {
      // 3b. Belt-and-suspenders reason check (DTO @ValidateIf catches this first)
      if (!dto.reason || dto.reason.trim().length < 10) {
        throw new BadRequestException(
          'A rejection reason is required and must be at least 10 characters',
        );
      }

      // 4b. Return store to APPROVED (not DRAFT) — merchant keeps dashboard access and MERCHANT role
      await this.prisma.store.update({
        where: { id: storeId },
        data: { status: StoreStatus.APPROVED, rejectionReason: dto.reason },
      });

      // 5b. Notify owner — non-blocking
      const emailResult = await this.emailService.sendGoLiveRejectionEmail(
        store.owner.email,
        store.owner.firstName,
        store.displayName,
        dto.reason,
      );
      if (!emailResult.success) {
        this.logger.warn(
          `Go-live rejection email failed for store ${storeId}: ${emailResult.error}`,
        );
      }
    }

    // 5. Return updated store with owner so the admin can confirm the outcome
    return this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  // ─── Store Addresses ──────────────────────────────────────────────────────────

  async addAddress(userId: string, storeId: string, dto: CreateAddressDto) {
    // 1. Verify the user can manage this store (owner or active employee)
    const canManage = await this.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to manage this store');
    }

    // 2. Check store status — addresses can be added at any status except CLOSED
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });

    if (store!.status === StoreStatus.CLOSED) {
      throw new BadRequestException('Cannot add addresses to a closed store');
    }

    // 3. Create and return the address
    return this.prisma.storeAddress.create({
      data: {
        storeId,
        streetNumber: dto.streetNumber,
        streetName: dto.streetName,
        buildingName: dto.buildingName,
        suburb: dto.suburb,
        city: dto.city,
        postalCode: dto.postalCode,
      },
    });
  }

  async updateAddress(
    userId: string,
    storeId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    // 1. Verify the user can manage this store
    const canManage = await this.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to manage this store');
    }

    // 2. Find the address and verify it belongs to this store
    //    Same 404 for "not found" and "wrong store" — prevents enumeration
    const address = await this.prisma.storeAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.storeId !== storeId) {
      throw new NotFoundException('Address not found');
    }

    // 3. Update and return
    return this.prisma.storeAddress.update({
      where: { id: addressId },
      data: dto,
    });
  }

  async deleteAddress(userId: string, storeId: string, addressId: string) {
    // 1. Verify the user can manage this store
    const canManage = await this.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to manage this store');
    }

    // 2. Find the address and verify it belongs to this store
    const address = await this.prisma.storeAddress.findUnique({
      where: { id: addressId },
    });

    if (!address || address.storeId !== storeId) {
      throw new NotFoundException('Address not found');
    }

    // 3. For approved/pending-go-live/active stores, block deletion of the last address
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });

    const postApprovalStatuses: StoreStatus[] = [
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];

    if (postApprovalStatuses.includes(store!.status)) {
      const addressCount = await this.prisma.storeAddress.count({
        where: { storeId },
      });

      if (addressCount === 1) {
        throw new BadRequestException(
          'Cannot delete the last address. Approved stores must have at least one location.',
        );
      }
    }

    // 4. Delete and return success
    await this.prisma.storeAddress.delete({
      where: { id: addressId },
    });

    return { message: 'Address deleted' };
  }

  // ─── Employee Invitations ─────────────────────────────────────────────────────

  async inviteEmployee(userId: string, storeId: string, dto: InviteEmployeeDto) {
    // 1. Verify the user is the store owner (not just any employee)
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException('Only the store owner can invite employees');
    }

    // 2. Inviting only makes sense once the store is approved
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true, displayName: true },
    });

    const inviteAllowedStatuses: StoreStatus[] = [
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];

    if (!inviteAllowedStatuses.includes(store!.status)) {
      throw new BadRequestException(
        'You can only invite employees once your store has been approved',
      );
    }

    // 3. Check for existing invite or employee with the same email
    const existing = await this.prisma.storeEmployee.findUnique({
      where: { storeId_email: { storeId, email: dto.email } },
    });

    if (existing) {
      if (existing.acceptedAt) {
        throw new ConflictException('This person is already an employee of your store');
      } else {
        throw new ConflictException(
          'An invite has already been sent to this email. Use the resend endpoint if needed.',
        );
      }
    }

    // 4. Generate invite token — raw goes in the email, hash goes in the DB
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 5. Create the StoreEmployee record in pending state
    const employee = await this.prisma.storeEmployee.create({
      data: {
        storeId,
        email: dto.email,
        inviteToken: hashedToken,
        inviteExpiry,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        isActive: true,
        acceptedAt: true,
        createdAt: true,
      },
    });

    // 6. Send the invite email — non-blocking, record persists even if email fails
    const emailResult = await this.emailService.sendStoreInviteEmail(
      dto.email,
      store!.displayName,
      rawToken,
    );
    if (!emailResult.success) {
      this.logger.warn(
        `Store invite email failed for employee ${employee.id}: ${emailResult.error}`,
      );
    }

    return employee;
  }

  async validateInvite(token: string) {
    // 1. Hash the incoming token for comparison against stored hash
    const hashedToken = createHash('sha256').update(token).digest('hex');

    // 2. Find a valid pending invite — must be unexpired and not yet accepted
    const invite = await this.prisma.storeEmployee.findFirst({
      where: {
        inviteToken: hashedToken,
        inviteExpiry: { gt: new Date() },
        acceptedAt: null,
      },
      select: {
        email: true,
        store: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            logoUrl: true,
          },
        },
      },
    });

    if (!invite) {
      throw new BadRequestException('Invalid or expired invitation');
    }

    return {
      email: invite.email,
      store: invite.store,
    };
  }

  async acceptInvite(userId: string, dto: AcceptInviteDto) {
    // 1. Hash the incoming token
    const hashedToken = createHash('sha256').update(dto.token).digest('hex');

    // 2. Find the pending invite
    const invite = await this.prisma.storeEmployee.findFirst({
      where: {
        inviteToken: hashedToken,
        inviteExpiry: { gt: new Date() },
        acceptedAt: null,
      },
    });

    if (!invite) {
      throw new BadRequestException('Invalid or expired invitation');
    }

    // 3. Verify the authenticated user's email matches the invite email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user!.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new BadRequestException(
        'This invitation was sent to a different email address. Please log in with the correct account.',
      );
    }

    // 4. Accept — link the user, stamp acceptedAt, clear the token (one-time use)
    return this.prisma.storeEmployee.update({
      where: { id: invite.id },
      data: {
        userId,
        employeeNumber: dto.employeeNumber,
        acceptedAt: new Date(),
        inviteToken: null,
        inviteExpiry: null,
      },
      select: {
        id: true,
        email: true,
        employeeNumber: true,
        isActive: true,
        acceptedAt: true,
        store: {
          select: {
            id: true,
            displayName: true,
            slug: true,
          },
        },
      },
    });
  }

  async listEmployees(userId: string, storeId: string) {
    // 1. Verify the user can manage this store (owner or active employee)
    const canManage = await this.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException('You do not have permission to manage this store');
    }

    // 2. Return all employees (pending and accepted) ordered oldest first
    //    inviteToken and inviteExpiry are deliberately excluded
    const employees = await this.prisma.storeEmployee.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        employeeNumber: true,
        isActive: true,
        acceptedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return { data: employees };
  }

  async deactivateEmployee(userId: string, storeId: string, employeeId: string) {
    // 1. Only the store owner can deactivate employees
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException('Only the store owner can deactivate employees');
    }

    // 2. Find employee and verify it belongs to this store
    const employee = await this.prisma.storeEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee || employee.storeId !== storeId) {
      throw new NotFoundException('Employee not found');
    }

    // 3. Guard against no-op
    if (!employee.isActive) {
      throw new BadRequestException('Employee is already deactivated');
    }

    // 4. Deactivate
    return this.prisma.storeEmployee.update({
      where: { id: employeeId },
      data: { isActive: false },
      select: {
        id: true,
        email: true,
        employeeNumber: true,
        isActive: true,
        acceptedAt: true,
      },
    });
  }

  async reactivateEmployee(userId: string, storeId: string, employeeId: string) {
    // 1. Only the store owner can reactivate employees
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException('Only the store owner can reactivate employees');
    }

    // 2. Find employee and verify it belongs to this store
    const employee = await this.prisma.storeEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee || employee.storeId !== storeId) {
      throw new NotFoundException('Employee not found');
    }

    // 3. Guard against no-op
    if (employee.isActive) {
      throw new BadRequestException('Employee is already active');
    }

    // 4. Reactivate
    return this.prisma.storeEmployee.update({
      where: { id: employeeId },
      data: { isActive: true },
      select: {
        id: true,
        email: true,
        employeeNumber: true,
        isActive: true,
        acceptedAt: true,
      },
    });
  }

  async removeEmployee(userId: string, storeId: string, employeeId: string) {
    // 1. Only the store owner can remove employees
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException('Only the store owner can remove employees');
    }

    // 2. Find employee and verify it belongs to this store
    const employee = await this.prisma.storeEmployee.findUnique({
      where: { id: employeeId },
    });

    if (!employee || employee.storeId !== storeId) {
      throw new NotFoundException('Employee not found');
    }

    // 3. Hard delete
    await this.prisma.storeEmployee.delete({
      where: { id: employeeId },
    });

    return { message: 'Employee removed' };
  }

  async resendInvite(userId: string, storeId: string, employeeId: string) {
    // 1. Only the store owner can resend invites
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException('Only the store owner can resend invites');
    }

    // 2. Find employee and verify it belongs to this store
    const employee = await this.prisma.storeEmployee.findUnique({
      where: { id: employeeId },
      include: { store: { select: { displayName: true } } },
    });

    if (!employee || employee.storeId !== storeId) {
      throw new NotFoundException('Employee not found');
    }

    // 3. Cannot resend an already-accepted invite
    if (employee.acceptedAt) {
      throw new BadRequestException('This invitation has already been accepted');
    }

    // 4. Generate a fresh token — invalidates any link from the previous email
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 5. Update the record with the new token
    await this.prisma.storeEmployee.update({
      where: { id: employeeId },
      data: { inviteToken: hashedToken, inviteExpiry },
    });

    // 6. Resend the email — non-blocking
    const emailResult = await this.emailService.sendStoreInviteEmail(
      employee.email,
      employee.store.displayName,
      rawToken,
    );
    if (!emailResult.success) {
      this.logger.warn(
        `Resend invite email failed for employee ${employeeId}: ${emailResult.error}`,
      );
    }

    return { message: 'Invitation resent' };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Returns true if the user is the store owner OR an active accepted employee.
   * Returns false if the store doesn't exist (intentional — don't reveal existence).
   */
  async canManageStore(userId: string, storeId: string): Promise<boolean> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { ownerId: true },
    });

    if (!store) {
      return false;
    }

    if (store.ownerId === userId) {
      return true;
    }

    const employee = await this.prisma.storeEmployee.findFirst({
      where: {
        storeId,
        userId,
        isActive: true,
        acceptedAt: { not: null },
      },
      select: { id: true },
    });

    return employee !== null;
  }

  /**
   * Returns true only if the user is the store owner.
   * Used for operations that employees cannot perform (invite, deactivate, remove, etc.).
   */
  private async isStoreOwner(userId: string, storeId: string): Promise<boolean> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { ownerId: true },
    });

    return store?.ownerId === userId;
  }
}
