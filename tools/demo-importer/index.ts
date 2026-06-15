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
  transform <brandSlug>                       Normalise raw → manifest.json                       [Phase 2]
  curate    <brandSlug>                        Bootstrap/validate curated.json (manual edit)       [Phase 3]
  rehost    <brandSlug> [--dry-run]            Upload images/videos to Cloudinary (resumable)      [Phase 3]
  load      <brandSlug>                        Write curated catalogue into the demo DB            [Phase 4]

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
        log.error('Usage: extract <brandSlug> --url <storefront>');
        process.exit(1);
      }
      await runExtract({ slug, url });
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
        log.error('Usage: curate <brandSlug>');
        process.exit(1);
      }
      await runCurate({ slug });
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
