import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StoreStatus, ProductStatus, MediaType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { AddImageDto } from '../dto/add-image.dto';
import { ReorderImagesDto } from '../dto/reorder-images.dto';

@Injectable()
export class ImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async addImage(
    userId: string,
    storeId: string,
    productId: string,
    dto: AddImageDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    const product = await this.assertProductBelongsToStore(productId, storeId);

    const existingCount = await this.prisma.productImage.count({
      where: { productId },
    });

    const isFirst = existingCount === 0;
    const setPrimary = isFirst ? true : (dto.isPrimary ?? false);

    if (setPrimary) {
      return this.prisma.$transaction(async (tx) => {
        await tx.productImage.updateMany({
          where: { productId, isPrimary: true },
          data: { isPrimary: false },
        });
        return tx.productImage.create({
          data: {
            productId,
            url: dto.url,
            altText: dto.altText,
            mediaType: dto.mediaType ?? MediaType.IMAGE,
            sortOrder: existingCount,
            isPrimary: true,
          },
        });
      });
    }

    return this.prisma.productImage.create({
      data: {
        productId,
        url: dto.url,
        altText: dto.altText,
        mediaType: dto.mediaType ?? MediaType.IMAGE,
        sortOrder: existingCount,
        isPrimary: false,
      },
    });
  }

  async reorderImages(
    userId: string,
    storeId: string,
    productId: string,
    dto: ReorderImagesDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const existingImages = await this.prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });

    const existingIds = new Set(existingImages.map((img) => img.id));

    if (dto.imageIds.length !== existingIds.size) {
      throw new BadRequestException(
        'imageIds must contain exactly the current set of image IDs',
      );
    }

    for (const id of dto.imageIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          `Image ID ${id} does not belong to this product`,
        );
      }
    }

    await this.prisma.$transaction(
      dto.imageIds.map((id, index) =>
        this.prisma.productImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async setPrimaryImage(
    userId: string,
    storeId: string,
    productId: string,
    imageId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    // Load full scalar shape so the no-op early-return matches the success
    // path's prisma.productImage.update() result.
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException('Image not found');
    }

    if (image.isPrimary) {
      return image;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.productImage.updateMany({
        where: { productId, isPrimary: true },
        data: { isPrimary: false },
      });
      return tx.productImage.update({
        where: { id: imageId },
        data: { isPrimary: true },
      });
    });
  }

  async removeImage(
    userId: string,
    storeId: string,
    productId: string,
    imageId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    const product = await this.assertProductBelongsToStore(productId, storeId);

    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
      select: { id: true, productId: true, isPrimary: true, sortOrder: true },
    });
    if (!image || image.productId !== productId) {
      throw new NotFoundException('Image not found');
    }

    const imageCount = await this.prisma.productImage.count({
      where: { productId },
    });

    if (product.status === ProductStatus.ACTIVE && imageCount <= 1) {
      throw new ConflictException(
        'Cannot remove the last image from an active product. Add a replacement image first or archive the product.',
      );
    }

    const wasPrimary = image.isPrimary;

    await this.prisma.productImage.delete({ where: { id: imageId } });

    const remaining = await this.prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });

    if (remaining.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.productImage.updateMany({
          where: { productId },
          data: { isPrimary: false },
        });
        await Promise.all(
          remaining.map((img, index) =>
            tx.productImage.update({
              where: { id: img.id },
              data: { sortOrder: index },
            }),
          ),
        );
        if (wasPrimary) {
          await tx.productImage.update({
            where: { id: remaining[0].id },
            data: { isPrimary: true },
          });
        }
      });
    }

    return { success: true };
  }

  private async assertCanMutateProducts(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    // PENDING_REVIEW included deliberately (2026-08-18): merchants keep
    // polishing their catalogue while the store is under review — admin review
    // targets business identity, not individual products (policy-register P-1).
    const allowedStatuses: StoreStatus[] = [
      StoreStatus.PENDING_REVIEW,
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];
    if (!allowedStatuses.includes(store.status)) {
      throw new ForbiddenException(
        `Cannot manage products on a store with status ${store.status}. Submit your store for review first.`,
      );
    }
  }

  private async assertProductBelongsToStore(
    productId: string,
    storeId: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, status: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }
    if (product.status === ProductStatus.ARCHIVED) {
      throw new ConflictException('Cannot modify an archived product');
    }
    return product;
  }
}
