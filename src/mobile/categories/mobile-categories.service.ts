import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GenderParam } from '../common/gender';
import { toCategoryChip } from '../common/serializers';

@Injectable()
export class MobileCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Top-level admin-created categories for the Home chip rail + Shop grid.
   * `genderType` is accepted but does not filter yet — nuwa categories are a
   * single (ungendered) admin tree in v1. When a gendered taxonomy lands, the
   * filter slots in here without changing the response shape.
   */
  async list(_genderType?: GenderParam) {
    const categories = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    });

    return {
      categories: categories.map((c) => toCategoryChip(c, c._count.products)),
    };
  }
}
