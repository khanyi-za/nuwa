import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudinaryConfig } from './cloudinary-config';

const validEnv = {
  CLOUDINARY_CLOUD_NAME: 'yiiva-dev',
  CLOUDINARY_API_KEY: '255575148964243',
  CLOUDINARY_API_SECRET: 'redacted-test-secret',
};

function buildConfig(env: Record<string, string | undefined>): CloudinaryConfig {
  const configService = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new CloudinaryConfig(configService);
}

async function buildViaModule(
  env: Record<string, string | undefined>,
): Promise<CloudinaryConfig> {
  const module = await Test.createTestingModule({
    providers: [
      CloudinaryConfig,
      {
        provide: ConfigService,
        useValue: { get: (key: string) => env[key] },
      },
    ],
  }).compile();
  return module.get(CloudinaryConfig);
}

describe('CloudinaryConfig', () => {
  describe('happy path', () => {
    it('loads valid env via ConfigService', async () => {
      const cfg = await buildViaModule(validEnv);
      expect(cfg.cloudName).toBe('yiiva-dev');
      expect(cfg.apiKey).toBe('255575148964243');
      expect(cfg.apiSecret).toBe('redacted-test-secret');
    });

    it('exposes urlPrefix derived from cloudName', () => {
      const cfg = buildConfig(validEnv);
      expect(cfg.urlPrefix).toBe('https://res.cloudinary.com/yiiva-dev/');
    });

    it('urlPrefix reflects different cloud names', () => {
      const cfg = buildConfig({
        ...validEnv,
        CLOUDINARY_CLOUD_NAME: 'yiiva-prod',
      });
      expect(cfg.urlPrefix).toBe('https://res.cloudinary.com/yiiva-prod/');
    });
  });

  describe('missing required env vars — fail fast at boot', () => {
    it('throws when CLOUDINARY_CLOUD_NAME is missing', () => {
      expect(() =>
        buildConfig({ ...validEnv, CLOUDINARY_CLOUD_NAME: undefined }),
      ).toThrow(/CLOUDINARY_CLOUD_NAME is missing/);
    });

    it('throws when CLOUDINARY_CLOUD_NAME is empty string', () => {
      expect(() =>
        buildConfig({ ...validEnv, CLOUDINARY_CLOUD_NAME: '' }),
      ).toThrow(/CLOUDINARY_CLOUD_NAME is missing/);
    });

    it('throws when CLOUDINARY_CLOUD_NAME is whitespace only', () => {
      expect(() =>
        buildConfig({ ...validEnv, CLOUDINARY_CLOUD_NAME: '   ' }),
      ).toThrow(/CLOUDINARY_CLOUD_NAME is missing/);
    });

    it('throws when CLOUDINARY_API_KEY is missing', () => {
      expect(() =>
        buildConfig({ ...validEnv, CLOUDINARY_API_KEY: undefined }),
      ).toThrow(/CLOUDINARY_API_KEY is missing/);
    });

    it('throws when CLOUDINARY_API_SECRET is missing', () => {
      expect(() =>
        buildConfig({ ...validEnv, CLOUDINARY_API_SECRET: undefined }),
      ).toThrow(/CLOUDINARY_API_SECRET is missing/);
    });
  });

  describe('onModuleInit', () => {
    it('logs config summary without exposing the secret', () => {
      const cfg = buildConfig(validEnv);
      const logSpy = jest.spyOn(cfg['logger'], 'log').mockImplementation();
      cfg.onModuleInit();
      const logged = logSpy.mock.calls[0][0] as string;
      expect(logged).toContain('cloud=yiiva-dev');
      expect(logged).toContain('urlPrefix=https://res.cloudinary.com/yiiva-dev/');
      expect(logged).not.toContain('redacted-test-secret'); // secret never logged
      logSpy.mockRestore();
    });
  });
});
