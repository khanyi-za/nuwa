import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  ProductStatus,
  SaleCampaignStatus,
  StoreStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { CreateSaleCampaignDto } from '../dto/create-sale-campaign.dto';

/**
 * SaleCampaignService — catalogue sales ("run a sale on these products").
 *
 * Applying a campaign discounts each product's priceInCents (and any variant
 * price overrides) and parks the original on comparePriceInCents, so every
 * buyer surface renders the strikethrough automatically. Ending it restores
 * the originals — but ONLY where the current price still equals the sale
 * price; if the merchant hand-edited a price mid-sale, their edit wins and we
 * leave that product alone (never clobber manual control).
 *
 * Checkout money math is untouched: buyers simply pay the (discounted)
 * priceInCents like any other price. Promo codes are a separate future
 * feature on the Promotion model.
 */

const MIN_SALE_PRICE_CENTS = 100; // R1 floor — a sale can't make items free
const MAX_PERCENTAGE = 90;

interface VariantPriceSnapshot {
  variantId: string;
  priceInCents: number;
}

@Injectable()
export class SaleCampaignService {
  private readonly logger = new Logger(SaleCampaignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  async list(userId: string, storeId: string) {
    await this.assertCanManage(userId, storeId);

    const campaigns = await this.prisma.saleCampaign.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        status: true,
        startsAt: true,
        endsAt: true,
        endedAt: true,
        createdAt: true,
        _count: { select: { products: true } },
      },
    });

    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        discountType: c.discountType,
        discountValue: c.discountValue,
        status: c.status,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        endedAt: c.endedAt,
        createdAt: c.createdAt,
        productCount: c._count.products,
      })),
    };
  }

  async getDetail(userId: string, storeId: string, campaignId: string) {
    await this.assertCanManage(userId, storeId);

    const campaign = await this.prisma.saleCampaign.findUnique({
      where: { id: campaignId },
      include: {
        products: {
          include: {
            product: { select: { id: true, title: true, priceInCents: true } },
          },
        },
      },
    });

    if (!campaign || campaign.storeId !== storeId) {
      throw new NotFoundException('Sale campaign not found');
    }

    return {
      id: campaign.id,
      name: campaign.name,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      endedAt: campaign.endedAt,
      products: campaign.products.map((cp) => ({
        productId: cp.product.id,
        title: cp.product.title,
        originalPriceInCents: cp.originalPriceInCents,
        salePriceInCents: cp.salePriceInCents,
        currentPriceInCents: cp.product.priceInCents,
      })),
    };
  }

  // ─── Create + apply ──────────────────────────────────────────────────────

  async create(userId: string, storeId: string, dto: CreateSaleCampaignDto) {
    await this.assertCanManage(userId, storeId);
    this.validateDiscount(dto);

    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt <= new Date()) {
      throw new BadRequestException('endsAt must be in the future');
    }

    const productIds = [...new Set(dto.productIds)];

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, storeId },
      select: {
        id: true,
        title: true,
        status: true,
        priceInCents: true,
        comparePriceInCents: true,
        variants: { select: { id: true, priceInCents: true } },
      },
    });

    if (products.length !== productIds.length) {
      throw new NotFoundException(
        'One or more products were not found in this store',
      );
    }

    const notActive = products.filter((p) => p.status !== ProductStatus.ACTIVE);
    if (notActive.length > 0) {
      throw new BadRequestException(
        `Only ACTIVE products can go on sale. Not active: ${notActive
          .map((p) => p.title)
          .join(', ')}`,
      );
    }

    // One live sale per product — overlapping discounts would corrupt the
    // original-price snapshots.
    const alreadyOnSale = await this.prisma.saleCampaignProduct.findMany({
      where: {
        productId: { in: productIds },
        campaign: { status: SaleCampaignStatus.ACTIVE },
      },
      select: { productId: true },
    });
    if (alreadyOnSale.length > 0) {
      throw new ConflictException(
        'Some selected products are already in an active sale. End that sale first.',
      );
    }

    // Compute sale prices up front so validation fails before any write.
    const plans = products.map((p) => {
      const salePrice = this.discounted(p.priceInCents, dto);
      if (salePrice < MIN_SALE_PRICE_CENTS) {
        throw new BadRequestException(
          `Discount would price "${p.title}" below R1. Reduce the discount.`,
        );
      }
      const variantOverrides: VariantPriceSnapshot[] = p.variants
        .filter((v) => v.priceInCents !== null)
        .map((v) => ({ variantId: v.id, priceInCents: v.priceInCents! }));
      for (const v of variantOverrides) {
        if (this.discounted(v.priceInCents, dto) < MIN_SALE_PRICE_CENTS) {
          throw new BadRequestException(
            `Discount would price a variant of "${p.title}" below R1. Reduce the discount.`,
          );
        }
      }
      return { product: p, salePrice, variantOverrides };
    });

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.saleCampaign.create({
        data: {
          storeId,
          name: dto.name.trim(),
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          endsAt,
          products: {
            create: plans.map(({ product, salePrice, variantOverrides }) => ({
              productId: product.id,
              originalPriceInCents: product.priceInCents,
              originalComparePriceInCents: product.comparePriceInCents,
              salePriceInCents: salePrice,
              originalVariantPrices:
                variantOverrides.length > 0
                  ? (variantOverrides as unknown as Prisma.InputJsonValue)
                  : undefined,
            })),
          },
        },
        select: { id: true, name: true, status: true },
      });

      for (const { product, salePrice, variantOverrides } of plans) {
        await tx.product.update({
          where: { id: product.id },
          data: {
            priceInCents: salePrice,
            comparePriceInCents: product.priceInCents,
          },
        });
        for (const v of variantOverrides) {
          await tx.productVariant.update({
            where: { id: v.variantId },
            data: { priceInCents: this.discounted(v.priceInCents, dto) },
          });
        }
      }

      return created;
    });

    return { ...campaign, productCount: plans.length };
  }

  // ─── End ─────────────────────────────────────────────────────────────────

  async endCampaign(userId: string, storeId: string, campaignId: string) {
    await this.assertCanManage(userId, storeId);

    const campaign = await this.prisma.saleCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, storeId: true, status: true },
    });
    if (!campaign || campaign.storeId !== storeId) {
      throw new NotFoundException('Sale campaign not found');
    }
    if (campaign.status !== SaleCampaignStatus.ACTIVE) {
      throw new BadRequestException('Sale campaign is already ended');
    }

    await this.restoreAndEnd(campaignId);
    return { id: campaignId, status: SaleCampaignStatus.ENDED };
  }

  /** Cron sweep: auto-end ACTIVE campaigns whose endsAt has passed. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpired(): Promise<void> {
    const expired = await this.prisma.saleCampaign.findMany({
      where: {
        status: SaleCampaignStatus.ACTIVE,
        endsAt: { not: null, lte: new Date() },
      },
      select: { id: true, name: true },
    });

    for (const campaign of expired) {
      try {
        await this.restoreAndEnd(campaign.id);
        this.logger.log(`Sale campaign auto-ended: ${campaign.name}`);
      } catch (err) {
        this.logger.error(
          `Failed to auto-end sale campaign ${campaign.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async restoreAndEnd(campaignId: string): Promise<void> {
    const rows = await this.prisma.saleCampaignProduct.findMany({
      where: { campaignId },
      include: {
        product: { select: { id: true, priceInCents: true } },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        // Merchant hand-edits mid-sale win — only restore untouched prices.
        if (row.product.priceInCents === row.salePriceInCents) {
          await tx.product.update({
            where: { id: row.productId },
            data: {
              priceInCents: row.originalPriceInCents,
              comparePriceInCents: row.originalComparePriceInCents,
            },
          });
        }

        const snapshots =
          (row.originalVariantPrices as unknown as VariantPriceSnapshot[]) ??
          [];
        for (const snap of snapshots) {
          await tx.productVariant.updateMany({
            where: { id: snap.variantId },
            data: { priceInCents: snap.priceInCents },
          });
        }
      }

      await tx.saleCampaign.update({
        where: { id: campaignId },
        data: { status: SaleCampaignStatus.ENDED, endedAt: new Date() },
      });
    });
  }

  private discounted(
    priceInCents: number,
    dto: Pick<CreateSaleCampaignDto, 'discountType' | 'discountValue'>,
  ): number {
    if (dto.discountType === 'PERCENTAGE') {
      return Math.round(priceInCents * (1 - dto.discountValue / 100));
    }
    return priceInCents - dto.discountValue;
  }

  private validateDiscount(dto: CreateSaleCampaignDto): void {
    if (dto.discountType === 'PERCENTAGE' && dto.discountValue > MAX_PERCENTAGE) {
      throw new BadRequestException(
        `Percentage discounts are capped at ${MAX_PERCENTAGE}%`,
      );
    }
  }

  private async assertCanManage(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage sales for this store',
      );
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const allowed: StoreStatus[] = [
      StoreStatus.APPROVED,
      StoreStatus.PENDING_GO_LIVE,
      StoreStatus.ACTIVE,
    ];
    if (!allowed.includes(store.status)) {
      throw new ForbiddenException(
        `Cannot run sales on a store with status ${store.status}.`,
      );
    }
  }
}
