import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { v2 as cloudinary } from 'cloudinary';

import {
  YTDLP,
  assetMapPath,
  assetsDir,
  assertValidSlug,
  curatedPath,
  getCloudinaryConfig,
  manifestPath,
} from '../config';
import { log } from '../logger';
import type { Manifest } from '../manifest/types';

interface AssetJob {
  key: string; // stable identity (the source URL) — also the asset-map key
  kind: 'image' | 'video';
  source: string;
  label: string; // human context for logs
}
interface AssetRecord {
  secureUrl: string;
  publicId: string;
  kind: 'image' | 'video';
  source: string;
  uploadedAt: string;
}
type AssetMap = Record<string, AssetRecord>;

function publicIdFor(brandSlug: string, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `demo/${brandSlug}/${hash}`;
}

function loadManifest(slug: string): { manifest: Manifest; usedCurated: boolean } {
  const cPath = curatedPath(slug);
  if (fs.existsSync(cPath)) {
    return { manifest: JSON.parse(fs.readFileSync(cPath, 'utf8')) as Manifest, usedCurated: true };
  }
  const mPath = manifestPath(slug);
  if (!fs.existsSync(mPath)) {
    throw new Error(`No manifest/curated file for "${slug}". Run: transform ${slug} (then curate).`);
  }
  return { manifest: JSON.parse(fs.readFileSync(mPath, 'utf8')) as Manifest, usedCurated: false };
}

/** Collect the de-duplicated set of assets to rehost from the curated manifest. */
function collectJobs(m: Manifest): AssetJob[] {
  const jobs = new Map<string, AssetJob>();
  const add = (kind: 'image' | 'video', source: string | null | undefined, label: string) => {
    if (!source) return;
    if (!jobs.has(source)) jobs.set(source, { key: source, kind, source, label });
  };

  add('image', m.store.logoSourceUrl, 'store logo');
  m.collections.filter((c) => c.include).forEach((c) => add('image', c.imageSourceUrl, `collection ${c.slug}`));
  m.products
    .filter((p) => p.include)
    .forEach((p) => p.images.forEach((img) => add('image', img.sourceUrl, `product ${p.slug}`)));
  m.videos.forEach((v) => add('video', v.url, `video ${v.target}${v.productSlug ? ' ' + v.productSlug : ''}`));

  return [...jobs.values()];
}

/** Cloudinary error objects aren't Errors — dig the message out of either. */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const m = (err as { message?: unknown })?.message;
  return typeof m === 'string' ? m : JSON.stringify(err);
}

/**
 * Shopify-CDN downscale fallback for images over Cloudinary's upload limit
 * (10MB — brands upload raw 14MB+ collection covers). Shopify's CDN resizes
 * server-side via a `width` query param, so a retry at 2048px comes in far
 * under the cap with no visible quality loss at demo sizes.
 */
function downscaledUrl(source: string): string | null {
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(source)) return null;
  if (/[?&]width=/.test(source)) return null;
  return source + (source.includes('?') ? '&' : '?') + 'width=2048';
}

function ensureYtDlp(): void {
  try {
    execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'yt-dlp is required for video rehosting but was not found. Install it ' +
        '(e.g. `brew install yt-dlp`) — a cookies.txt may be needed for gated reels.',
    );
  }
}

function ytDlpAuthArgs(): string[] {
  if (YTDLP.cookiesFromBrowser) return ['--cookies-from-browser', YTDLP.cookiesFromBrowser];
  if (YTDLP.cookiesFile) return ['--cookies', YTDLP.cookiesFile];
  return [];
}

function downloadVideo(slug: string, key: string, url: string): string {
  const dir = assetsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const base = createHash('sha1').update(key).digest('hex').slice(0, 16);
  const outTmpl = path.join(dir, `${base}.%(ext)s`);
  const args = ['--no-playlist', '--no-warnings', ...ytDlpAuthArgs(), '-o', outTmpl, url];
  execFileSync('yt-dlp', args, { stdio: 'inherit' });
  const produced = fs.readdirSync(dir).find((f) => f.startsWith(base));
  if (!produced) throw new Error(`yt-dlp produced no file for ${url}`);
  return path.join(dir, produced);
}

