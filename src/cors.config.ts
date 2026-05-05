import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Localhost defaults used when CORS_ORIGINS is unset OUTSIDE production.
 * Lets local dev (Next.js on :3000 or :3001) work without env config.
 * Production never falls through to these — boot fails instead.
 */
const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
];

const PREFLIGHT_CACHE_SECONDS = 86_400; // 24h — reduces OPTIONS traffic without sacrificing flexibility

/**
 * Build NestJS CORS options from environment.
 *
 * `CORS_ORIGINS` is a comma-separated allowlist of frontend origins
 * (e.g., `https://yiiva.co.za,https://staging.yiiva.co.za`). Each entry must
 * be a full origin (protocol + host + optional port), not a regex or pattern.
 *
 * `credentials: true` is required because the frontend sends the refresh-token
 * httpOnly cookie on auth requests. With credentials enabled, the browser
 * refuses wildcard `*` — every origin must be listed explicitly.
 *
 * Boot behavior:
 *   - production with empty/missing CORS_ORIGINS → throws (refuses to start)
 *   - non-production with empty CORS_ORIGINS → uses DEV_DEFAULT_ORIGINS
 *   - any environment with CORS_ORIGINS set → uses the parsed list
 */
export function buildCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  const raw = env.CORS_ORIGINS ?? '';
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  if (origins.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'CORS_ORIGINS must be set in production. Provide a comma-separated allowlist of frontend origins.',
      );
    }
    return {
      origin: DEV_DEFAULT_ORIGINS,
      credentials: true,
      maxAge: PREFLIGHT_CACHE_SECONDS,
    };
  }

  return {
    origin: origins,
    credentials: true,
    maxAge: PREFLIGHT_CACHE_SECONDS,
  };
}
