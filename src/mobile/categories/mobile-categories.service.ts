import { Injectable } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GenderParam, genderFilterValues } from '../common/gender';
import { toCategoryChip } from '../common/serializers';

@Injectable()
export class MobileCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Top-level admin-created categories for the Home chip rail + Shop grid.
   *
   * When `genderType` is provided, only categories that contain at least one
   * ACTIVE product visible to that gender tab are returned, and productCount
   * is scoped the same way. UNISEX products surface under BOTH women and men
   * (same rule as the feed — `genderFilterValues`). Categories themselves stay
   * ungendered; tab membership derives from the products they hold, so an
   * unstocked category (e.g. eyewear before an eyewear brand onboards) simply
   * doesn't render a chip yet.
   */
  async list(genderType?: GenderParam) {
    const productScope = genderType
      ? {
          product: {
            status: ProductStatus.ACTIVE,
            genderType: { in: genderFilterValues(genderType) },
          },
        }
      : undefined;

    const categories = await this.prisma.category.findMany({
      where: {
        parentId: null,
        ...(productScope ? { products: { some: productScope } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        imageUrl: true,
        sortOrder: true,
        _count: {
          select: { products: productScope ? { where: productScope } : true },
        },
      },
    });

    return {
      categories: categories.map((c) => toCategoryChip(c, c._count.products)),
    };
  }
}
