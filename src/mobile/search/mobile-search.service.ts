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
   * Fire-and-forget search analytics → AnalyticsEvent (eventType 'search').
   * Phalo consumes these for relevance tuning + "top searches" reports.
   */
  async track(dto: TrackSearchDto, userId?: string) {
    await this.prisma.analyticsEvent.create({
      data: {
        eventType: 'search',
        userId: userId ?? null,
        metadata: {
          q: dto.q,
          genderType: dto.genderType ?? null,
          resultCount: dto.resultCount ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return { recorded: true };
  }
}
