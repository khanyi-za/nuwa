import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as dns } from 'dns';
import { PayfastConfig } from './payfast-config';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * PayfastIpAllowlistService — DNS-resolved source IP allowlist for the ITN
 * webhook. Resolves PayFast's notify hostnames to a Set of IPs at boot and
 * refreshes hourly. The notify service compares `req.ip` against this set.
 *
 * Failure model (deliberate):
 *   - Boot DNS fails → allowlist starts empty → all ITNs rejected (400).
 *     PayFast retries up to 11× over 2 days, so a transient DNS outage
 *     resolves itself.
 *   - Periodic refresh produces empty result → keep previous allowlist
 *     (graceful degradation).
 *   - skipIpCheck=true (dev only) → isAllowed always returns true.
 *
 * IPv6 normalization: req.ip on Express may return `::ffff:1.2.3.4` for
 * IPv4-mapped addresses depending on platform/proxy config. We strip the
 * prefix before comparing.
 */
@Injectable()
export class PayfastIpAllowlistService implements OnModuleInit {
  private readonly logger = new Logger(PayfastIpAllowlistService.name);
  private allowedIps = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;

  constructor(private readonly config: PayfastConfig) {}

  async onModuleInit() {
    await this.refresh();
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err) =>
        this.logger.error(`Allowlist refresh threw: ${(err as Error).message}`),
      );
    }, REFRESH_INTERVAL_MS);
  }

  /** Test/teardown helper — stops the periodic refresh interval. */
  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Check whether a request's source IP is on the allowlist.
   * Returns true unconditionally when skipIpCheck is enabled (dev only —
   * PayfastConfig refuses to boot if NODE_ENV=production && skipIpCheck=true).
   */
  isAllowed(ip: string): boolean {
    if (this.config.skipIpCheck) return true;
    return this.allowedIps.has(this.normalize(ip));
  }

  /** Strip `::ffff:` prefix from IPv4-mapped IPv6 addresses. */
  private normalize(ip: string): string {
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  /** Test seam: snapshot of the current allowlist for assertions. */
  getAllowedIps(): ReadonlySet<string> {
    return this.allowedIps;
  }

  /** Resolve all configured hostnames and replace the allowlist atomically. */
  private async refresh(): Promise<void> {
    const next = new Set<string>();
    for (const host of this.config.notifyHosts) {
      try {
        const addrs = await dns.lookup(host, { all: true, family: 0 });
        for (const a of addrs) next.add(a.address);
      } catch (err) {
        this.logger.error(
          `Failed to resolve ${host}: ${(err as Error).message}`,
        );
      }
    }

    if (next.size === 0) {
      // Fail-closed: keep the previous allowlist if any; otherwise empty.
      if (this.allowedIps.size > 0) {
        this.logger.error(
          'Allowlist refresh produced empty set — keeping previous allowlist',
        );
      } else {
        this.logger.error(
          'Allowlist is empty after initial refresh — all ITNs will be rejected until DNS recovers',
        );
      }
      return;
    }

    this.allowedIps = next;
    this.logger.log(
      `PayFast IP allowlist refreshed: ${next.size} addresses across ${this.config.notifyHosts.length} hosts`,
    );
  }
}
