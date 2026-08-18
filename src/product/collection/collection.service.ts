import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ProductStatus, StoreStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CreateCollectionDto } from '../dto/create-collection.dto';
import { UpdateCollectionDto } from '../dto/update-collection.dto';
import { slugify } from '../utils/slugify';

@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async create(userId: string, storeId: string, dto: CreateCollectionDto) {
    await this.assertCanMutateProducts(userId, storeId);

    const slug = await this.generateUniqueSlug(storeId, dto.name);

    return this.prisma.storeCollection.create({
      data: {
        storeId,
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim(),
        imageUrl: dto.imageUrl,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async listForMerchant(userId: string, userRole: UserRole, storeId: string) {
    if (userRole !== UserRole.ADMIN) {
      const canManage = await this.storeService.canManageStore(
        userId,
        storeId,
      );
      if (!canManage) {
        throw new ForbiddenException(
          'You do not have permission to manage this store',
        );
      }
    }

    const data = await this.prisma.storeCollection.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });

    return { data };
  }

  async update(
    userId: string,
    storeId: string,
    collectionId: string,
    dto: UpdateCollectionDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertCollectionBelongsToStore(collectionId, storeId);

    return this.prisma.storeCollection.update({
      where: { id: collectionId },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        imageUrl: dto.imageUrl,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async delete(userId: string, storeId: string, collectionId: string) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertCollectionBelongsToStore(collectionId, storeId);

    await this.prisma.storeCollection.delete({ where: { id: collectionId } });

    return { success: true };
  }

  async addProduct(
    userId: string,
    storeId: string,
    collectionId: string,
    productId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertCollectionBelongsToStore(collectionId, storeId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    const existing = await this.prisma.productCollection.findUnique({
      where: { productId_collectionId: { productId, collectionId } },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.productCollection.create({
      data: { productId, collectionId },
    });
  }

  async removeProduct(
    userId: string,
    storeId: string,
    collectionId: string,
    productId: string,
  ) {
    await this.assertCanMutateProducts(userId, storeId);
    await this.assertCollectionBelongsToStore(collectionId, storeId);

    const link = await this.prisma.productCollection.findUnique({
      where: { productId_collectionId: { productId, collectionId } },
    });
    if (!link) {
      throw new NotFoundException('Product is not in this collection');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        status: true,
        _count: { select: { collections: true } },
      },
    });
    if (
      product &&
      product.status === ProductStatus.ACTIVE &&
      product._count.collections <= 1
    ) {
      throw new BadRequestException(
        'Cannot remove the last collection from an active product. Add another collection first, or archive the product.',
      );
    }

    await this.prisma.productCollection.delete({
      where: { productId_collectionId: { productId, collectionId } },
    });

    return { success: true };
  }

  async getPublicCollections(storeSlug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug: storeSlug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== 'ACTIVE') {
      throw new NotFoundException('Store not found');
    }

    const collections = await this.prisma.storeCollection.findMany({
      where: { storeId: store.id },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    });

    return collections.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      imageUrl: c.imageUrl,
      sortOrder: c.sortOrder,
      productCount: c._count.products,
    }));
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
    // organising their catalogue while the store is under review — admin review
    // targets business identity, not collections (policy-register P-1).
    const allowedStatuses: StoreStatus[] = [
      StoreStatus.PENDING_REVIEW,
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];
    if (!allowedStatuses.includes(store.status)) {
      throw new ForbiddenException(
        `Cannot manage collections on a store with status ${store.status}. Submit your store for review first.`,
      );
    }
  }

  private async assertCollectionBelongsToStore(
    collectionId: string,
    storeId: string,
  ) {
    const collection = await this.prisma.storeCollection.findUnique({
      where: { id: collectionId },
      select: { id: true, storeId: true },
    });
    if (!collection || collection.storeId !== storeId) {
      throw new NotFoundException('Collection not found');
    }
    return collection;
  }

  private async generateUniqueSlug(
    storeId: string,
    name: string,
  ): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.storeCollection.findUnique({
        where: { storeId_slug: { storeId, slug: candidate } },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }

    return candidate;
  }
}
