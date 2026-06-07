import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ShipLogicConfig } from './shiplogic-config';

const validEnv = {
  SHIPLOGIC_BASE_URL: 'https://api.shiplogic.com',
  SHIPLOGIC_API_KEY: 'sandbox-key-abc123',
};

function buildConfig(env: Record<string, string | undefined>): ShipLogicConfig {
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new ShipLogicConfig(configService);
}

async function buildViaModule(
  env: Record<string, string | undefined>,
): Promise<ShipLogicConfig> {
  const module = await Test.createTestingModule({
    providers: [
      ShipLogicConfig,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return module.get(ShipLogicConfig);
}

describe('ShipLogicConfig', () => {
  describe('happy path', () => {
    it('loads valid env via ConfigService', async () => {
      const cfg = await buildViaModule(validEnv);
      expect(cfg.baseUrl).toBe('https://api.shiplogic.com');
      expect(cfg.apiKey).toBe('sandbox-key-abc123');
      expect(cfg.isSandbox).toBe(true);
    });

    it('applies defaults for optional vars', () => {
      const cfg = buildConfig(validEnv);
      expect(cfg.defaultServiceLevel).toBe('ECO');
      expect(cfg.defaultWeightGrams).toBe(500);
      expect(cfg.defaultLengthCm).toBe(20);
      expect(cfg.defaultWidthCm).toBe(20);
      expect(cfg.defaultHeightCm).toBe(10);
      expect(cfg.webhookSecret).toBeNull();
      expect(cfg.webhookIpAllowlist).toEqual([]);
    });

    it('respects overrides for optional vars', () => {
      const cfg = buildConfig({
        ...validEnv,
        SHIPLOGIC_DEFAULT_SERVICE_LEVEL: 'LOF',
        SHIPPING_DEFAULT_WEIGHT_GRAMS: '750',
        SHIPPING_DEFAULT_LENGTH_CM: '30',
        SHIPPING_DEFAULT_WIDTH_CM: '25',
        SHIPPING_DEFAULT_HEIGHT_CM: '15',
        SHIPLOGIC_WEBHOOK_SECRET: 'super-secret-token',
        SHIPLOGIC_WEBHOOK_IP_ALLOWLIST: '1.2.3.4, 5.6.7.8 ,  9.10.11.12',
      });
      expect(cfg.defaultServiceLevel).toBe('LOF');
      expect(cfg.defaultWeightGrams).toBe(750);
      expect(cfg.defaultLengthCm).toBe(30);
      expect(cfg.defaultWidthCm).toBe(25);
      expect(cfg.defaultHeightCm).toBe(15);
      expect(cfg.webhookSecret).toBe('super-secret-token');
      expect(cfg.webhookIpAllowlist).toEqual(['1.2.3.4', '5.6.7.8', '9.10.11.12']);
    });

    it('reports isSandbox: false when pointed at the production host', () => {
      const cfg = buildConfig({
        ...validEnv,
        SHIPLOGIC_BASE_URL: 'https://api.portal.thecourierguy.co.za',
      });
      expect(cfg.isSandbox).toBe(false);
    });
  });

  describe('boot validation', () => {
    it('throws when SHIPLOGIC_BASE_URL is missing', () => {
      const env: Record<string, string | undefined> = { ...validEnv };
      delete env.SHIPLOGIC_BASE_URL;
      expect(() => buildConfig(env)).toThrow(/SHIPLOGIC_BASE_URL/);
    });

    it('throws when SHIPLOGIC_BASE_URL is not a valid URL', () => {
      expect(() =>
        buildConfig({ ...validEnv, SHIPLOGIC_BASE_URL: 'not-a-url' }),
      ).toThrow(/SHIPLOGIC_BASE_URL/);
    });

    it('throws when SHIPLOGIC_API_KEY is missing', () => {
      const env: Record<string, string | undefined> = { ...validEnv };
      delete env.SHIPLOGIC_API_KEY;
      expect(() => buildConfig(env)).toThrow(/SHIPLOGIC_API_KEY/);
    });

    it('throws when SHIPLOGIC_API_KEY is empty', () => {
      expect(() =>
        buildConfig({ ...validEnv, SHIPLOGIC_API_KEY: '   ' }),
      ).toThrow(/SHIPLOGIC_API_KEY/);
    });

    it('throws on non-positive integer for weight default', () => {
      expect(() =>
        buildConfig({ ...validEnv, SHIPPING_DEFAULT_WEIGHT_GRAMS: '0' }),
      ).toThrow(/SHIPPING_DEFAULT_WEIGHT_GRAMS/);
      expect(() =>
        buildConfig({ ...validEnv, SHIPPING_DEFAULT_WEIGHT_GRAMS: '-5' }),
      ).toThrow(/SHIPPING_DEFAULT_WEIGHT_GRAMS/);
      expect(() =>
        buildConfig({ ...validEnv, SHIPPING_DEFAULT_WEIGHT_GRAMS: 'abc' }),
      ).toThrow(/SHIPPING_DEFAULT_WEIGHT_GRAMS/);
    });
  });
});
