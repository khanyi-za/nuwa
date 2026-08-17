import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * ConnectShopifyDto — body of POST /shopify/connection.
 *
 * Two auth shapes (exactly one required — enforced in the service):
 *
 * 1. CLIENT CREDENTIALS (the only path for stores connecting since
 *    2026-01-01): the merchant creates an app in the Shopify Dev Dashboard,
 *    installs it on their store, and pastes its Client ID + Client secret.
 *    Nuwa exchanges these for ~24h access tokens and auto-refreshes
 *    (ShopifyTokenService). The client secret also HMAC-signs sync webhooks.
 *
 * 2. LEGACY TOKEN: pre-2026 in-admin custom apps issued permanent shpat_
 *    tokens; those stores can still connect with the token directly.
 *
 * Everything is validated live against the shop before storage; secrets are
 * AES-256-GCM encrypted at rest.
 */
export class ConnectShopifyDto {
  /**
   * The shop's domain in any reasonable form — "brand.myshopify.com",
   * "https://brand.myshopify.com/", or the bare "brand" handle.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  shopDomain: string;

  /** Dev Dashboard app Client ID (client-credentials shape). */
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(120)
  clientId?: string;

  /** Dev Dashboard app Client secret (client-credentials shape). */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  clientSecret?: string;

  /** LEGACY: permanent Admin API access token from a pre-2026 custom app. */
  @IsOptional()
  @IsString()
  @Matches(/^shpat_[a-fA-F0-9]{16,}$/, {
    message:
      'accessToken must be a Shopify Admin API access token (starts with shpat_)',
  })
  accessToken?: string;

  /**
   * OPTIONAL (legacy shape only): the custom app's "API secret key" for
   * webhook HMAC verification. The client-credentials shape doesn't need it —
   * the client secret plays this role automatically.
   */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  apiSecret?: string;
}
