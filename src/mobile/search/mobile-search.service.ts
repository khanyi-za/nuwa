import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto';
import { TrackSearchDto } from './dto/track-search.dto';

@Injectable()
export class MobileSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trending search terms + (deferred) autocomplete. v1 trending = top `Tag`s by
   * `usageCount`, surfaced as `#TagName`. This is a Phalo seam — the future
   * engine replaces it with real "top searches this week" (see
   * phalo-smart-engine memory). `suggestions[]` (autocomplete for `q`) is
   * deferred — maya's UI doesn't consume it yet.
   */
  async suggestions(_dto: SuggestionsQueryDto) {
    const tags = await this.prisma.tag.findMany({
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      take: 10,
      select: { name: true },
    });
    return {
      trending: tags.map((t) => `#${t.name}`),
      suggestions: [] as string[],
    };
  }

  /**
   * Fire-and-forget search analytics → AnalyticsEvent. Two variants:
   * - settled query → 'search' (q, genderType, resultCount)
   * - result-card tap → 'search_click' (q, productId, position) — the ranking
   *   feedback signal Phalo trains on (phalo-search.md S2: CTR@10, click
   *   position distribution).
   */
  async track(dto: TrackSearchDto, userId?: string) {
    const isClick = !!dto.clickedProductId;
    await this.prisma.analyticsEvent.create({
      data: {
        eventType: isClick ? 'search_click' : 'search',
        userId: userId ?? null,
        productId: dto.clickedProductId ?? null,
        metadata: {
          q: dto.q,
          genderType: dto.genderType ?? null,
          ...(isClick
            ? { position: dto.position ?? null }
            : { resultCount: dto.resultCount ?? null }),
        } as Prisma.InputJsonValue,
      },
    });
    return { recorded: true };
  }
}
