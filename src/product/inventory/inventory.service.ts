import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';

/**
 * InventoryService — low-stock visibility for the merchant dashboard.
 *
 * Independent-SKU stock model (same rule as carts): a product WITH variants
 * is judged per-variant (its bare totalStock is ignored); a product without
 * variants is judged on totalStock. "Available" is always net of
 * reservedStock, so items sitting in buyers' carts already count as gone.
 * The threshold is Product.lowStockThreshold (default 5) and applies to each
 * variant individually.
 */

export interface LowStockVariant {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  reservedStock: number;
  availableStock: number;
}

export interface LowStockItem {
  productId: string;
  title: string;
  status: ProductStatus;
  primaryImageUrl: string | null;
  lowStockThreshold: number;
  /** For variant products: the sum of LOW variants' availability. */
  availableStock: number;
  hasVariants: boolean;
  /** Only the variants at/below threshold (empty for bare products). */
  lowVariants: LowStockVariant[];
}

export interface LowStockResponse {
  items: LowStockItem[];
  count: number;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async getLowStock(userId: string, storeId: string): Promise<LowStockResponse> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to view inventory for this store',
      );
    }

    // Sellable statuses only — DRAFT/ARCHIVED stock is not an operational alarm.
    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        status: { in: [ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        totalStock: true,
        reservedStock: true,
        lowStockThreshold: true,
        variants: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock: true,
            reservedStock: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        images: {
          where: { isPrimary: true },
          take: 1,
          select: { url: true },
        },
      },
    });

    const items: LowStockItem[] = [];

    for (const p of products) {
      if (p.variants.length > 0) {
        const lowVariants = p.variants
          .map((v) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            stock: v.stock,
            reservedStock: v.reservedStock,
            availableStock: Math.max(0, v.stock - v.reservedStock),
          }))
          .filter((v) => v.availableStock <= p.lowStockThreshold);

        if (lowVariants.length > 0) {
          items.push({
            productId: p.id,
            title: p.title,
            status: p.status,
            primaryImageUrl: p.images[0]?.url ?? null,
            lowStockThreshold: p.lowStockThreshold,
            availableStock: lowVariants.reduce(
              (sum, v) => sum + v.availableStock,
              0,
            ),
            hasVariants: true,
            lowVariants,
          });
        }
      } else {
        const available = Math.max(0, p.totalStock - p.reservedStock);
        if (available <= p.lowStockThreshold) {
          items.push({
            productId: p.id,
            title: p.title,
            status: p.status,
            primaryImageUrl: p.images[0]?.url ?? null,
            lowStockThreshold: p.lowStockThreshold,
            availableStock: available,
            hasVariants: false,
            lowVariants: [],
          });
        }
      }
    }

    items.sort((a, b) => a.availableStock - b.availableStock);

    return { items, count: items.length };
  }
}
