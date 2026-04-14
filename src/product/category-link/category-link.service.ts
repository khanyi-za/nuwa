import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { StoreStatus, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';

@Injectable()
export class CategoryLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async linkCategory(
    userId: string,
    storeId: string,
    productId: string,
    categoryId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const existing = await this.prisma.productCategory.findUnique({
      where: { productId_categoryId: { productId, categoryId } },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.productCategory.create({
      data: { productId, categoryId },
    });
  }

  async unlinkCategory(
    userId: string,
    storeId: string,
    productId: string,
    categoryId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    const product = await this.assertProductBelongsToStore(productId, storeId);

    const link = await this.prisma.productCategory.findUnique({
      where: { productId_categoryId: { productId, categoryId } },
    });
    if (!link) {
      throw new NotFoundException('Category link not found');
    }

    if (product.status === ProductStatus.ACTIVE) {
      const count = await this.prisma.productCategory.count({
        where: { productId },
      });
      if (count <= 1) {
        throw new ConflictException(
          'Cannot remove the last category from an active product',
        );
      }
    }

    await this.prisma.productCategory.delete({
      where: { productId_categoryId: { productId, categoryId } },
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
