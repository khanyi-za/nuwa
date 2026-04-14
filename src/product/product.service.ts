import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StoreStatus, ProductStatus, MediaType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { CategoryService } from './category/category.service';
import { slugify } from './utils/slugify';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly categoryService: CategoryService,
  ) {}

  async create(userId: string, storeId: string, dto: CreateProductDto) {
    await this.assertCanMutateProducts(userId, storeId);

    const slug = await this.generateUniqueSlug(storeId, dto.title);

    return this.prisma.product.create({
      data: {
        storeId,
        title: dto.title.trim(),
        slug,
        description: dto.description?.trim(),
        priceInCents: dto.priceInCents,
        comparePriceInCents: dto.comparePriceInCents,
        sku: dto.sku?.trim(),
        totalStock: dto.totalStock ?? 0,
        status: ProductStatus.DRAFT,
      },
    });
  }

  async update(
    userId: string,
    storeId: string,
    productId: string,
    dto: UpdateProductDto,
  ) {
    await this.assertCanMutateProducts(userId, storeId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, status: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    if (product.status === ProductStatus.ARCHIVED) {
      throw new ConflictException(
        'Cannot update an archived product. Create a new product instead.',
      );
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        title: dto.title?.trim(),
        description: dto.description?.trim(),
        priceInCents: dto.priceInCents,
        comparePriceInCents: dto.comparePriceInCents,
        sku: dto.sku?.trim(),
        totalStock: dto.totalStock,
      },
    });
  }

  async activate(userId: string, storeId: string, productId: string) {
    await this.assertCanMutateProducts(userId, storeId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        _count: {
          select: {
            images: { where: { mediaType: MediaType.IMAGE } },
            categories: true,
          },
        },
        variants: { select: { priceInCents: true, stock: true } },
      },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    if (product.status === ProductStatus.ACTIVE) {
      return product;
    }

    if (product.status === ProductStatus.ARCHIVED) {
      throw new ConflictException(
        'Cannot activate an archived product.',
      );
    }

    const errors: string[] = [];

    if (!product.title || product.title.length < 2) {
      errors.push('Product title must be at least 2 characters');
    }

    if (product.priceInCents <= 0) {
      errors.push('Price must be greater than zero');
    }

    if (product._count.images < 1) {
      errors.push('Product must have at least one image');
    }

    if (product._count.categories < 1) {
      errors.push('Product must be linked to at least one platform category');
    }

    if (product.variants.length > 0) {
      const hasInvalidPrice = product.variants.some(
        (v) => v.priceInCents !== null && v.priceInCents <= 0,
      );
      if (hasInvalidPrice) {
        errors.push('All variant price overrides must be greater than zero');
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors);
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        status: ProductStatus.ACTIVE,
        publishedAt: new Date(),
      },
    });
  }

  async archive(userId: string, storeId: string, productId: string) {
    await this.assertCanMutateProducts(userId, storeId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, status: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    if (product.status === ProductStatus.ARCHIVED) {
      return product;
    }

    if (product.status === ProductStatus.DRAFT) {
      throw new ConflictException(
        'Cannot archive a draft product. Delete it instead.',
      );
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: { status: ProductStatus.ARCHIVED },
    });
  }

  async delete(userId: string, storeId: string, productId: string) {
    await this.assertCanMutateProducts(userId, storeId);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true, status: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    if (product.status !== ProductStatus.DRAFT) {
      throw new ConflictException(
        'Only draft products can be deleted. Use archive to remove a live product.',
      );
    }

    await this.prisma.product.delete({ where: { id: productId } });
    return { success: true };
  }

  async listProducts(userId: string, storeId: string, dto: ListProductsDto) {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }

    const where: Prisma.ProductWhereInput = { storeId };

    if (dto.status && dto.status !== 'all') {
      where.status = dto.status as ProductStatus;
    }

    if (dto.search) {
      where.OR = [
        { title: { contains: dto.search, mode: 'insensitive' } },
        { sku: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    if (dto.categoryId) {
      where.categories = { some: { categoryId: dto.categoryId } };
    }

    if (dto.collectionId) {
      where.collections = { some: { collectionId: dto.collectionId } };
    }

    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      newest: { createdAt: 'desc' },
      oldest: { createdAt: 'asc' },
      nameAsc: { title: 'asc' },
      nameDesc: { title: 'desc' },
      priceAsc: { priceInCents: 'asc' },
      priceDesc: { priceInCents: 'desc' },
      stockAsc: { totalStock: 'asc' },
    };
    const orderBy = sortMap[dto.sortBy ?? 'newest'];

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          priceInCents: true,
          comparePriceInCents: true,
          totalStock: true,
          createdAt: true,
          _count: {
            select: {
              images: true,
              variants: true,
              categories: true,
            },
          },
          images: {
            where: { isPrimary: true },
            select: { url: true, altText: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPublicProduct(storeSlug: string, productSlug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug: storeSlug },
      select: { id: true, status: true, displayName: true, slug: true, logoUrl: true, followerCount: true },
    });
    if (!store || store.status !== StoreStatus.ACTIVE) {
      throw new NotFoundException('Store not found');
    }

    const product = await this.prisma.product.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: productSlug } },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        status: true,
        priceInCents: true,
        comparePriceInCents: true,
        totalStock: true,
        publishedAt: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            url: true,
            altText: true,
            mediaType: true,
            sortOrder: true,
            isPrimary: true,
          },
        },
        variants: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            color: true,
            size: true,
            material: true,
            priceInCents: true,
            stock: true,
            sortOrder: true,
          },
        },
        categories: {
          select: {
            category: { select: { id: true, name: true, slug: true } },
          },
        },
        tags: {
          select: {
            tag: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException('Product not found');
    }

    const { status: _status, ...publicFields } = product;

    return {
      ...publicFields,
      variants: product.variants.map((v) => ({
        ...v,
        effectivePriceInCents: v.priceInCents ?? product.priceInCents,
      })),
      store: {
        displayName: store.displayName,
        slug: store.slug,
        logoUrl: store.logoUrl,
        followerCount: store.followerCount,
      },
    };
  }

  async getPublicCatalog(query: CatalogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      newest: { createdAt: 'desc' },
      priceAsc: { priceInCents: 'asc' },
      priceDesc: { priceInCents: 'desc' },
    };
    const orderBy = sortMap[query.sortBy ?? 'newest'];

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.ACTIVE,
      store: { status: StoreStatus.ACTIVE },
    };

    if (query.categorySlug) {
      const category = await this.prisma.category.findUnique({
        where: { slug: query.categorySlug },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found');
      const allIds = await this.categoryService.getDescendantIds(category.id);
      where.categories = { some: { categoryId: { in: allIds } } };
    }

    if (query.tagName) {
      where.tags = { some: { tag: { name: query.tagName.trim().toLowerCase() } } };
    }

    if (query.priceMin !== undefined || query.priceMax !== undefined) {
      where.priceInCents = {
        ...(query.priceMin !== undefined ? { gte: query.priceMin } : {}),
        ...(query.priceMax !== undefined ? { lte: query.priceMax } : {}),
      };
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          priceInCents: true,
          comparePriceInCents: true,
          images: {
            where: { isPrimary: true },
            select: { url: true, altText: true },
            take: 1,
          },
          store: { select: { displayName: true, slug: true } },
        },
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getStorePublicCatalog(storeSlug: string, query: CatalogQueryDto) {
    const store = await this.prisma.store.findUnique({
      where: { slug: storeSlug },
      select: { id: true, status: true },
    });
    if (!store || store.status !== StoreStatus.ACTIVE) {
      throw new NotFoundException('Store not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const sortMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
      newest: { createdAt: 'desc' },
      priceAsc: { priceInCents: 'asc' },
      priceDesc: { priceInCents: 'desc' },
    };
    const orderBy = sortMap[query.sortBy ?? 'newest'];

    const where: Prisma.ProductWhereInput = {
      storeId: store.id,
      status: ProductStatus.ACTIVE,
    };

    if (query.collectionSlug) {
      const collection = await this.prisma.storeCollection.findUnique({
        where: { storeId_slug: { storeId: store.id, slug: query.collectionSlug } },
        select: { id: true },
      });
      if (!collection) throw new NotFoundException('Collection not found');
      where.collections = { some: { collectionId: collection.id } };
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          priceInCents: true,
          comparePriceInCents: true,
          images: {
            where: { isPrimary: true },
            select: { url: true, altText: true },
            take: 1,
          },
        },
      }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getProduct(userId: string, storeId: string, productId: string) {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { sortOrder: 'asc' } },
        categories: {
          include: { category: { select: { id: true, name: true, slug: true } } },
        },
        tags: {
          include: { tag: { select: { id: true, name: true, slug: true } } },
        },
        collections: {
          include: {
            collection: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }

    return product;
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

  private async generateUniqueSlug(
    storeId: string,
    title: string,
  ): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.product.findUnique({
        where: { storeId_slug: { storeId, slug: candidate } },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }

    return candidate;
  }
}
