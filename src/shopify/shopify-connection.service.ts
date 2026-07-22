import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { decryptToken, encryptToken } from './token-crypto';
import { ConnectShopifyDto } from './dto/connect-shopify.dto';

/**
 * ShopifyConnectionService — links a YIIVA merchant to their Shopify shop
 * (onboarding step 1 of the import wizard).
 *
 * connect() validates the token LIVE (shop query) before storing anything,
 * so a saved connection is always a working one at save time. Tokens are
 * AES-256-GCM encrypted at rest. One connection per shop domain (re-connect
 * updates the token in place); one active connection per user in v1.
 *
 * ⚠ Currency: YIIVA is ZAR-only. A non-ZAR shop can connect (we surface the
 * currency in the preview) but import will refuse it — prices can't be
 * converted honestly.
 */
@Injectable()
export class ShopifyConnectionService {
  private readonly logger = new Logger(ShopifyConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
    private readonly client: ShopifyClient,
  ) {}

  async connect(userId: string, dto: ConnectShopifyDto) {
    const shopDomain = this.normalizeDomain(dto.shopDomain);

    // Validate live BEFORE storing — also produces the wizard preview.
    const info = await this.client.fetchShopInfo(shopDomain, dto.accessToken);

    // The shop reports its own canonical domain — trust that over user input.
    const canonicalDomain = info.myshopifyDomain.toLowerCase();

    const existing = await this.prisma.shopifyConnection.findUnique({
      where: { shopDomain: canonicalDomain },
      select: { id: true, userId: true },
    });
    if (existing && existing.userId !== userId) {
      // Someone else already connected this shop — likely a mistake or a
      // handover; either way it needs ops, not a silent takeover.
      throw new BadRequestException({
        code: 'SHOP_ALREADY_CONNECTED',
        message:
          'This Shopify store is already connected to a different YIIVA account. Contact support.',
      });
    }

    const encryptedToken = encryptToken(dto.accessToken, this.config.tokenKey);

    const connection = await this.prisma.shopifyConnection.upsert({
      where: { shopDomain: canonicalDomain },
      create: {
        userId,
        shopDomain: canonicalDomain,
        encryptedToken,
        shopName: info.name,
        currencyCode: info.currencyCode,
        status: 'ACTIVE',
      },
      update: {
        encryptedToken,
        shopName: info.name,
        currencyCode: info.currencyCode,
        status: 'ACTIVE',
      },
    });

    this.logger.log(
      `Shopify connected: ${canonicalDomain} (user=${userId}, products=${info.productsCount})`,
    );

    return this.toView(connection, info.productsCount, info.primaryDomain);
  }

  async getMine(userId: string) {
    const connection = await this.prisma.shopifyConnection.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!connection) {
      throw new NotFoundException({
        code: 'NO_SHOPIFY_CONNECTION',
        message: 'No Shopify store connected',
      });
    }
    return this.toView(connection);
  }

  /**
   * The user's active connection WITH the decrypted Admin token — internal
   * use only (catalogue pull / import executor). Never expose the token in
   * any HTTP response.
   */
  async getActiveWithToken(userId: string) {
    const connection = await this.prisma.shopifyConnection.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        shopDomain: true,
        encryptedToken: true,
        currencyCode: true,
        storeId: true,
      },
    });
    if (!connection) {
      throw new NotFoundException({
        code: 'NO_SHOPIFY_CONNECTION',
        message: 'No Shopify store connected',
      });
    }
    return {
      id: connection.id,
      shopDomain: connection.shopDomain,
      currencyCode: connection.currencyCode,
      storeId: connection.storeId,
      accessToken: decryptToken(connection.encryptedToken, this.config.tokenKey),
    };
  }

  async disconnect(userId: string) {
    const connection = await this.prisma.shopifyConnection.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, shopDomain: true },
    });
    if (!connection) {
      throw new NotFoundException({
        code: 'NO_SHOPIFY_CONNECTION',
        message: 'No Shopify store connected',
      });
    }
    await this.prisma.shopifyConnection.update({
      where: { id: connection.id },
      data: { status: 'DISCONNECTED' },
    });
    this.logger.log(`Shopify disconnected: ${connection.shopDomain}`);
    return { disconnected: true };
  }

  /**
   * "brand", "brand.myshopify.com", "https://brand.myshopify.com/x" →
   * "brand.myshopify.com". Custom domains are rejected — the Admin API only
   * lives on the myshopify host.
   */
  private normalizeDomain(raw: string): string {
    let d = raw.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').split('/')[0];
    if (!d.includes('.')) d = `${d}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) {
      throw new BadRequestException({
        code: 'INVALID_SHOP_DOMAIN',
        message:
          "Enter the store's myshopify.com domain (Shopify admin URL), not the public website domain.",
      });
    }
    return d;
  }

  private toView(
    c: {
      id: string;
      shopDomain: string;
      shopName: string | null;
      currencyCode: string | null;
      storeId: string | null;
      createdAt: Date;
    },
    productsCount?: number,
    primaryDomain?: string | null,
  ) {
    return {
      id: c.id,
      shopDomain: c.shopDomain,
      shopName: c.shopName,
      currencyCode: c.currencyCode,
      currencySupported: c.currencyCode === 'ZAR',
      linkedStoreId: c.storeId,
      connectedAt: c.createdAt,
      ...(productsCount !== undefined ? { productsCount } : {}),
      ...(primaryDomain !== undefined ? { websiteDomain: primaryDomain } : {}),
    };
  }
}
