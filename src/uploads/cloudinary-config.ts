import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * CloudinaryConfig — single source of truth for Cloudinary environment configuration.
 *
 * Validates all required env vars at boot. Module fails fast if any required
 * value is missing or empty, so configuration errors surface immediately rather
 * than at first upload-signature request.
 *
 * Mirrors the payments module's boot-validation pattern (now PaystackConfig).
 */
@Injectable()
export class CloudinaryConfig implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryConfig.name);

  readonly cloudName: string;
  readonly apiKey: string;
  readonly apiSecret: string;

  constructor(private readonly config: ConfigService) {
    this.cloudName = this.required('CLOUDINARY_CLOUD_NAME');
    this.apiKey = this.required('CLOUDINARY_API_KEY');
    this.apiSecret = this.required('CLOUDINARY_API_SECRET');
  }

  /** The expected URL prefix for Cloudinary-hosted assets in this environment. */
  get urlPrefix(): string {
    return `https://res.cloudinary.com/${this.cloudName}/`;
  }

  onModuleInit() {
    this.logger.log(
      `Cloudinary configured: cloud=${this.cloudName}, urlPrefix=${this.urlPrefix}`,
    );
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim() === '') {
      throw new Error(`Required env var ${key} is missing or empty`);
    }
    return value;
  }
}
