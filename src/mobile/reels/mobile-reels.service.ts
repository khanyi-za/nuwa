import { Injectable } from '@nestjs/common';
import { MediaType, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paginated } from '../common/paginated';
import { decodeOffsetCursor, encodeOffsetCursor } from '../common/cursor';
import { ReelsQueryDto } from './dto/reels-query.dto';

/**
 * Product reels — the dynamic feed that replaced maya's static fixtures
 * (lib/reels-fixtures.ts, Phase 1). One reel per VIDEO product image on an
 * ACTIVE product in an ACTIVE store; the wire shape deliberately mirrors the
 * fixture interface so the maya UI needed no reshaping:
 *   { id, video, productId, productName, description, priceInCents,
 *     merchant { username, displayName, logo } }
 *
 * Ordering: newest video first (stable offset-cursor pagination). An empty
 * result is a legitimate state — stores without product videos simply don't
 * appear, and maya hides the reels surfaces when the feed is empty.
 */
@Injectable()
export class MobileReelsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ReelsQueryDto) {
    const limit = query.limit ?? 20;
    const offset = query.cursor ? decodeOffsetCursor(query.cursor) : 0;

    const rows = await this.prisma.productImage.findMany({
      where: {
        mediaType: MediaType.VIDEO,
        product: {
          status: ProductStatus.ACTIVE,
          store: { status: StoreStatus.ACTIVE },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        url: true,
        product: {
          select: {
            id: true,
            title: true,
            description: true,
            priceInCents: true,
            store: { select: { slug: true, displayName: true, logoUrl: true } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const reels = page.map((row) => ({
      id: row.id,
      video: row.url,
      productId: row.product.id,
      productName: row.product.title,
      description: row.product.description ?? '',
      priceInCents: row.product.priceInCents,
      merchant: {
        username: row.product.store.slug,
        displayName: row.product.store.displayName,
        logo: row.product.store.logoUrl ?? '',
      },
    }));

    return new Paginated(
      { reels },
      {
        limit,
        hasMore,
        nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
      },
    );
  }
}
