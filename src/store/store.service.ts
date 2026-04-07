import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { StoreStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { ListPendingStoresDto } from './dto/list-pending-stores.dto';
import { ReviewStoreDto, ReviewDecision } from './dto/review-store.dto';
import { ReviewGoLiveDto, GoLiveDecision } from './dto/review-go-live.dto';
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
  bannerUrl: true,
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
    // 1. Find the store and verify ownership
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    if (store.ownerId !== userId) {
      throw new ForbiddenException('You do not have permission to edit this store');
    }

    // 2. Only DRAFT, APPROVED, and ACTIVE stores can be edited
    const editableStatuses: StoreStatus[] = [StoreStatus.DRAFT, StoreStatus.APPROVED, StoreStatus.ACTIVE];

    if (!editableStatuses.includes(store.status)) {
      throw new BadRequestException('Store cannot be edited in its current status');
    }

    // 3. If companyName is changing, check uniqueness
    if (dto.companyName && dto.companyName !== store.companyName) {
      const companyNameTaken = await this.prisma.store.findUnique({
        where: { companyName: dto.companyName },
      });

      if (companyNameTaken) {
        throw new ConflictException('A store with that company name already exists');
      }
    }

    // 4. If displayName is changing, check uniqueness and regenerate slug
    let newSlug: string | undefined;

    if (dto.displayName && dto.displayName !== store.displayName) {
      const displayNameTaken = await this.prisma.store.findUnique({
        where: { displayName: dto.displayName },
      });

      if (displayNameTaken) {
        throw new ConflictException('A store with that display name already exists');
      }

      newSlug = slugify(dto.displayName);
    }

    // 5. Build update data — Prisma ignores undefined values so only provided fields change
    const updateData: Record<string, unknown> = {
      ...dto,
      ...(newSlug !== undefined && { slug: newSlug }),
    };

    // 6. If the store is in DRAFT with a stale rejectionReason, clear it
    //    The merchant is addressing the feedback — the old reason is no longer relevant
    if (store.status === StoreStatus.DRAFT && store.rejectionReason) {
      updateData.rejectionReason = null;
    }

    // 7. Execute the update
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
    // 1. Find the store with addresses and active product count
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        addresses: true,
        _count: {
          select: {
            products: { where: { status: 'ACTIVE' } },
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
    if (!store.bannerUrl) missingRequirements.push('bannerUrl');
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
          _count: {
            select: {
              products: { where: { status: 'ACTIVE' } },
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
}
