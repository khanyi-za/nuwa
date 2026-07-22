import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PaystackConfig } from './paystack-config';
import {
  PaystackBank,
  PaystackCreateSplitRequest,
  PaystackCreateSubaccountRequest,
  PaystackEnvelope,
  PaystackInitializeData,
  PaystackInitializeRequest,
  PaystackRefundData,
  PaystackRefundRequest,
  PaystackSplitData,
  PaystackSubaccountData,
  PaystackVerifyData,
} from './paystack-types';

const API_TIMEOUT_MS = 15_000;

/**
 * PaystackClient — typed HTTP wrapper for outbound Paystack REST calls
 * (PayfastClient pattern: global fetch + AbortController timeouts,
 * InternalServerErrorException on transport/API failure).
 *
 * Auth is a Bearer secret key — NO request signing exists on this API
 * (the entire PayFast signature apparatus has no equivalent here).
 * The official Node SDK is stale; this hand-rolled client is the SDK.
 */
@Injectable()
export class PaystackClient {
  private readonly logger = new Logger(PaystackClient.name);

  constructor(private readonly config: PaystackConfig) {}

  /**
   * POST /transaction/initialize — create a hosted-checkout session.
   * Returns the authorization_url the buyer is redirected to (plain GET)
   * and Paystack's access_code. `reference` is OURS and comes back on the
   * charge.success webhook.
   */
  async initializeTransaction(
    req: PaystackInitializeRequest,
  ): Promise<PaystackInitializeData> {
    return this.request<PaystackInitializeData>(
      'POST',
      '/transaction/initialize',
      req,
    );
  }

  /**
   * GET /transaction/verify/:reference — authoritative status of a
   * transaction by OUR reference. Used by the reconciliation tool and as a
   * belt-and-braces check; the webhook remains the primary signal.
   */
  async verifyTransaction(reference: string): Promise<PaystackVerifyData> {
    return this.request<PaystackVerifyData>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
  }

  /**
   * verifyTransaction that treats "reference not found" as `null` instead of
   * an error — the reconcile tool's probe ("does Paystack know this
   * reference at all?"). Transport failures still throw.
   */
  async tryVerifyTransaction(
    reference: string,
  ): Promise<PaystackVerifyData | null> {
    try {
      return await this.verifyTransaction(reference);
    } catch (err) {
      if (
        err instanceof InternalServerErrorException &&
        /not found/i.test((err as Error).message)
      ) {
        return null;
      }
      throw err;
    }
  }

  /**
   * POST /refund — full (no amount) or partial (integer subunits) refund of
   * a charge. VERIFIED WORKING IN TEST MODE (PS-1, 2026-07-21: test charge
   * 6378181111 refunded, refund 17731581 status=pending) — unlike PayFast,
   * which rejected sandbox refunds outright. Needs no buyer bank-account type.
   */
  async createRefund(req: PaystackRefundRequest): Promise<PaystackRefundData> {
    return this.request<PaystackRefundData>('POST', '/refund', {
      currency: 'ZAR',
      ...req,
    });
  }

  // ─── Phase 6: merchant payouts (subaccounts + splits) ─────────────────────

  /** GET /bank — SA bank list; codes feed subaccount creation. */
  async listBanks(): Promise<PaystackBank[]> {
    return this.request<PaystackBank[]>(
      'GET',
      '/bank?country=south%20africa&currency=ZAR',
    );
  }

  /**
   * POST /subaccount — register a merchant's settlement bank account.
   * Paystack stores the bank details; we persist only the subaccount_code.
   * NOTE: a new subaccount's FIRST payout is held for one-time verification.
   */
  async createSubaccount(
    req: PaystackCreateSubaccountRequest,
  ): Promise<PaystackSubaccountData> {
    return this.request<PaystackSubaccountData>('POST', '/subaccount', req);
  }

  /** PUT /subaccount/:code — update bank details / business name. */
  async updateSubaccount(
    code: string,
    req: Partial<PaystackCreateSubaccountRequest>,
  ): Promise<PaystackSubaccountData> {
    return this.request<PaystackSubaccountData>(
      'PUT',
      `/subaccount/${encodeURIComponent(code)}`,
      req,
    );
  }

  /**
   * POST /split — create a (per-transaction, flat-amount) split group. The
   * returned split_code is passed to /transaction/initialize so settlement
   * divides at charge time: each merchant's share to their subaccount, the
   * remainder (commission + shipping) to the main YIIVA account.
   */
  async createSplit(
    req: PaystackCreateSplitRequest,
  ): Promise<PaystackSplitData> {
    return this.request<PaystackSplitData>('POST', '/split', req);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.config.secretKey}`,
          'content-type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: PaystackEnvelope<T>;
      try {
        parsed = JSON.parse(text) as PaystackEnvelope<T>;
      } catch {
        this.logger.error(
          `Paystack ${method} ${path} response not JSON (status=${res.status}): ${text.slice(0, 200)}`,
        );
        throw new InternalServerErrorException(
          'Paystack response was not valid JSON',
        );
      }

      // Envelope `status` is "API call succeeded", not the domain status —
      // both HTTP failure and status:false are hard errors here; domain
      // statuses (success/failed/abandoned…) live inside `data`.
      if (!res.ok || parsed.status !== true) {
        this.logger.error(
          `Paystack ${method} ${path} failed: http=${res.status}, message='${parsed.message}', body=${text.slice(0, 300)}`,
        );
        throw new InternalServerErrorException(
          `Paystack ${path} failed: ${parsed.message || `HTTP ${res.status}`}`,
        );
      }

      return parsed.data;
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(
        `Paystack ${method} ${path} unreachable: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        `Paystack unreachable: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
