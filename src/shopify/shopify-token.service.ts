import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { decryptToken, encryptToken } from './token-crypto';

/**
 * ShopifyTokenService — single source of Admin API access tokens.
 *
 * Two connection kinds live behind one door:
 * - LEGACY (clientId null): `encryptedToken` is a permanent shpat_ token
 *   from a pre-2026 in-admin custom app. Returned as-is.
 * - CLIENT CREDENTIALS (clientId set): Dev Dashboard apps only issue ~24h
 *   tokens via the client-credentials grant. `encryptedToken` caches the
 *   current one; when it's within REFRESH_MARGIN of `tokenExpiresAt` the
 *   service re-runs the exchange and persists the fresh token.
 *
 * Refresh is lazy (at the moment of use) — no cron, no background jobs.
 * Concurrent refreshes for the same connection are deduped in-process;
 * cross-replica races are benign (both tokens are valid; last write wins).
 */

const REFRESH_MARGIN_MS = 2 * 60 * 1000; // refresh when <2 min of life left
const EXCHANGE_TIMEOUT_MS = 10_000;

type TokenSource = {
  id: string;
  shopDomain: string;
  encryptedToken: string;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  tokenExpiresAt: Date | null;
};

@Injectable()
export class ShopifyTokenService {
  private readonly logger = new Logger(ShopifyTokenService.name);
  /** In-flight refreshes keyed by connection id — dedupes concurrent callers. */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
  ) {}

  /** A valid Admin API token for the connection, refreshing if needed. */
  async getToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.shopifyConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: {
        id: true,
        shopDomain: true,
        encryptedToken: true,
        clientId: true,
        clientSecretEncrypted: true,
        tokenExpiresAt: true,
      },
    });
    return this.getTokenFor(connection);
  }

  /** Same as getToken for callers that already hold the row's auth fields. */
  async getTokenFor(connection: TokenSource): Promise<string> {
    // Legacy permanent token — nothing to refresh, ever.
    if (!connection.clientId) {
      return decryptToken(connection.encryptedToken, this.config.tokenKey);
    }

    // Cached token still comfortably alive — use it.
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS
    ) {
      return decryptToken(connection.encryptedToken, this.config.tokenKey);
    }

    // Refresh — dedupe concurrent callers onto one exchange.
    const existing = this.inFlight.get(connection.id);
    if (existing) return existing;

    const refresh = this.refresh(connection).finally(() =>
      this.inFlight.delete(connection.id),
    );
    this.inFlight.set(connection.id, refresh);
    return refresh;
  }

  /**
   * The raw client-credentials grant — also used at connect time, where a
   * successful exchange doubles as credential validation.
   */
  async exchange(
    shopDomain: string,
    clientId: string,
    clientSecret: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      this.logger.error(`Token exchange unreachable for ${shopDomain}: ${message}`);
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_UNREACHABLE',
        message: 'Could not reach Shopify to authenticate. Try again shortly.',
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `Token exchange rejected for ${shopDomain}: HTTP ${res.status} ${body.slice(0, 300)}`,
      );
      // 4xx = bad credentials / app not installed on this shop.
      if (res.status >= 400 && res.status < 500) {
        throw new BadRequestException({
          code: 'INVALID_SHOPIFY_CREDENTIALS',
          message:
            'Shopify rejected the Client ID / Client secret. Check the credentials and that the app is installed on this store.',
        });
      }
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_UNAVAILABLE',
        message: 'Shopify authentication is temporarily unavailable. Try again shortly.',
      });
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !data.expires_in) {
      this.logger.error(
        `Token exchange returned an unexpected shape for ${shopDomain}`,
      );
      throw new ServiceUnavailableException({
        code: 'SHOPIFY_UNAVAILABLE',
        message: 'Shopify returned an unexpected authentication response.',
      });
    }

    return {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  private async refresh(connection: TokenSource): Promise<string> {
    const clientSecret = decryptToken(
      connection.clientSecretEncrypted!,
      this.config.tokenKey,
    );
    const { accessToken, expiresAt } = await this.exchange(
      connection.shopDomain,
      connection.clientId!,
      clientSecret,
    );

    await this.prisma.shopifyConnection.update({
      where: { id: connection.id },
      data: {
        encryptedToken: encryptToken(accessToken, this.config.tokenKey),
        tokenExpiresAt: expiresAt,
      },
    });

    this.logger.log(
      `Shopify token refreshed for ${connection.shopDomain} (expires ${expiresAt.toISOString()})`,
    );
    return accessToken;
  }
}
