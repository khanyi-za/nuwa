import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../store.service';
import { AddBannerMediaDto } from './dto/add-banner-media.dto';
import { ReorderBannerMediaDto } from './dto/reorder-banner-media.dto';

const MAX_BANNER_ITEMS = 5;

// Statuses where removing the last banner item is blocked (mirrors the
// last-image-on-ACTIVE-product rule in product.image.service).
const DELETE_PROTECTED_STATUSES: StoreStatus[] = [
  StoreStatus.PENDING_GO_LIVE,
  StoreStatus.ACTIVE,
];

@Injectable()
export class BannerMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  /**
   * Append a media item to the store's banner gallery.
   * - Caps at MAX_BANNER_ITEMS (5)
   * - First item becomes the cover (isPrimary: true, sortOrder: 0)
   * - Subsequent items go to the end of the gallery with the next sortOrder
   */
  async addBannerMedia(userId: string, storeId: string, dto: AddBannerMediaDto) {
    await this.assertCanManageStore(userId, storeId);

    const existingCount = await this.prisma.storeBannerMedia.count({
      where: { storeId },
    });
    if (existingCount >= MAX_BANNER_ITEMS) {
      throw new BadRequestException(
        `Banner gallery is at the ${MAX_BANNER_ITEMS}-item limit. Remove an item before adding a new one.`,
      );
    }

    const isFirst = existingCount === 0;

    return this.prisma.storeBannerMedia.create({
      data: {
        storeId,
        url: dto.url,
        mediaType: dto.mediaType,
        sortOrder: existingCount,
        isPrimary: isFirst,
      },
    });
  }

  /**
   * Remove a banner item. Renumbers remaining items so sortOrder stays
   * contiguous, and promotes the new lowest-sortOrder item to cover if the
   * removed item was the cover.
   *
   * Blocked for PENDING_GO_LIVE / ACTIVE stores if it would empty the gallery.
   */
  async removeBannerMedia(userId: string, storeId: string, id: string) {
    await this.assertCanManageStore(userId, storeId);

    const item = await this.prisma.storeBannerMedia.findUnique({
      where: { id },
      select: { id: true, storeId: true, isPrimary: true },
    });
    // 404-not-403 if the item doesn't exist OR belongs to a different store
    if (!item || item.storeId !== storeId) {
      throw new NotFoundException('Banner media not found');
    }

    // Status-aware delete protection: PENDING_GO_LIVE / ACTIVE stores must
    // keep at least one banner item.
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });
    const currentCount = await this.prisma.storeBannerMedia.count({
      where: { storeId },
    });
    if (
      store &&
      DELETE_PROTECTED_STATUSES.includes(store.status) &&
      currentCount <= 1
    ) {
      throw new BadRequestException(
        'At least one banner item is required while the store is in PENDING_GO_LIVE or ACTIVE',
      );
    }

    // Delete + renumber the remaining items in a transaction so they stay
    // contiguous (0..N-1) and exactly one is isPrimary.
    await this.prisma.$transaction(async (tx) => {
      await tx.storeBannerMedia.delete({ where: { id } });

      const remaining = await tx.storeBannerMedia.findMany({
        where: { storeId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });

      // Re-assign sortOrder 0..N-1 and isPrimary on index 0.
      await Promise.all(
        remaining.map((row, index) =>
          tx.storeBannerMedia.update({
            where: { id: row.id },
            data: { sortOrder: index, isPrimary: index === 0 },
          }),
        ),
      );
    });

    return { message: 'Banner media removed' };
  }

  /**
   * Reorder the entire gallery in one call. The request must list the exact
   * set of current item ids — miscount, duplicates, or unknown ids are rejected.
   * The id at index 0 becomes the cover.
   */
  async reorderBannerMedia(
    userId: string,
    storeId: string,
    dto: ReorderBannerMediaDto,
  ) {
    await this.assertCanManageStore(userId, storeId);

    const current = await this.prisma.storeBannerMedia.findMany({
      where: { storeId },
      select: { id: true },
    });
    const currentIds = new Set(current.map((row) => row.id));
    const requestedIds = new Set(dto.ids);

    const exactSetMatch =
      dto.ids.length === current.length &&
      currentIds.size === requestedIds.size &&
      [...currentIds].every((id) => requestedIds.has(id));

    if (!exactSetMatch) {
      throw new BadRequestException(
        'Reorder ids must contain exactly the current set of banner items',
      );
    }

    // Apply the new order: sortOrder = array index, isPrimary on index 0.
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.ids.map((id, index) =>
          tx.storeBannerMedia.update({
            where: { id },
            data: { sortOrder: index, isPrimary: index === 0 },
          }),
        ),
      );
    });

    // Return the reordered gallery so the frontend doesn't need a follow-up call.
    return this.prisma.storeBannerMedia.findMany({
      where: { storeId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Owner-or-active-employee gate. Returns 403 (not 404) when the user
   * can't manage the store — keeping enumeration prevention consistent
   * with the rest of the store module's mutations.
   */
  private async assertCanManageStore(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }
  }
}
