import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PayfastConfig } from './payfast-config';

const validEnv = {
  PAYFAST_MERCHANT_ID: '10000100',
  PAYFAST_MERCHANT_KEY: '46f0cd694581a',
  PAYFAST_PASSPHRASE: 'jt7NOE43FZPn',
  PAYFAST_SANDBOX: 'true',
  PAYFAST_RETURN_URL: 'https://yiiva.co.za/checkout/success',
  PAYFAST_CANCEL_URL: 'https://yiiva.co.za/checkout/cancel',
  PAYFAST_NOTIFY_URL: 'https://api.yiiva.co.za/payments/notify',
};

function buildConfig(env: Record<string, string | undefined>): PayfastConfig {
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new PayfastConfig(configService);
}

async function buildViaModule(
  env: Record<string, string | undefined>,
): Promise<PayfastConfig> {
  const module = await Test.createTestingModule({
    providers: [
      PayfastConfig,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return module.get(PayfastConfig);
}

describe('PayfastConfig', () => {
  describe('happy path', () => {
    it('loads valid env via ConfigService', async () => {
      const cfg = await buildViaModule(validEnv);
      expect(cfg.merchantId).toBe('10000100');
      expect(cfg.merchantKey).toBe('46f0cd694581a');
      expect(cfg.passphrase).toBe('jt7NOE43FZPn');
      expect(cfg.sandbox).toBe(true);
      expect(cfg.notifyUrl).toBe('https://api.yiiva.co.za/payments/notify');
    });

    it('applies defaults for optional vars', () => {
      const cfg = buildConfig(validEnv);
      expect(cfg.apiVersion).toBe('v1');
      expect(cfg.notifyHosts).toEqual([
        'www.payfast.co.za',
        'sandbox.payfast.co.za',
        'w1w.payfast.co.za',
        'w2w.payfast.co.za',
      ]);
      expect(cfg.skipIpCheck).toBe(false);
      expect(cfg.trustProxy).toBe(1);
    });

    it('trims whitespace from passphrase', () => {
      const cfg = buildConfig({ ...validEnv, PAYFAST_PASSPHRASE: '  secret  ' });
      expect(cfg.passphrase).toBe('secret');
    });

    it('resolves form base URL from sandbox flag', () => {
      const sandbox = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'true' });
      expect(sandbox.formBaseUrl).toBe('https://sandbox.payfast.co.za');

      const prod = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'false' });
      expect(prod.formBaseUrl).toBe('https://www.payfast.co.za');
    });

    it('apiBaseUrl is constant; testing query toggles with sandbox flag', () => {
      const sandbox = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'true' });
      expect(sandbox.apiBaseUrl).toBe('https://api.payfast.co.za');
      expect(sandbox.apiTestingQuery).toBe('?testing=true');

      const prod = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'false' });
      expect(prod.apiBaseUrl).toBe('https://api.payfast.co.za');
      expect(prod.apiTestingQuery).toBe('');
    });
  });

  describe('required env vars', () => {
    it.each([
      'PAYFAST_MERCHANT_ID',
      'PAYFAST_MERCHANT_KEY',
      'PAYFAST_PASSPHRASE',
      'PAYFAST_SANDBOX',
      'PAYFAST_RETURN_URL',
      'PAYFAST_CANCEL_URL',
      'PAYFAST_NOTIFY_URL',
    ])('throws when %s is missing', (missing) => {
      const env = { ...validEnv, [missing]: undefined };
      expect(() => buildConfig(env)).toThrow(
        `Required env var ${missing} is missing or empty`,
      );
    });

    it('throws when a required var is empty string', () => {
      expect(() => buildConfig({ ...validEnv, PAYFAST_MERCHANT_ID: '' })).toThrow(
        'PAYFAST_MERCHANT_ID is missing or empty',
      );
    });

    it('throws when a required var is whitespace only', () => {
      expect(() => buildConfig({ ...validEnv, PAYFAST_PASSPHRASE: '   ' })).toThrow(
        'PAYFAST_PASSPHRASE is missing or empty',
      );
    });
  });

  describe('PAYFAST_SANDBOX validation', () => {
    it('accepts true', () => {
      const cfg = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'true' });
      expect(cfg.sandbox).toBe(true);
    });

    it('accepts false', () => {
      const cfg = buildConfig({ ...validEnv, PAYFAST_SANDBOX: 'false' });
      expect(cfg.sandbox).toBe(false);
    });

    it.each(['1', '0', 'yes', 'no', 'TRUE', 'False'])(
      'rejects non-boolean value %s',
      (value) => {
        expect(() =>
          buildConfig({ ...validEnv, PAYFAST_SANDBOX: value }),
        ).toThrow(`Env var PAYFAST_SANDBOX must be 'true' or 'false'`);
      },
    );
  });

  describe('URL validation', () => {
    it.each(['PAYFAST_RETURN_URL', 'PAYFAST_CANCEL_URL', 'PAYFAST_NOTIFY_URL'])(
      'rejects malformed URL in %s',
      (key) => {
        expect(() => buildConfig({ ...validEnv, [key]: 'not-a-url' })).toThrow(
          `Env var ${key} must be a valid URL`,
        );
      },
    );

    it('rejects non-http(s) protocols', () => {
      expect(() =>
        buildConfig({
          ...validEnv,
          PAYFAST_NOTIFY_URL: 'ftp://example.com/notify',
        }),
      ).toThrow('must be a valid URL');
    });
  });

  describe('PAYFAST_NOTIFY_HOSTS', () => {
    it('uses defaults when unset', () => {
      const cfg = buildConfig(validEnv);
      expect(cfg.notifyHosts).toHaveLength(4);
      expect(cfg.notifyHosts).toContain('www.payfast.co.za');
    });

    it('uses defaults when empty string', () => {
      const cfg = buildConfig({ ...validEnv, PAYFAST_NOTIFY_HOSTS: '' });
      expect(cfg.notifyHosts).toHaveLength(4);
    });

    it('parses comma-separated list', () => {
      const cfg = buildConfig({
        ...validEnv,
        PAYFAST_NOTIFY_HOSTS: 'host1.com, host2.com ,host3.com',
      });
      expect(cfg.notifyHosts).toEqual(['host1.com', 'host2.com', 'host3.com']);
    });
  });

  describe('TRUST_PROXY', () => {
    it('defaults to 1 when unset (Railway edge hop)', () => {
      const cfg = buildConfig(validEnv);
      expect(cfg.trustProxy).toBe(1);
    });

    it('parses an integer', () => {
      const cfg = buildConfig({ ...validEnv, TRUST_PROXY: '2' });
      expect(cfg.trustProxy).toBe(2);
    });

    it('accepts 0 (no proxy)', () => {
      const cfg = buildConfig({ ...validEnv, TRUST_PROXY: '0' });
      expect(cfg.trustProxy).toBe(0);
    });

    it('rejects negative', () => {
      expect(() => buildConfig({ ...validEnv, TRUST_PROXY: '-1' })).toThrow(
        'TRUST_PROXY must be a non-negative integer',
      );
    });

    it('rejects non-numeric', () => {
      expect(() => buildConfig({ ...validEnv, TRUST_PROXY: 'lots' })).toThrow(
        'TRUST_PROXY must be a non-negative integer',
      );
    });
  });

  describe('production guards', () => {
    it('refuses to boot if NODE_ENV=production && PAYFAST_SKIP_IP_CHECK=true', () => {
      expect(() =>
        buildConfig({
          ...validEnv,
          NODE_ENV: 'production',
          PAYFAST_SKIP_IP_CHECK: 'true',
        }),
      ).toThrow('not allowed in production');
    });

    it('allows skipIpCheck=true outside production', () => {
      const cfg = buildConfig({
        ...validEnv,
        NODE_ENV: 'development',
        PAYFAST_SKIP_IP_CHECK: 'true',
      });
      expect(cfg.skipIpCheck).toBe(true);
    });

    it('allows production when skipIpCheck=false', () => {
      const cfg = buildConfig({
        ...validEnv,
        NODE_ENV: 'production',
        PAYFAST_SANDBOX: 'false',
        PAYFAST_SKIP_IP_CHECK: 'false',
      });
      expect(cfg.sandbox).toBe(false);
      expect(cfg.skipIpCheck).toBe(false);
    });
  });
});
