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
 * Phase 1 auth: the merchant creates a custom app in their own Shopify admin
 * (Settings → Apps → Develop apps), grants read scopes, and pastes the Admin
 * API access token here. The token is validated live against the shop before
 * anything is stored, and stored encrypted.
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

  /** Admin API access token (custom apps: shpat_…). */
  @IsString()
  @Matches(/^shpat_[a-fA-F0-9]{16,}$/, {
    message:
      'accessToken must be a Shopify Admin API access token (starts with shpat_)',
  })
  accessToken: string;

  /**
   * OPTIONAL: the custom app's "API secret key" (shown next to the token in
   * the merchant's Shopify admin). When provided, sync webhooks are HMAC
   * verified with it in addition to the path secret. Stored encrypted.
   */
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  apiSecret?: string;
}
