import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyTokenService } from './shopify-token.service';

/** Topics the sync pipeline consumes (GraphQL enum form). */
export const SYNC_TOPICS = [
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
  'INVENTORY_LEVELS_UPDATE',
] as const;

const SUBSCRIPTIONS_QUERY = `
  query SyncSubscriptions {
    webhookSubscriptions(first: 100) {
      nodes {
        id
        topic
        endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
      }
    }
  }
`;

const SUBSCRIPTION_CREATE = `
  mutation SyncSubscribe($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

const SUBSCRIPTION_DELETE = `
  mutation SyncUnsubscribe($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;

interface SubscriptionNode {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string };
}

/**
 * ShopifyWebhookRegistrationService — subscribes a connected shop to the
 * Phase 2 sync topics via the Admin API (admin custom apps have no TOML
 * config surface; API subscription is the only way).
 *
 * Callback URL: `${SHOPIFY_WEBHOOK_BASE_URL}/shopify/webhook/<secret>` where
 * <secret> is a per-connection random secret — the receiver's auth baseline
 * (ShipLogic path-secret pattern; HMAC additionally verified when the
 * merchant supplied their custom app's API secret key at connect time).
 *
 * Idempotent: existing subscriptions for our exact callback URL are kept,
 * missing topics are added. Called fire-and-forget after each completed
 * import; skipped with a warning when no public base URL is configured.
 */
@Injectable()
export class ShopifyWebhookRegistrationService {
  private readonly logger = new Logger(ShopifyWebhookRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
    private readonly client: ShopifyClient,
    private readonly tokens: ShopifyTokenService,
  ) {}

  async registerForConnection(
    connectionId: string,
  ): Promise<{ registered: boolean; created: number }> {
    if (!this.config.webhookBaseUrl) {
      this.logger.warn(
        'SHOPIFY_WEBHOOK_BASE_URL not set — sync webhooks NOT registered (imports still work; sync is disabled)',
      );
      return { registered: false, created: 0 };
    }

    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        shopDomain: true,
        webhookSecret: true,
      },
    });
    if (!connection) return { registered: false, created: 0 };
    const accessToken = await this.tokens.getToken(connection.id);

    let secret = connection.webhookSecret;
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      await this.prisma.shopifyConnection.update({
        where: { id: connection.id },
        data: { webhookSecret: secret },
      });
    }
    const callbackUrl = `${this.config.webhookBaseUrl}/shopify/webhook/${secret}`;

    const existing = await this.fetchSubscriptions(
      connection.shopDomain,
      accessToken,
    );
    const present = new Set(
      existing
        .filter((s) => s.endpoint?.callbackUrl === callbackUrl)
        .map((s) => s.topic),
    );

    let created = 0;
    for (const topic of SYNC_TOPICS) {
      if (present.has(topic)) continue;
      const res = await this.client.graphql<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: { field: string[] | null; message: string }[];
        };
      }>(connection.shopDomain, accessToken, SUBSCRIPTION_CREATE, {
        topic,
        webhookSubscription: { callbackUrl, format: 'JSON' },
      });
      const errors = res.webhookSubscriptionCreate.userErrors;
      if (errors.length > 0) {
        this.logger.warn(
          `Subscribe ${topic} failed for ${connection.shopDomain}: ${errors[0].message}`,
        );
        continue;
      }
      created++;
    }

    await this.prisma.shopifyConnection.update({
      where: { id: connection.id },
      data: { webhooksRegisteredAt: new Date() },
    });
    this.logger.log(
      `Sync webhooks registered for ${connection.shopDomain}: ${created} created, ${present.size} already present`,
    );
    return { registered: true, created };
  }

  /**
   * Best-effort removal of OUR subscriptions (matched by the connection's
   * secret in the callback URL) — fired on disconnect. Failures are logged;
   * orphaned subscriptions just deliver to a dead secret and get 404s.
   */
  async unregisterForConnection(connectionId: string): Promise<void> {
    try {
      const connection = await this.prisma.shopifyConnection.findUnique({
        where: { id: connectionId },
        select: {
          shopDomain: true,
          webhookSecret: true,
        },
      });
      if (!connection?.webhookSecret) return;
      const accessToken = await this.tokens.getToken(connectionId);

      const existing = await this.fetchSubscriptions(
        connection.shopDomain,
        accessToken,
      );
      const ours = existing.filter((s) =>
        s.endpoint?.callbackUrl?.includes(connection.webhookSecret!),
      );
      for (const sub of ours) {
        await this.client.graphql(
          connection.shopDomain,
          accessToken,
          SUBSCRIPTION_DELETE,
          { id: sub.id },
        );
      }
      if (ours.length > 0) {
        this.logger.log(
          `Removed ${ours.length} sync webhook subscription(s) for ${connection.shopDomain}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Webhook unregister failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  private async fetchSubscriptions(
    shopDomain: string,
    accessToken: string,
  ): Promise<SubscriptionNode[]> {
    const data = await this.client.graphql<{
      webhookSubscriptions: { nodes: SubscriptionNode[] };
    }>(shopDomain, accessToken, SUBSCRIPTIONS_QUERY);
    return data.webhookSubscriptions.nodes;
  }
}
