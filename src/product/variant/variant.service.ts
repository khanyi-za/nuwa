import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { StoreStatus, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CreateVariantDto } from '../dto/create-variant.dto';
import { UpdateVariantDto } from '../dto/update-variant.dto';

@Injectable()
export class VariantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async createVariant(
    userId: string,
    storeId: string,
    productId: string,
    dto: CreateVariantDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const existingCount = await this.prisma.productVariant.count({
      where: { productId },
    });

    return this.prisma.productVariant.create({
      data: {
        productId,
        name: dto.name.trim(),
        sku: dto.sku?.trim(),
        priceInCents: dto.priceInCents ?? null,
        stock: dto.stock,
        color: dto.color?.trim(),
        size: dto.size?.trim(),
        material: dto.material?.trim(),
        sortOrder: dto.sortOrder ?? existingCount,
      },
    });
  }

  async updateVariant(
    userId: string,
    storeId: string,
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('Variant not found');
    }

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        name: dto.name?.trim(),
        sku: dto.sku?.trim(),
        priceInCents: dto.priceInCents,
        stock: dto.stock,
        color: dto.color?.trim(),
        size: dto.size?.trim(),
        material: dto.material?.trim(),
        sortOrder: dto.sortOrder,
      },
    });
  }

  async deleteVariant(
    userId: string,
    storeId: string,
    productId: string,
    variantId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertProductBelongsToStore(productId, storeId);

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, productId: true },
    });
    if (!variant || variant.productId !== productId) {
      throw new NotFoundException('Variant not found');
    }

    await this.prisma.productVariant.delete({ where: { id: variantId } });

    const remaining = await this.prisma.productVariant.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });

    if (remaining.length > 0) {
      await this.prisma.$transaction(
        remaining.map((v, index) =>
          this.prisma.productVariant.update({
            where: { id: v.id },
            data: { sortOrder: index },
          }),
        ),
      );
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
