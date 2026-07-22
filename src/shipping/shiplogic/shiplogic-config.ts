import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ShipLogicConfig — single source of truth for ShipLogic / TCG environment
 * configuration.
 *
 * Validates all required env vars at boot. Module fails fast if any required
 * value is missing or malformed, so configuration errors surface immediately
 * rather than at first rate quote.
 *
 * Mirrors the payments config (now `PaystackConfig`) — same boot-validation rhythm and helpers.
 */
@Injectable()
export class ShipLogicConfig implements OnModuleInit {
  private readonly logger = new Logger(ShipLogicConfig.name);

  readonly baseUrl: string;
  readonly apiKey: string;
  readonly defaultServiceLevel: string;
  readonly defaultWeightGrams: number;
  readonly defaultLengthCm: number;
  readonly defaultWidthCm: number;
  readonly defaultHeightCm: number;
  readonly fallbackRateInCents: number;
  readonly webhookSecret: string | null;
  readonly webhookIpAllowlist: string[];

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.requiredUrl('SHIPLOGIC_BASE_URL');
    this.apiKey = this.required('SHIPLOGIC_API_KEY');
    this.defaultServiceLevel =
      this.config.get<string>('SHIPLOGIC_DEFAULT_SERVICE_LEVEL') ?? 'ECO';
    this.defaultWeightGrams = this.optionalPositiveInt(
      'SHIPPING_DEFAULT_WEIGHT_GRAMS',
      500,
    );
    this.defaultLengthCm = this.optionalPositiveInt(
      'SHIPPING_DEFAULT_LENGTH_CM',
      20,
    );
    this.defaultWidthCm = this.optionalPositiveInt(
      'SHIPPING_DEFAULT_WIDTH_CM',
      20,
    );
    this.defaultHeightCm = this.optionalPositiveInt(
      'SHIPPING_DEFAULT_HEIGHT_CM',
      10,
    );
    this.fallbackRateInCents = this.optionalPositiveInt(
      'SHIPPING_RATE_FALLBACK_CENTS',
      11000, // R110 — matches the original ShippingStubService default
    );
    this.webhookSecret =
      this.config.get<string>('SHIPLOGIC_WEBHOOK_SECRET')?.trim() || null;
    this.webhookIpAllowlist = this.parseAllowlist(
      this.config.get<string>('SHIPLOGIC_WEBHOOK_IP_ALLOWLIST'),
    );

    this.assertProductionGuards();
  }

  /** True if pointing at the ShipLogic sandbox host. */
  get isSandbox(): boolean {
    return this.baseUrl.startsWith('https://api.shiplogic.com');
  }

  onModuleInit() {
    this.logger.log(
      `ShipLogic configured: sandbox=${this.isSandbox}, baseUrl=${this.baseUrl}, ` +
        `defaultServiceLevel=${this.defaultServiceLevel}, ` +
        `defaultWeightGrams=${this.defaultWeightGrams}, ` +
        `defaultParcelCm=${this.defaultLengthCm}x${this.defaultWidthCm}x${this.defaultHeightCm}, ` +
        `fallbackRateInCents=${this.fallbackRateInCents}, ` +
        `webhookSecret=${this.webhookSecret ? 'set' : 'unset'}, ` +
        `webhookIpAllowlist=[${this.webhookIpAllowlist.join(', ') || 'empty'}]`,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim() === '') {
      throw new Error(`Required env var ${key} is missing or empty`);
    }
    return value;
  }

  private requiredUrl(key: string): string {
    const value = this.required(key);
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('not http(s)');
      }
    } catch {
      throw new Error(`Env var ${key} must be a valid URL, got '${value}'`);
    }
    return value;
  }

  private optionalPositiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(
        `Env var ${key} must be a positive integer, got '${raw}'`,
      );
    }
    return n;
  }

  private parseAllowlist(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private assertProductionGuards(): void {
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && this.isSandbox) {
      this.logger.warn(
        'ShipLogic is pointing at sandbox (api.shiplogic.com) while NODE_ENV=production — verify this is intentional',
      );
    }
  }
}
