import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PayfastConfig — single source of truth for PayFast environment configuration.
 *
 * Validates all required env vars at boot. Module fails fast if any required
 * value is missing or malformed, so configuration errors surface immediately
 * rather than at first ITN.
 */
@Injectable()
export class PayfastConfig implements OnModuleInit {
  private readonly logger = new Logger(PayfastConfig.name);

  readonly merchantId: string;
  readonly merchantKey: string;
  readonly passphrase: string;
  readonly sandbox: boolean;
  readonly returnUrl: string;
  readonly cancelUrl: string;
  readonly notifyUrl: string;
  readonly apiVersion: string;
  readonly notifyHosts: string[];
  readonly skipIpCheck: boolean;
  readonly trustProxy: number;

  constructor(private readonly config: ConfigService) {
    this.merchantId = this.required('PAYFAST_MERCHANT_ID');
    this.merchantKey = this.required('PAYFAST_MERCHANT_KEY');
    this.passphrase = this.required('PAYFAST_PASSPHRASE').trim();
    this.sandbox = this.requiredBool('PAYFAST_SANDBOX');
    this.returnUrl = this.requiredUrl('PAYFAST_RETURN_URL');
    this.cancelUrl = this.requiredUrl('PAYFAST_CANCEL_URL');
    this.notifyUrl = this.requiredUrl('PAYFAST_NOTIFY_URL');
    this.apiVersion = this.config.get<string>('PAYFAST_API_VERSION') ?? 'v1';
    this.notifyHosts = this.parseHosts(
      this.config.get<string>('PAYFAST_NOTIFY_HOSTS'),
    );
    this.skipIpCheck =
      this.config.get<string>('PAYFAST_SKIP_IP_CHECK') === 'true';
    this.trustProxy = this.parseTrustProxy(
      this.config.get<string>('TRUST_PROXY'),
    );

    this.assertProductionGuards();
  }

  /** Form-flow base URL — sandbox or production /eng/process host. */
  get formBaseUrl(): string {
    return this.sandbox
      ? 'https://sandbox.payfast.co.za'
      : 'https://www.payfast.co.za';
  }

  /** REST API base URL — same host for sandbox and prod; sandbox uses ?testing=true. */
  get apiBaseUrl(): string {
    return 'https://api.payfast.co.za';
  }

  /** Query suffix for API requests. Empty string in production. */
  get apiTestingQuery(): string {
    return this.sandbox ? '?testing=true' : '';
  }

  onModuleInit() {
    this.logger.log(
      `PayFast configured: sandbox=${this.sandbox}, formBaseUrl=${this.formBaseUrl}, ` +
        `notifyHosts=[${this.notifyHosts.join(', ')}], skipIpCheck=${this.skipIpCheck}`,
    );
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim() === '') {
      throw new Error(`Required env var ${key} is missing or empty`);
    }
    return value;
  }

  private requiredBool(key: string): boolean {
    const value = this.required(key);
    if (value !== 'true' && value !== 'false') {
      throw new Error(`Env var ${key} must be 'true' or 'false', got '${value}'`);
    }
    return value === 'true';
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

  private parseHosts(raw: string | undefined): string[] {
    const defaults = [
      'www.payfast.co.za',
      'sandbox.payfast.co.za',
      'w1w.payfast.co.za',
      'w2w.payfast.co.za',
    ];
    if (!raw || raw.trim() === '') return defaults;
    const hosts = raw
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hosts.length === 0) return defaults;
    return hosts;
  }

  private parseTrustProxy(raw: string | undefined): number {
    if (raw === undefined || raw === '') return 1;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) {
      throw new Error(`Env var TRUST_PROXY must be a non-negative integer, got '${raw}'`);
    }
    return n;
  }

  private assertProductionGuards() {
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && this.skipIpCheck) {
      throw new Error(
        'PAYFAST_SKIP_IP_CHECK=true is not allowed in production (NODE_ENV=production)',
      );
    }
  }
}
