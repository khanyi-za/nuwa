import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PayfastConfig } from './payfast-config';
import { PayfastSignatureService } from './payfast-signature.service';
import { PayfastRefundResponse } from './payfast-types';

const POSTBACK_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 15_000;

/**
 * Result of a successful transactions/history call. The PHP SDK doesn't
 * publicly document the exact response shape; we surface raw alongside a
 * best-effort transactions array so callers can adapt as we learn.
 */
export interface TransactionHistoryResult {
  raw: unknown;
  transactions: Array<Record<string, string>>;
}

/**
 * PayfastClient — HTTP wrapper for outbound calls to PayFast.
 *
 * Two surfaces:
 *   - Form-flow validation host (postback): POST {formBaseUrl}/eng/query/validate.
 *     Used during ITN handling to confirm the payload PayFast sent us.
 *   - REST API (api.payfast.co.za): refunds, transaction history (Phase 6).
 *     Sandbox uses ?testing=true query suffix; refunds are LIVE-ONLY (PayFast's
 *     SDK explicitly rejects refunds in test mode).
 *
 * Uses Node 18+ global `fetch`. AbortController enforces request timeouts so
 * slow PayFast endpoints never hold our handlers open indefinitely.
 */
@Injectable()
export class PayfastClient {
  private readonly logger = new Logger(PayfastClient.name);

  constructor(
    private readonly config: PayfastConfig,
    private readonly signature: PayfastSignatureService,
  ) {}

