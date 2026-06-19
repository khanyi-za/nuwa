import * as path from 'path';

/*
 * Phase 1 only exercises the data-dir + HTTP settings below. The demo Postgres
 * (DATABASE_URL) and Cloudinary (yiiva-dev) clients are wired in later phases
 * (Rehost/Load) — see docs/demo-importer/demo-importer-foundation.md §3.
 */

export const TOOL_ROOT = path.resolve(__dirname, '..');

/** Per-brand workspaces live here (gitignored). Override with IMPORTER_DATA_DIR. */
export const DATA_DIR = process.env.IMPORTER_DATA_DIR
  ? path.resolve(process.env.IMPORTER_DATA_DIR)
  : path.join(TOOL_ROOT, 'data');

export const brandDir = (slug: string): string => path.join(DATA_DIR, slug);
export const rawDir = (slug: string): string => path.join(brandDir(slug), 'raw');
export const manifestPath = (slug: string): string => path.join(brandDir(slug), 'manifest.json');
export const curatedPath = (slug: string): string => path.join(brandDir(slug), 'curated.json');
export const assetMapPath = (slug: string): string => path.join(brandDir(slug), 'asset-map.json');
export const assetsDir = (slug: string): string => path.join(brandDir(slug), 'assets');

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Cloudinary creds for server-side upload (DI-5: reuse the `yiiva-dev` cloud).
 * Fail-fast — only called by Rehost on a real (non-dry-run) upload.
 */
export function getCloudinaryConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? 'yiiva-dev';
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      'Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Set them in the environment ' +
        '(reuse the yiiva-dev cloud creds — see .env).',
    );
  }
  return { cloudName, apiKey, apiSecret };
}

/** Polite-scraping defaults. We control re-runs, so we cache and go slow. */
export const HTTP = {
  userAgent: 'Mozilla/5.0 (compatible; YIIVA-DemoImporter/1.0)',
  timeoutMs: 20_000,
  retries: 3,
  throttleMs: 350, // delay between requests to the same storefront
  pageSize: 250, // Shopify's max for *.json endpoints
};

/**
 * yt-dlp auth for Instagram reels (which block anonymous downloads). Set ONE:
 *   IMPORTER_YTDLP_COOKIES_FROM_BROWSER=chrome   (reads a logged-in browser)
 *   IMPORTER_YTDLP_COOKIES_FILE=/path/cookies.txt
 */
export const YTDLP = {
  cookiesFromBrowser: process.env.IMPORTER_YTDLP_COOKIES_FROM_BROWSER ?? '',
  cookiesFile: process.env.IMPORTER_YTDLP_COOKIES_FILE ?? '',
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function assertValidSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Invalid brand slug "${slug}". Use lowercase letters, digits, and hyphens (e.g. "sakanya").`,
    );
  }
}
