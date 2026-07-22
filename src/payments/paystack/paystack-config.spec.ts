import { ConfigService } from '@nestjs/config';
import { PaystackConfig } from './paystack-config';

function makeConfigService(env: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
}

const VALID_ENV = {
  PAYSTACK_SECRET_KEY: 'sk_test_abc123',
  PAYSTACK_CALLBACK_URL: 'https://yiiva.co.za/payment-return',
};

describe('PaystackConfig', () => {
  it('boots with a valid test key and derives testMode', () => {
    const cfg = new PaystackConfig(makeConfigService(VALID_ENV));
    expect(cfg.testMode).toBe(true);
    expect(cfg.secretKey).toBe('sk_test_abc123');
    expect(cfg.apiBaseUrl).toBe('https://api.paystack.co');
  });

  it('derives live mode from an sk_live_ key', () => {
    const cfg = new PaystackConfig(
      makeConfigService({ ...VALID_ENV, PAYSTACK_SECRET_KEY: 'sk_live_xyz' }),
    );
    expect(cfg.testMode).toBe(false);
  });

  it('throws when the secret key is missing', () => {
    expect(
      () =>
        new PaystackConfig(
          makeConfigService({ ...VALID_ENV, PAYSTACK_SECRET_KEY: undefined }),
        ),
    ).toThrow(/PAYSTACK_SECRET_KEY/);
  });

  it('throws on a malformed key prefix', () => {
    expect(
      () =>
        new PaystackConfig(
          makeConfigService({ ...VALID_ENV, PAYSTACK_SECRET_KEY: 'pk_test_abc' }),
        ),
    ).toThrow(/sk_test_|sk_live_/);
  });

  it('throws on an invalid callback URL', () => {
    expect(
      () =>
        new PaystackConfig(
          makeConfigService({ ...VALID_ENV, PAYSTACK_CALLBACK_URL: 'not-a-url' }),
        ),
    ).toThrow(/PAYSTACK_CALLBACK_URL/);
  });

  it('refuses a test key when NODE_ENV=production', () => {
    expect(
      () =>
        new PaystackConfig(
          makeConfigService({ ...VALID_ENV, NODE_ENV: 'production' }),
        ),
    ).toThrow(/TEST key.*production/);
  });

  it('allows a live key in production', () => {
    const cfg = new PaystackConfig(
      makeConfigService({
        ...VALID_ENV,
        PAYSTACK_SECRET_KEY: 'sk_live_xyz',
        NODE_ENV: 'production',
      }),
    );
    expect(cfg.testMode).toBe(false);
  });
});
