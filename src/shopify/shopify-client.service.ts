import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ShopifyConfig } from './shopify-config';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_THROTTLE_RETRIES = 3;

/** Shape of Shopify's GraphQL response envelope. */
interface GraphqlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; restoreRate: number };
      requestedQueryCost?: number;
    };
  };
}

export interface ShopInfo {
  name: string;
  email: string | null;
  currencyCode: string;
  myshopifyDomain: string;
  primaryDomain: string | null;
  productsCount: number;
}

/**
 * ShopifyClient — Admin GraphQL API wrapper (house HTTP-client pattern:
 * global fetch + AbortController timeouts). GraphQL-ONLY by mandate — the
 * REST Admin API is legacy and forbidden for new apps.
 *
 * Auth: per-shop Admin API access token via X-Shopify-Access-Token (Phase 1 =
 * merchant-created custom-app token; OAuth tokens later use the same header).
 *
 * Rate limits are cost-based (leaky bucket). On THROTTLED we wait for the
 * bucket to restore (from extensions.cost) and retry, max 3 attempts.
 */
@Injectable()
export class ShopifyClient {
  private readonly logger = new Logger(ShopifyClient.name);

  constructor(private readonly config: ShopifyConfig) {}

  /**
   * Execute a GraphQL query against a shop. 401/403 from Shopify → 401
   * (invalid/revoked token — the caller surfaces "reconnect"); THROTTLED →
   * wait + retry; anything else unexpected → 500.
   */
  async graphql<T>(
    shopDomain: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.post(shopDomain, accessToken, query, variables);

      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException({
          code: 'SHOPIFY_TOKEN_INVALID',
          message:
            'Shopify rejected the access token — it may have been revoked. Reconnect the shop.',
        });
      }

      const body = (await res.json().catch(() => null)) as
        | GraphqlResponse<T>
        | null;
      if (!body) {
        throw new InternalServerErrorException(
          `Shopify returned a non-JSON response (HTTP ${res.status})`,
        );
      }

      const throttled = body.errors?.some(
        (e) => e.extensions?.code === 'THROTTLED',
      );
      if (throttled && attempt < MAX_THROTTLE_RETRIES) {
        const waitMs = this.throttleWaitMs(body);
        this.logger.warn(
          `Shopify throttled (${shopDomain}) — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_THROTTLE_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (body.errors?.length) {
        this.logger.error(
          `Shopify GraphQL errors (${shopDomain}): ${JSON.stringify(body.errors).slice(0, 300)}`,
        );
        throw new InternalServerErrorException(
          `Shopify query failed: ${body.errors[0].message}`,
        );
      }

      if (!body.data) {
        throw new InternalServerErrorException(
          'Shopify returned an empty data payload',
        );
      }
      return body.data;
    }
  }

  /** Shop identity + catalogue size — the connect-time validation call. */
  async fetchShopInfo(
    shopDomain: string,
    accessToken: string,
  ): Promise<ShopInfo> {
    const data = await this.graphql<{
      shop: {
        name: string;
        email: string | null;
        currencyCode: string;
        myshopifyDomain: string;
        primaryDomain: { host: string } | null;
      };
      productsCount: { count: number } | null;
    }>(
      shopDomain,
      accessToken,
      `query ShopInfo {
        shop {
          name
          email
          currencyCode
          myshopifyDomain
          primaryDomain { host }
        }
        productsCount { count }
      }`,
    );

    return {
      name: data.shop.name,
      email: data.shop.email,
      currencyCode: data.shop.currencyCode,
      myshopifyDomain: data.shop.myshopifyDomain,
      primaryDomain: data.shop.primaryDomain?.host ?? null,
      productsCount: data.productsCount?.count ?? 0,
    };
  }

  /**
   * The shop's brand logo URL, if one is set and readable. Best-effort — a
   * missing brand-asset scope or absent logo degrades to null rather than
   * failing whatever flow wanted the nice-to-have.
   */
  async fetchShopLogoUrl(
    shopDomain: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const data = await this.graphql<{
        shop: {
          brand: { logo: { image: { url: string } | null } | null } | null;
        };
      }>(
        shopDomain,
        accessToken,
        `query ShopLogo { shop { brand { logo { image { url } } } } }`,
      );
      return data.shop.brand?.logo?.image?.url ?? null;
    } catch {
      return null;
    }
  }

  private async post(
    shopDomain: string,
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(this.config.graphqlUrl(shopDomain), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': accessToken,
        },
        body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new InternalServerErrorException(
        `Shopify unreachable (${shopDomain}): ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** How long until the bucket has room again, from the cost extension. */
  private throttleWaitMs(body: GraphqlResponse<unknown>): number {
    const cost = body.extensions?.cost;
    const needed = cost?.requestedQueryCost ?? 100;
    const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
    const restoreRate = cost?.throttleStatus?.restoreRate ?? 50;
    const deficit = Math.max(needed - available, 0);
    return Math.min(Math.ceil((deficit / restoreRate) * 1000) + 250, 10_000);
  }
}
