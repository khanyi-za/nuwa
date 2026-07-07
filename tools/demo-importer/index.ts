#!/usr/bin/env ts-node
/*
 * YIIVA Demo Catalogue Importer — CLI entry.
 * Design + decisions: docs/demo-importer/demo-importer-foundation.md
 *
 * Phase 1 implements `extract`. The remaining stages are stubbed so the command
 * surface exists and the build plan (foundation §9) is visible from --help.
 */
import 'dotenv/config';

import { runExtract } from './src/stages/extract';
import { runTransform } from './src/stages/transform';
import { runCurate } from './src/stages/curate';
import { runRehost } from './src/stages/rehost';
import { runLoad } from './src/stages/load';
import { runSeedDemo } from './src/stages/seed-demo';
import { runRelinkCategories } from './src/stages/relink-categories';
import { runRegender } from './src/stages/regender';
import { runRenav } from './src/stages/renav';
import { runSeedOrders } from './src/stages/seed-orders';
import { runRebanner } from './src/stages/rebanner';
import { log } from './src/logger';

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positionals.push(a);
    }
  }
  return { command, positionals, flags };
}

function printHelp(): void {
  console.log(`
YIIVA Demo Catalogue Importer

Usage:
  npm run import -- <command> [args]

Commands:
  extract   <brandSlug> --url <storefront>   Fetch public Shopify catalogue → data/<slug>/raw/   [Phase 1]
            [--logo-only]                       …or just (re)fetch the homepage logo → storefront.json
  transform <brandSlug>                       Normalise raw → manifest.json                       [Phase 2]
  curate    <brandSlug> [--cap N] [--force]    Bootstrap/validate curated.json (manual edit).      [Phase 3]
                                               --cap: product cap (default 50, nav-coverage-aware)
                                               --force: re-bootstrap, keeping videos[] + description
  rehost    <brandSlug> [--dry-run]            Upload images/videos to Cloudinary (resumable)      [Phase 3]
  seed-demo                                    Seed platform categories into the demo DB           [Phase 5]
  load      <brandSlug>                        Write curated catalogue into the demo DB            [Phase 4]
  relink    [brandSlug…]                       Re-derive category links for loaded brands after a
                                               CATEGORY_RULES/seed change (defaults to all brands)
  regender                                     Apply per-brand default genderType to gender-silent
                                               (UNISEX) products so Women/Men feeds diverge
  renav     [brandSlug…]                       Mirror each brand's site nav onto its collections
                                               (tab order/labels/visibility; defaults to all brands)
  seed-orders                                  Seed 8 weeks of demo order history + returns per brand
                                               (earnings/orders/returns screens; re-run = wipe+reseed)
  rebanner  <brandSlug…>                       Re-apply StoreBannerMedia from curated videos[] +
                                               asset-map IN PLACE (no wipe — post-load hero workflow)

Example:
  npm run import -- extract sakanya --url https://sakanya.co
`);
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'extract': {
      const slug = positionals[0];
      const url = flags.url;
      if (!slug || !url) {
        log.error('Usage: extract <brandSlug> --url <storefront> [--logo-only]');
        process.exit(1);
      }
      await runExtract({ slug, url, logoOnly: flags['logo-only'] === 'true' });
      break;
    }
    case 'transform': {
      const slug = positionals[0];
      if (!slug) {
        log.error('Usage: transform <brandSlug>');
        process.exit(1);
      }
      await runTransform({ slug });
      break;
    }
    case 'curate': {
      const slug = positionals[0];
      if (!slug) {
        log.error('Usage: curate <brandSlug> [--cap N] [--force]');
        process.exit(1);
      }
      await runCurate({
        slug,
        cap: flags.cap ? parseInt(flags.cap, 10) : undefined,
        force: flags.force === 'true',
      });
      break;
    }
    case 'rehost': {
      const slug = positionals[0];
      if (!slug) {
        log.error('Usage: rehost <brandSlug> [--dry-run]');
        process.exit(1);
      }
      await runRehost({ slug, dryRun: flags['dry-run'] === 'true' });
      break;
    }
    case 'seed-demo':
      await runSeedDemo();
      break;
    case 'relink':
      await runRelinkCategories(positionals);
      break;
    case 'regender':
      await runRegender();
      break;
    case 'renav':
      await runRenav(positionals);
      break;
    case 'seed-orders':
      await runSeedOrders();
      break;
    case 'rebanner':
      await runRebanner(positionals);
      break;
    case 'load': {
      const slug = positionals[0];
      if (!slug) {
        log.error('Usage: load <brandSlug>  (requires DATABASE_URL → demo DB)');
        process.exit(1);
      }
      await runLoad({ slug });
      break;
    }
    case 'help':
    default:
      printHelp();
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
