import { HTTP } from './config';

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export interface FetchResult {
  status: number;
  ok: boolean;
  contentType: string;
  text: string;
}

/**
 * GET with a browser-ish UA, timeout, and backoff retry on 429/5xx + network
 * errors. Returns the raw body + status — the caller decides whether it's JSON.
 * 4xx (other than 429) is returned, not retried (e.g. a 404 means "endpoint
 * disabled" — that's a signal, not a transient failure).
 */
export async function httpGet(url: string): Promise<FetchResult> {
  let lastErr: unknown;

  for (let attempt = 1; attempt <= HTTP.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': HTTP.userAgent, Accept: 'application/json,text/html' },
        redirect: 'follow',
        signal: controller.signal,
      });
      const text = await res.text();
      const result: FetchResult = {
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get('content-type') ?? '',
        text,
      };
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(HTTP.throttleMs * attempt * 4);
        continue;
      }
      return result;
    } catch (err) {
      lastErr = err;
      await sleep(HTTP.throttleMs * attempt * 4);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `GET failed after ${HTTP.retries} attempts: ${url} — ${String(lastErr)}`,
  );
}

/** Parse a FetchResult as JSON, or null if the body isn't JSON. */
export function asJson<T>(res: FetchResult): T | null {
  const looksJson =
    res.contentType.includes('json') || res.text.trimStart().startsWith('{');
  if (!looksJson) return null;
  try {
    return JSON.parse(res.text) as T;
  } catch {
    return null;
  }
}
