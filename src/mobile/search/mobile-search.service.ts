import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, ProductStatus, StoreStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SuggestionsQueryDto } from './dto/suggestions-query.dto';
import { TrackSearchDto } from './dto/track-search.dto';

/**
 * Candidate vocabulary for the "Trending" chips — searches a buyer would
 * actually type on a fashion marketplace. Only terms that currently match
 * enough live products are served (so every chip lands on results), and the
 * top brand names are blended in dynamically.
 */
const TRENDING_VOCABULARY = [
  'linen',
  'summer dress',
  'maxi dress',
  'oversized hoodie',
  'cargo pants',
  'denim',
  'two piece set',
  'matching set',
  'crop top',
  'knitwear',
  'crochet',
  'gold jewellery',
  'sneakers',
  'streetwear',
  'graphic tee',
  'trench coat',
  'puffer jacket',
  'winter coat',
  'wide leg',
  'corset',
  'swimwear',
  'bucket hat',
  'tote bag',
  'leather',
  'cardigan',
  'athleisure',
  'handmade',
  'shirt dress',
];

/** A candidate must match at least this many live products to be served. */
const TRENDING_MIN_MATCHES = 3;
/** Number of chips served to the client. */
const TRENDING_TAKE = 8;
/** Catalogue-validation results are cached in-process for an hour. */
const TRENDING_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class MobileSearchService {
  constructor(private readonly prisma: PrismaService) {}

  private trendingCache?: { at: number; day: string; terms: string[] };

  /**
   * Trending search terms + (deferred) autocomplete. v1 trending = curated
   * realistic search vocabulary + top brand names, validated against the live
   * catalogue and rotated daily. This is a Phalo seam — the future engine
   * replaces it with real "top searches this week" from the search
   * AnalyticsEvents (see phalo-smart-engine memory). `suggestions[]`
   * (autocomplete for `q`) is deferred — maya's UI doesn't consume it yet.
   */
  async suggestions(_dto: SuggestionsQueryDto) {
    return {
      trending: await this.trendingTerms(),
      suggestions: [] as string[],
    };
  }

  private async trendingTerms(): Promise<string[]> {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    if (
      this.trendingCache &&
      this.trendingCache.day === day &&
      now - this.trendingCache.at < TRENDING_CACHE_TTL_MS
    ) {
      return this.trendingCache.terms;
    }

    const topStores = await this.prisma.store.findMany({
      where: { status: StoreStatus.ACTIVE },
      orderBy: { followerCount: 'desc' },
      take: 3,
      select: { displayName: true },
    });
    const candidates = [
      ...topStores.map((s) => s.displayName),
      ...TRENDING_VOCABULARY,
    ];

    // Brand names go through the same gate as vocabulary terms, so an ACTIVE
    // store with no live products never surfaces as a dead chip.
    const counts = await Promise.all(
      candidates.map((term) =>
        this.prisma.product.count({ where: this.matchesWhere(term) }),
      ),
    );

    // Daily-seeded shuffle: the qualifying pool is stable, but the served
    // slice rotates each day so the section doesn't feel frozen.
    const terms = candidates
      .filter((_, i) => counts[i] >= TRENDING_MIN_MATCHES)
      .map((term) => ({
        term,
        key: createHash('sha1').update(`${day}:${term}`).digest('hex'),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, TRENDING_TAKE)
      .map((t) => t.term);

    this.trendingCache = { at: now, day, terms };
    return terms;
  }

  /**
   * Mirrors `MobileProductsService.searchUniversal`'s match rule (title /
   * brand / category / tag contains, live products only) — a term qualifies
   * as trending iff tapping its chip would return these products.
   */
  private matchesWhere(term: string): Prisma.ProductWhereInput {
    return {
      status: ProductStatus.ACTIVE,
      store: { status: StoreStatus.ACTIVE },
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { store: { displayName: { contains: term, mode: 'insensitive' } } },
        {
          categories: {
            some: { category: { name: { contains: term, mode: 'insensitive' } } },
          },
        },
        { tags: { some: { tag: { name: { contains: term, mode: 'insensitive' } } } } },
      ],
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