export async function runRehost({ slug, dryRun }: { slug: string; dryRun: boolean }): Promise<void> {
  assertValidSlug(slug);
  const { manifest, usedCurated } = loadManifest(slug);
  if (!usedCurated) log.warn('No curated.json — rehosting from manifest.json (run `curate` to trim first).');

  const jobs = collectJobs(manifest);
  const images = jobs.filter((j) => j.kind === 'image').length;
  const videos = jobs.filter((j) => j.kind === 'video').length;

  log.step(`Rehost: ${slug}${dryRun ? ' (dry-run)' : ''}`);
  log.info(`assets to consider: ${images} images, ${videos} videos`);

  const existing: AssetMap = fs.existsSync(assetMapPath(slug))
    ? (JSON.parse(fs.readFileSync(assetMapPath(slug), 'utf8')) as AssetMap)
    : {};

  if (dryRun) {
    const todo = jobs.filter((j) => !existing[j.key]);
    const done = jobs.length - todo.length;
    todo.slice(0, 20).forEach((j) => log.info(`  would upload [${j.kind}] ${j.label} — ${j.source.slice(0, 70)}`));
    if (todo.length > 20) log.info(`  …and ${todo.length - 20} more`);
    log.step('Dry-run summary');
    log.ok(`would upload: ${todo.length}`);
    log.ok(`already in asset-map (skip): ${done}`);
    log.warn('No uploads performed. Re-run without --dry-run to upload to Cloudinary (yiiva-dev).');
    return;
  }

  // Real uploads.
  const cfg = getCloudinaryConfig();
  cloudinary.config({ cloud_name: cfg.cloudName, api_key: cfg.apiKey, api_secret: cfg.apiSecret });
  if (videos > 0 && !jobs.every((j) => j.kind === 'image' || existing[j.key])) ensureYtDlp();

  const map: AssetMap = { ...existing };
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    if (map[job.key]) {
      skipped++;
      continue;
    }
    try {
      const publicId = publicIdFor(slug, job.key);
      let secureUrl: string;
      if (job.kind === 'image') {
        const opts = {
          public_id: publicId,
          resource_type: 'image' as const,
          overwrite: false,
          unique_filename: false,
          use_filename: false,
        };
        let res;
        try {
          res = await cloudinary.uploader.upload(job.source, opts);
        } catch (imgErr) {
          // Oversized originals (>10MB) fail — retry via Shopify CDN downscale.
          const smaller = downscaledUrl(job.source);
          if (!smaller) throw imgErr;
          log.info(`  retrying downscaled (${errMessage(imgErr).slice(0, 60)}): ${job.label}`);
          res = await cloudinary.uploader.upload(smaller, opts);
        }
        secureUrl = res.secure_url;
      } else {
        const localPath = downloadVideo(slug, job.key, job.source);
        const res = await cloudinary.uploader.upload(localPath, {
          public_id: publicId,
          resource_type: 'video',
          overwrite: false,
        });
        secureUrl = res.secure_url;
      }
      map[job.key] = {
        secureUrl,
        publicId,
        kind: job.kind,
        source: job.source,
        uploadedAt: new Date().toISOString(),
      };
      fs.writeFileSync(assetMapPath(slug), JSON.stringify(map, null, 2)); // resumable: persist each
      uploaded++;
      log.ok(`[${job.kind}] ${job.label}`);
    } catch (err) {
      failed++;
      log.error(`failed [${job.kind}] ${job.label}: ${errMessage(err)}`);
    }
  }

  log.step('Rehost summary');
  log.ok(`uploaded: ${uploaded}`);
  log.ok(`skipped (already done): ${skipped}`);
  if (failed > 0) log.warn(`failed: ${failed} (re-run to retry — successful ones are skipped)`);
  log.info(`asset-map → ${assetMapPath(slug)}`);
}