  /**
   * Step 4 of the ITN four-step validation: POST the param string back to
   * PayFast at /eng/query/validate. Returns true iff the response body is
   * exactly `'VALID'`. Network failures, non-200 status, or any other body
   * → false.
   */
  async verifyItnPostback(paramString: string): Promise<boolean> {
    const url = `${this.config.formBaseUrl}/eng/query/validate`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POSTBACK_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: paramString,
        signal: controller.signal,
      });
      const text = (await res.text()).trim();
      if (res.ok && text === 'VALID') return true;
      this.logger.warn(
        `Postback rejected: status=${res.status}, body='${text.slice(0, 100)}'`,
      );
      return false;
    } catch (err) {
      this.logger.error(
        `Postback request failed: ${(err as Error).message}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Create a refund via PayFast's REST API.
   *
   * Endpoint: POST {apiBaseUrl}/refunds/{pfPaymentId}{?testing=true in sandbox}
   *
   * Headers (signed via API-flow alphabetical signature):
   *   - merchant-id
   *   - version
   *   - timestamp (ISO 8601 with TZ offset)
   *   - signature
   *
   * Body (JSON):
   *   - amount (cents, integer)
   *   - reason (string, shown to buyer)
   *   - acc_type ('current' | 'savings' — buyer's bank account type)
   *   - notify_buyer (1 to email buyer, default true)
   *
   * IMPORTANT: refunds are NOT supported in sandbox. PayFast's API rejects
   * refund requests when called against sandbox creds. We log a warning at
   * runtime if `config.sandbox === true` but still attempt the call so the
   * signature/payload structure can be inspected.
   */
  async createRefund(args: {
    pfPaymentId: string;
    amountInCents: number;
    reason: string;
    accType: 'current' | 'savings';
    notifyBuyer?: boolean;
  }): Promise<PayfastRefundResponse> {
    if (this.config.sandbox) {
      this.logger.warn(
        'createRefund called in sandbox mode — PayFast does not support sandbox refunds; expect failure',
      );
    }

    const url = `${this.config.apiBaseUrl}/refunds/${encodeURIComponent(args.pfPaymentId)}${this.config.apiTestingQuery}`;

    // Body fields PayFast expects on a refund request.
    const body: Record<string, string | number> = {
      amount: args.amountInCents,
      reason: args.reason,
      acc_type: args.accType,
      notify_buyer: args.notifyBuyer === false ? 0 : 1,
    };

    const headers: Record<string, string> = {
      'merchant-id': this.config.merchantId,
      version: this.config.apiVersion,
      timestamp: this.buildTimestamp(),
    };

    // API-flow signature: ksort over headers + body (no query params for refunds).
    const signature = this.signature.signApiRequest(
      headers,
      {},
      body,
      this.config.passphrase,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          signature,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: PayfastRefundResponse;
      try {
        parsed = JSON.parse(text) as PayfastRefundResponse;
      } catch {
        this.logger.error(
          `Refund response not JSON (status=${res.status}): ${text.slice(0, 200)}`,
        );
        throw new InternalServerErrorException(
          'PayFast refund response was not valid JSON',
        );
      }

      if (!res.ok) {
        this.logger.error(
          `Refund failed: status=${res.status}, body=${text.slice(0, 300)}`,
        );
        throw new InternalServerErrorException(
          `PayFast refund returned HTTP ${res.status}: ${parsed.data?.message ?? parsed.status ?? 'unknown error'}`,
        );
      }

      return parsed;
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(
        `Refund request failed: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        `PayFast refund unreachable: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch transactions in a date range. Used by the reconciliation tool to
   * cross-check a stuck PaymentGroup against PayFast's records when no ITN
   * has arrived (PayFast does not provide a single-transaction status API).
   *
   * Endpoint: GET {apiBaseUrl}/transactions/history?from=YYYY-MM-DD&to=YYYY-MM-DD
   *           [&offset=N][&limit=N][&testing=true in sandbox]
   *
   * Signature: API-flow ksort over (headers ∪ query).
   */
  async fetchTransactionHistory(args: {
    from: string; // YYYY-MM-DD
    to: string;
    offset?: number;
    limit?: number;
  }): Promise<TransactionHistoryResult> {
    const queryParams: Record<string, string> = {};
    if (this.config.sandbox) queryParams.testing = 'true';
    queryParams.from = args.from;
    queryParams.to = args.to;
    if (args.offset !== undefined) queryParams.offset = String(args.offset);
    if (args.limit !== undefined) queryParams.limit = String(args.limit);

    const headers: Record<string, string> = {
      'merchant-id': this.config.merchantId,
      version: this.config.apiVersion,
      timestamp: this.buildTimestamp(),
    };

    const signature = this.signature.signApiRequest(
      headers,
      queryParams,
      {},
      this.config.passphrase,
    );

    const url = `${this.config.apiBaseUrl}/transactions/history?${new URLSearchParams(queryParams).toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, signature },
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.logger.error(
          `History response not JSON (status=${res.status}): ${text.slice(0, 200)}`,
        );
        throw new InternalServerErrorException(
          'PayFast transactions/history response was not valid JSON',
        );
      }

      if (!res.ok) {
        this.logger.error(
          `History request failed: status=${res.status}, body=${text.slice(0, 300)}`,
        );
        throw new InternalServerErrorException(
          `PayFast transactions/history returned HTTP ${res.status}`,
        );
      }

      return {
        raw: parsed,
        transactions: this.extractTransactions(parsed),
      };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(
        `History request failed: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        `PayFast transactions/history unreachable: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Best-effort extraction of a transactions array from the response. PayFast's
   * exact shape is not publicly documented; we accept several common envelopes
   * (top-level array, `data.response`, `data`, `transactions`).
   */
  private extractTransactions(parsed: unknown): Array<Record<string, string>> {
    if (Array.isArray(parsed)) return parsed as Array<Record<string, string>>;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.transactions)) {
        return obj.transactions as Array<Record<string, string>>;
      }
      if (obj.data && typeof obj.data === 'object') {
        const data = obj.data as Record<string, unknown>;
        if (Array.isArray(data.response)) {
          return data.response as Array<Record<string, string>>;
        }
        if (Array.isArray(data)) {
          return data as Array<Record<string, string>>;
        }
      }
    }
    return [];
  }

  /** ISO 8601 timestamp with timezone offset, matching PayFast's PHP `date("Y-m-d\TH:i:sO")`. */
  private buildTimestamp(now: Date = new Date()): string {
    // toISOString gives 'YYYY-MM-DDTHH:mm:ss.sssZ' (UTC). PayFast accepts UTC
    // as +0000 offset. Format: 'YYYY-MM-DDTHH:mm:ss+0000'.
    const iso = now.toISOString();
    const trimmed = iso.replace(/\.\d{3}Z$/, '+0000');
    return trimmed;
  }
}
