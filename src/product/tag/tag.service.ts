import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StoreStatus, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { AddTagDto } from '../dto/add-tag.dto';
import { slugify } from '../utils/slugify';

const MAX_TAGS_PER_PRODUCT = 20;

@Injectable()
export class TagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async addTag(
    userId: string,
    storeId: string,
    productId: string,
    dto: AddTagDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const normalizedName = dto.name.trim().toLowerCase();

    const existingCount = await this.prisma.productTag.count({
      where: { productId },
    });
    if (existingCount >= MAX_TAGS_PER_PRODUCT) {
      throw new BadRequestException(
        `A product can have at most ${MAX_TAGS_PER_PRODUCT} tags`,
      );
    }

    const tag = await this.prisma.tag.upsert({
      where: { name: normalizedName },
      create: { name: normalizedName, slug: slugify(normalizedName), usageCount: 0 },
      update: {},
    });

    const existingLink = await this.prisma.productTag.findUnique({
      where: { productId_tagId: { productId, tagId: tag.id } },
    });
    if (existingLink) {
      return existingLink;
    }

    return this.prisma.$transaction(async (tx) => {
      const productTag = await tx.productTag.create({
        data: {
          productId,
          tagId: tag.id,
          isAiGenerated: false,
          confidence: null,
        },
      });
      await tx.tag.update({
        where: { id: tag.id },
        data: { usageCount: { increment: 1 } },
      });
      return productTag;
    });
  }

  async removeTag(
    userId: string,
    storeId: string,
    productId: string,
    tagId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const productTag = await this.prisma.productTag.findUnique({
      where: { productId_tagId: { productId, tagId } },
    });
    if (!productTag) {
      throw new NotFoundException('Tag link not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productTag.delete({
        where: { productId_tagId: { productId, tagId } },
      });
      await tx.tag.update({
        where: { id: tagId },
        data: { usageCount: { decrement: 1 } },
      });
    });

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

    const allowedStatuses: StoreStatus[] = [
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];
    if (!allowedStatuses.includes(store.status)) {
      throw new ForbiddenException(
        `Cannot manage products on a store with status ${store.status}. Store must be approved first.`,
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
