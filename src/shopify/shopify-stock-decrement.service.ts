import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyTokenService } from './shopify-token.service';

const ADJUST_MUTATION = `
  mutation SyncDecrement($input: InventoryAdjustQuantitiesInput!) {
    inventoryAdjustQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

/**
 * ShopifyStockDecrementService — the compliant double-sell prevention
 * (foundation §2.5): when a YIIVA order is paid, decrement the merchant's
 * Shopify stock via inventoryAdjustQuantities so the same unit can't sell
 * twice. No Shopify order is created (external-checkout policy).
 *
 * Fired from PaystackWebhookService alongside shipment booking — OUTSIDE the
 * DB transaction, best-effort, all failures logged and swallowed (the daily
 * reconcile does NOT repair a missed decrement — it would just read the
 * un-decremented Shopify quantity back; a persistent failure here shows up
 * in logs and, worst case, as a Shopify oversell the merchant resolves).
 *
 * Idempotency rides on the caller: the payment webhook's CAS guarantees the
 * CONFIRMED transition (and this hook) fires once per order.
 */
@Injectable()
export class ShopifyStockDecrementService {
  private readonly logger = new Logger(ShopifyStockDecrementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
    private readonly client: ShopifyClient,
    private readonly tokens: ShopifyTokenService,
  ) {}

  /** Never throws. No-op for stores without an active Shopify connection. */
  async decrementForOrder(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          storeId: true,
          items: {
            select: { productId: true, variantId: true, quantity: true },
          },
        },
      });
      if (!order) return;

      const connection = await this.prisma.shopifyConnection.findFirst({
        where: { storeId: order.storeId, status: 'ACTIVE' },
      });
      if (!connection) return; // store isn't Shopify-connected — nothing to do
      if (!connection.primaryLocationId) {
        this.logger.warn(
          `Order ${orderId}: store has a Shopify connection but no primary location recorded — stock NOT decremented (re-import to capture locations)`,
        );
        return;
      }

      const changes: {
        delta: number;
        inventoryItemId: string;
        locationId: string;
      }[] = [];
      for (const item of order.items) {
        const link = await this.prisma.shopifyProductLink.findFirst({
          where: item.variantId
            ? { connectionId: connection.id, variantId: item.variantId }
            : {
                connectionId: connection.id,
                productId: item.productId,
                variantId: null,
              },
          select: { inventoryItemId: true },
        });
        if (!link?.inventoryItemId) continue; // unlinked item (manual add) — skip
        changes.push({
          delta: -item.quantity,
          inventoryItemId: `gid://shopify/InventoryItem/${link.inventoryItemId}`,
          locationId: `gid://shopify/Location/${connection.primaryLocationId}`,
        });
      }
      if (changes.length === 0) return;

      const accessToken = await this.tokens.getTokenFor(connection);
      const res = await this.client.graphql<{
        inventoryAdjustQuantities: {
          userErrors: { field: string[] | null; message: string }[];
        };
      }>(connection.shopDomain, accessToken, ADJUST_MUTATION, {
        input: {
          reason: 'correction',
          name: 'available',
          changes,
        },
      });

      const errors = res.inventoryAdjustQuantities.userErrors;
      if (errors.length > 0) {
        this.logger.error(
          `Shopify stock decrement rejected for order ${orderId} (${connection.shopDomain}): ${errors[0].message}`,
        );
        return;
      }
      this.logger.log(
        `Shopify stock decremented for order ${orderId}: ${changes.length} item(s) on ${connection.shopDomain}`,
      );
    } catch (err) {
      this.logger.error(
        `Shopify stock decrement failed for order ${orderId}: ${(err as Error).message} — order flow unaffected`,
      );
    }
  }
}
