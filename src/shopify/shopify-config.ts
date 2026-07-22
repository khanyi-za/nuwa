import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ShopifyConfig — boot-time env validation for the Shopify onboarding module
 * (house pattern: fail fast on misconfiguration).
 *
 * SHOPIFY_TOKEN_KEY: 32-byte hex key for AES-256-GCM encryption of stored
 * Admin API tokens. Rotating it orphans existing connections (tokens become
 * undecryptable — merchants reconnect).
 *
 * API version is pinned here — Shopify versions quarterly and supports each
 * for 12 months; bump deliberately with the release notes in hand.
 */
@Injectable()
export class ShopifyConfig implements OnModuleInit {
  private readonly logger = new Logger(ShopifyConfig.name);

  readonly tokenKey: Buffer;
  readonly apiVersion = '2026-07';

  /**
   * Public https base of THIS API (e.g. https://api.yiiva.co.za) — used to
   * build webhook callback URLs for Phase 2 sync registration. Optional:
   * when unset, imports still work but webhook registration is skipped with
   * a warning (local dev without a tunnel).
   */
  readonly webhookBaseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('SHOPIFY_TOKEN_KEY');
    if (!raw || !/^[0-9a-f]{64}$/i.test(raw.trim())) {
      throw new Error(
        'SHOPIFY_TOKEN_KEY must be 64 hex chars (openssl rand -hex 32)',
      );
    }
    this.tokenKey = Buffer.from(raw.trim(), 'hex');

    const base = this.config.get<string>('SHOPIFY_WEBHOOK_BASE_URL')?.trim();
    this.webhookBaseUrl = base ? base.replace(/\/+$/, '') : null;
  }

  /** Admin GraphQL endpoint for a shop (canonical *.myshopify.com host). */
  graphqlUrl(shopDomain: string): string {
    return `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  onModuleInit() {
    this.logger.log(
      `Shopify configured: apiVersion=${this.apiVersion}, webhooks=${this.webhookBaseUrl ?? 'DISABLED (no SHOPIFY_WEBHOOK_BASE_URL)'}`,
    );
  }
}
