import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ShipLogicConfig } from './shiplogic-config';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Thin HTTPS wrapper for outbound calls to the ShipLogic API.
 *
 * Surfaces two primitives — `getJson` and `postJson` — used by the rest of the
 * shipping module to call rates, shipments, tracking, etc. Bearer auth header
 * is attached automatically.
 *
 * Mirrors the payments client's use of Node's global `fetch` + `AbortController`
 * for request timeouts. Errors are normalised: HTTP non-2xx becomes a thrown
 * `ShipLogicApiError` carrying status + body; network errors throw a
 * `InternalServerErrorException` so callers can distinguish them.
 */
@Injectable()
export class ShipLogicClient {
  private readonly logger = new Logger(ShipLogicClient.name);

  constructor(private readonly config: ShipLogicConfig) {}

  /**
   * GET a JSON resource. `path` is appended to `baseUrl` and may include a
   * query string. Returns the parsed JSON response body.
   */
  async getJson<T = unknown>(
    path: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  /**
   * POST a JSON body. `body` is JSON-stringified and sent with
   * `Content-Type: application/json`. Returns the parsed JSON response body.
   */
  async postJson<T = unknown>(
    path: string,
    body: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  /**
   * GET a binary resource (e.g. shipment label PDF). Returns a Buffer of
   * the response body, plus the content-type header. Throws
   * `ShipLogicApiError` on non-2xx (same as JSON path).
   */
  async getBinary(
    path: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ buffer: Buffer; contentType: string | null }> {
    const url = this.buildUrl(path);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new ShipLogicApiError(res.status, text, 'GET', path);
      }
      const ab = await res.arrayBuffer();
      return {
        buffer: Buffer.from(ab),
        contentType: res.headers.get('content-type'),
      };
    } catch (err) {
      if (err instanceof ShipLogicApiError) throw err;
      const msg = (err as Error).message ?? 'unknown';
      this.logger.error(`ShipLogic GET (binary) ${path} failed: ${msg}`);
      throw new InternalServerErrorException(
        `ShipLogic GET ${path} failed: ${msg}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Core ───────────────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    opts: { timeoutMs?: number },
  ): Promise<T> {
    const url = this.buildUrl(path);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        // Surface as a typed error so callers can branch on it.
        throw new ShipLogicApiError(res.status, text, method, path);
      }
      if (text === '') {
        return undefined as unknown as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new InternalServerErrorException(
          `ShipLogic ${method} ${path}: response was not valid JSON`,
        );
      }
    } catch (err) {
      if (err instanceof ShipLogicApiError) throw err;
      if (err instanceof InternalServerErrorException) throw err;
      const msg = (err as Error).message ?? 'unknown';
      this.logger.error(
        `ShipLogic ${method} ${path} failed: ${msg}`,
      );
      throw new InternalServerErrorException(
        `ShipLogic ${method} ${path} failed: ${msg}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }
}

/**
 * Typed error thrown when ShipLogic returns a non-2xx HTTP response. Callers
 * can pattern-match on `status` to handle specific cases (e.g. 400 bad
 * address, 403 sandbox-locked admin endpoint, 429 rate limit).
 */
export class ShipLogicApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(
      `ShipLogic ${method} ${path} returned ${status}: ${responseBody.slice(0, 200)}`,
    );
    this.name = 'ShipLogicApiError';
  }
}
