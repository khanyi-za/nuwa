import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ShopifyWebhookService } from './shopify-webhook.service';

/**
 * ShopifyWebhookController — public sync-webhook endpoint.
 *
 * POST /shopify/webhook/:secret — the path secret is per-connection (set at
 * registration); the service optionally HMAC-verifies on top. `req.rawBody`
 * comes from `NestFactory.create(..., { rawBody: true })` in main.ts — the
 * same mechanism as the Paystack and ShipLogic webhooks. No DTO on purpose:
 * Shopify's payloads evolve and forbidNonWhitelisted would reject them.
 */
@Controller('shopify')
export class ShopifyWebhookController {
  constructor(private readonly webhooks: ShopifyWebhookService) {}

  @Public()
  @Post('webhook/:secret')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<{ received: true }> {
    return this.webhooks.ingest(
      secret,
      (req as Request & { rawBody?: Buffer }).rawBody,
      {
        topic: req.header('x-shopify-topic'),
        shopDomain: req.header('x-shopify-shop-domain'),
        hmac: req.header('x-shopify-hmac-sha256'),
        webhookId: req.header('x-shopify-webhook-id'),
      },
      req.ip ?? '',
    );
  }
}
