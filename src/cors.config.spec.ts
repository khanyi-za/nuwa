import { buildCorsOptions } from './cors.config';

describe('buildCorsOptions', () => {
  describe('parsing', () => {
    it('parses a single origin', () => {
      const opts = buildCorsOptions({ CORS_ORIGINS: 'https://yiiva.co.za' });
      expect(opts.origin).toEqual(['https://yiiva.co.za']);
    });

    it('parses comma-separated origins', () => {
      const opts = buildCorsOptions({
        CORS_ORIGINS: 'https://yiiva.co.za,https://staging.yiiva.co.za',
      });
      expect(opts.origin).toEqual([
        'https://yiiva.co.za',
        'https://staging.yiiva.co.za',
      ]);
    });

    it('trims whitespace around each origin', () => {
      const opts = buildCorsOptions({
        CORS_ORIGINS: '  https://yiiva.co.za , https://staging.yiiva.co.za  ',
      });
      expect(opts.origin).toEqual([
        'https://yiiva.co.za',
        'https://staging.yiiva.co.za',
      ]);
    });

    it('drops empty entries (e.g., trailing comma)', () => {
      const opts = buildCorsOptions({
        CORS_ORIGINS: 'https://yiiva.co.za,,',
      });
      expect(opts.origin).toEqual(['https://yiiva.co.za']);
    });
  });

  describe('non-production fallback', () => {
    it('uses localhost defaults when CORS_ORIGINS is unset', () => {
      const opts = buildCorsOptions({ NODE_ENV: 'development' });
      expect(opts.origin).toEqual([
        'http://localhost:3000',
        'http://localhost:3001',
      ]);
    });

    it('uses localhost defaults when CORS_ORIGINS is empty string', () => {
      const opts = buildCorsOptions({
        CORS_ORIGINS: '',
        NODE_ENV: 'development',
      });
      expect(opts.origin).toEqual([
        'http://localhost:3000',
        'http://localhost:3001',
      ]);
    });

    it('uses localhost defaults when CORS_ORIGINS is whitespace-only', () => {
      const opts = buildCorsOptions({
        CORS_ORIGINS: '   ,  , ',
        NODE_ENV: 'test',
      });
      expect(opts.origin).toEqual([
        'http://localhost:3000',
        'http://localhost:3001',
      ]);
    });
  });

  describe('production guard', () => {
    it('throws when NODE_ENV=production and CORS_ORIGINS is unset', () => {
      expect(() => buildCorsOptions({ NODE_ENV: 'production' })).toThrow(
        /CORS_ORIGINS must be set in production/,
      );
    });

    it('throws when NODE_ENV=production and CORS_ORIGINS is empty string', () => {
      expect(() =>
        buildCorsOptions({ NODE_ENV: 'production', CORS_ORIGINS: '' }),
      ).toThrow(/CORS_ORIGINS must be set in production/);
    });

    it('throws when NODE_ENV=production and CORS_ORIGINS resolves to empty after parsing', () => {
      expect(() =>
        buildCorsOptions({ NODE_ENV: 'production', CORS_ORIGINS: ' , , ' }),
      ).toThrow(/CORS_ORIGINS must be set in production/);
    });

    it('accepts production when CORS_ORIGINS is set', () => {
      const opts = buildCorsOptions({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://yiiva.co.za',
      });
      expect(opts.origin).toEqual(['https://yiiva.co.za']);
    });
  });

  describe('cookie / credentials handling', () => {
    it('always sets credentials:true (required for refresh-token cookie)', () => {
      const opts = buildCorsOptions({ CORS_ORIGINS: 'https://yiiva.co.za' });
      expect(opts.credentials).toBe(true);
    });

    it('sets credentials:true even on dev fallback', () => {
      const opts = buildCorsOptions({ NODE_ENV: 'development' });
      expect(opts.credentials).toBe(true);
    });
  });

  describe('preflight cache', () => {
    it('sets a non-trivial maxAge to reduce OPTIONS traffic', () => {
      const opts = buildCorsOptions({ CORS_ORIGINS: 'https://yiiva.co.za' });
      expect(opts.maxAge).toBeGreaterThanOrEqual(3600); // at least 1 hour
    });
  });
});
