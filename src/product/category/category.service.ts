import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CatalogQueryDto } from '../dto/catalog-query.dto';
import { slugify } from '../utils/slugify';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }

    const slug = await this.generateUniqueSlug(dto.name);

    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim(),
        imageUrl: dto.imageUrl,
        parentId: dto.parentId,
        sortOrder: dto.sortOrder ?? 0,
        slug,
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      const newParent = await this.prisma.category.findUnique({
        where: { id: dto.parentId },
      });
      if (!newParent) {
        throw new NotFoundException('Parent category not found');
      }
      await this.assertNoCycle(id, dto.parentId);
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        imageUrl: dto.imageUrl,
        parentId: dto.parentId,
        sortOrder: dto.sortOrder,
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async delete(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            products: true,
            storeCategories: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (category._count.children > 0) {
      throw new ConflictException(
        'Cannot delete a category that has child categories. Move or delete the children first.',
      );
    }

    if (category._count.products > 0) {
      throw new ConflictException(
        'Cannot delete a category that has products linked to it. Re-categorise the products first.',
      );
    }

    if (category._count.storeCategories > 0) {
      throw new ConflictException(
        'Cannot delete a category that stores are associated with. Remove store associations first.',
      );
    }

    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }

  async getTree() {
    const all = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        parentId: true,
        sortOrder: true,
      },
    });

    const byId = new Map<string, any>();
    all.forEach((c) => byId.set(c.id, { ...c, children: [] }));

    const roots: any[] = [];
    for (const node of byId.values()) {
      if (node.parentId) {
        const parent = byId.get(node.parentId);
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async getProductsByCategory(slug: string, query: CatalogQueryDto) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, description: true, imageUrl: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const allCategoryIds = await this.getDescendantIds(category.id);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const sortMap: Record<string, any> = {
      newest: { createdAt: 'desc' },
      priceAsc: { priceInCents: 'asc' },
      priceDesc: { priceInCents: 'desc' },
    };
    const orderBy = sortMap[query.sortBy ?? 'newest'];

    const where = {
      status: ProductStatus.ACTIVE,
      store: { status: StoreStatus.ACTIVE },
      categories: { some: { categoryId: { in: allCategoryIds } } },
    };

    const [total, products] = await this.prisma.$transaction([
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
      category,
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDescendantIds(categoryId: string): Promise<string[]> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });

    const childrenMap = new Map<string, string[]>();
    for (const c of all) {
      if (c.parentId) {
        const siblings = childrenMap.get(c.parentId) ?? [];
        siblings.push(c.id);
        childrenMap.set(c.parentId, siblings);
      }
    }

    const result: string[] = [categoryId];
    const queue = [categoryId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = childrenMap.get(current) ?? [];
      for (const child of children) {
        result.push(child);
        queue.push(child);
      }
    }

    return result;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    let candidate = base;
    let suffix = 2;

    while (await this.prisma.category.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }

    return candidate;
  }

  private async assertNoCycle(categoryId: string, newParentId: string): Promise<void> {
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === categoryId) {
        throw new BadRequestException('Reparenting would create a cycle');
      }
      const node = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = node?.parentId ?? null;
    }
  }
}
