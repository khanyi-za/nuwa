import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyConfig } from './shopify-config';
import { ShopifySyncService } from './shopify-sync.service';
import { decryptToken } from './token-crypto';

export interface ShopifyWebhookHeaders {
  topic: string | undefined; // x-shopify-topic
  shopDomain: string | undefined; // x-shopify-shop-domain
  hmac: string | undefined; // x-shopify-hmac-sha256 (base64)
  webhookId: string | undefined; // x-shopify-webhook-id
}

/**
 * ShopifyWebhookService — ingest pipeline for POST /shopify/webhook/:secret
 * (the two hardened house webhook patterns combined):
 *
 *   1. Resolve the connection by its per-path secret; unknown → 404 stealth
 *   2. HMAC-SHA256 over the RAW bytes vs x-shopify-hmac-sha256, constant-time
 *      — ONLY when the merchant supplied their custom app's API secret key
 *      (without it the path secret is the auth boundary; documented v1)
 *   3. SHA-256 of the raw body → ShopifyWebhookEvent (unique payloadHash);
 *      replays/redeliveries hit the constraint and ack 200 as no-ops
 *   4. Route by topic to ShopifySyncService; applier errors are recorded on
 *      the event row and STILL acked 200 — Shopify retries for ~48h and then
 *      may drop the subscription, so our bugs must not cause retry storms.
 *      The audit row keeps the payload for manual replay.
 */
@Injectable()
export class ShopifyWebhookService {
  private readonly logger = new Logger(ShopifyWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShopifyConfig,
    private readonly sync: ShopifySyncService,
  ) {}

  async ingest(
    secret: string,
    rawBody: Buffer | undefined,
    headers: ShopifyWebhookHeaders,
    sourceIp: string,
  ): Promise<{ received: true }> {
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Missing request body');
    }

    const connection = await this.prisma.shopifyConnection.findFirst({
      where: { webhookSecret: secret, status: 'ACTIVE' },
    });
    if (!connection) {
      // Stealth: an invalid secret is indistinguishable from a dead route.
      throw new NotFoundException();
    }

    if (connection.apiSecretEncrypted) {
      this.verifyHmac(
        rawBody,
        headers.hmac,
        decryptToken(connection.apiSecretEncrypted, this.config.tokenKey),
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not valid JSON');
    }

    const topic = headers.topic ?? 'unknown';
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    let eventId: string;
    try {
      const event = await this.prisma.shopifyWebhookEvent.create({
        data: {
          connectionId: connection.id,
          topic,
          shopDomain: headers.shopDomain ?? connection.shopDomain,
          webhookId: headers.webhookId ?? null,
          payloadHash,
          payload: payload as Prisma.InputJsonValue,
          sourceIp,
        },
        select: { id: true },
      });
      eventId = event.id;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(
          `Duplicate Shopify webhook acked as no-op (${topic}, ${connection.shopDomain})`,
        );
        return { received: true };
      }
      throw err;
    }

    try {
      const outcome = await this.sync.apply(connection, topic, payload);
      await this.prisma.shopifyWebhookEvent.update({
        where: { id: eventId },
        data: { processed: true, processError: null },
      });
      this.logger.log(
        `Shopify webhook applied: ${topic} (${connection.shopDomain}) → ${outcome}`,
      );
    } catch (err) {
      const message = (err as Error).message ?? 'unknown';
      this.logger.error(
        `Shopify webhook applier FAILED (${topic}, ${connection.shopDomain}): ${message} — event stored for replay`,
      );
      await this.prisma.shopifyWebhookEvent
        .update({
          where: { id: eventId },
          data: { processError: message.slice(0, 500) },
        })
        .catch(() => undefined);
    }
    return { received: true };
  }

  private verifyHmac(
    rawBody: Buffer,
    header: string | undefined,
    apiSecret: string,
  ): void {
    if (!header) {
      throw new UnauthorizedException('Missing webhook signature');
    }
    const expected = createHmac('sha256', apiSecret)
      .update(rawBody)
      .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(header);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
