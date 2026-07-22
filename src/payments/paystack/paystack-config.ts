import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PaystackConfig — single source of truth for Paystack environment
 * configuration (PayfastConfig pattern: validate everything at boot, fail
 * fast on misconfiguration).
 *
 * Env vars:
 *   PAYSTACK_SECRET_KEY   required — sk_test_… or sk_live_…; the mode is
 *                         DERIVED from the key prefix (no separate sandbox
 *                         flag to fall out of sync with the key).
 *   PAYSTACK_CALLBACK_URL required — where the hosted checkout returns the
 *                         buyer (maya's https sentinel / web return page).
 *
 * Production guard: NODE_ENV=production refuses a test key.
 * Webhook note: the webhook URL is configured on the Paystack dashboard, not
 * here; inbound verification needs only the secret key (HMAC-SHA512).
 */
@Injectable()
export class PaystackConfig implements OnModuleInit {
  private readonly logger = new Logger(PaystackConfig.name);

  readonly secretKey: string;
  readonly callbackUrl: string;
  /** True when the secret key is a test-mode key (sk_test_…). */
  readonly testMode: boolean;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.required('PAYSTACK_SECRET_KEY');
    if (!/^sk_(test|live)_/.test(this.secretKey)) {
      throw new Error(
        "PAYSTACK_SECRET_KEY must start with 'sk_test_' or 'sk_live_'",
      );
    }
    this.testMode = this.secretKey.startsWith('sk_test_');
    this.callbackUrl = this.requiredUrl('PAYSTACK_CALLBACK_URL');

    this.assertProductionGuards();
  }

  /** REST base — same host for test and live; the key selects the mode. */
  get apiBaseUrl(): string {
    return 'https://api.paystack.co';
  }

  onModuleInit() {
    this.logger.log(
      `Paystack configured: mode=${this.testMode ? 'TEST' : 'LIVE'}, callbackUrl=${this.callbackUrl}`,
    );
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim() === '') {
      throw new Error(`Required env var ${key} is missing or empty`);
    }
    return value.trim();
  }

  private requiredUrl(key: string): string {
    const value = this.required(key);
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('not http(s)');
      }
    } catch {
      throw new Error(`Env var ${key} must be a valid URL, got '${value}'`);
    }
    return value;
  }

  private assertProductionGuards() {
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && this.testMode) {
      throw new Error(
        'PAYSTACK_SECRET_KEY is a TEST key but NODE_ENV=production — refusing to boot',
      );
    }
  }
}
