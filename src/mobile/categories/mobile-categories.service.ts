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
        // Gender-aware card imagery: on a gendered call the chip image becomes
        // the newest matching product's primary image (women tab → a women's/
        // unisex shot, men tab → men's/unisex), so switching tabs visibly
        // changes the cards. The seeded Category.imageUrl stays the fallback
        // and serves ungendered surfaces (brand-page rail) unchanged.
        ...(productScope
          ? {
              products: {
                where: productScope,
                take: 1,
                orderBy: { product: { createdAt: 'desc' as const } },
                select: {
                  product: {
                    select: {
                      images: {
                        orderBy: [
                          { isPrimary: 'desc' as const },
                          { sortOrder: 'asc' as const },
                        ],
                        take: 1,
                        select: { url: true },
                      },
                    },
                  },
                },
              },
            }
          : {}),
        _count: {
          select: { products: productScope ? { where: productScope } : true },
        },
      },
    });

    return {
      categories: categories.map((c) => {
        // The conditional spread hides the nested select from Prisma's type
        // inference — narrow the row shape manually.
        const genderCover = (
          c as unknown as {
            products?: { product: { images: { url: string }[] } }[];
          }
        ).products?.[0]?.product.images[0]?.url;
        return toCategoryChip(
          { ...c, imageUrl: genderCover ?? c.imageUrl },
          c._count.products,
        );
      }),
    };
  }
}
