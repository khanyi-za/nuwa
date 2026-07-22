import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryConfig } from '../uploads/cloudinary-config';

/**
 * ShopifyRehostService — server-side Cloudinary upload straight from a
 * Shopify CDN URL (Cloudinary fetches the remote file itself — nothing
 * touches our disk). Prior art: the demo importer's rehost stage.
 *
 * public_id is a hash of the source URL under the store's import folder, with
 * overwrite:false — so a re-run of the import finds the asset already there
 * and Cloudinary returns the existing resource instead of re-uploading.
 * Failures return null (the executor skips that asset and counts it);
 * one bad image must not kill a 200-product import.
 */
@Injectable()
export class ShopifyRehostService {
  private readonly logger = new Logger(ShopifyRehostService.name);

  constructor(private readonly config: CloudinaryConfig) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });
  }

  async rehostImage(
    storeId: string,
    sourceUrl: string,
  ): Promise<string | null> {
    const hash = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16);
    const opts = {
      public_id: `stores/${storeId}/import/${hash}`,
      resource_type: 'image' as const,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
    };
    try {
      let res;
      try {
        res = await cloudinary.uploader.upload(sourceUrl, opts);
      } catch (err) {
        // Oversized originals (>10MB raw camera files behind Shopify's CDN)
        // fail — retry via the CDN's server-side width param.
        const smaller = this.downscaledUrl(sourceUrl);
        if (!smaller) throw err;
        res = await cloudinary.uploader.upload(smaller, opts);
      }
      return res.secure_url;
    } catch (err) {
      this.logger.warn(
        `Rehost failed for ${sourceUrl.slice(0, 80)}: ${this.errMessage(err)}`,
      );
      return null;
    }
  }

  /**
   * Shopify's CDN resizes server-side via a `width` query param, so a retry
   * at 2048px comes in far under Cloudinary's 10MB cap with no visible loss.
   */
  private downscaledUrl(source: string): string | null {
    if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(source)) return null;
    if (/[?&]width=/.test(source)) return null;
    return source + (source.includes('?') ? '&' : '?') + 'width=2048';
  }

  /** Cloudinary error objects aren't Errors — dig the message out of either. */
  private errMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    const m = (err as { message?: unknown })?.message;
    return typeof m === 'string' ? m : JSON.stringify(err);
  }
}
