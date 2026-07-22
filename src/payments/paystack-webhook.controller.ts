import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PaystackWebhookService } from './paystack-webhook.service';
import { PAYSTACK_SIGNATURE_HEADER } from './paystack/paystack-types';

/**
 * PaystackWebhookController — public Paystack webhook endpoint.
 *
 * POST /payments/webhook receives JSON events signed with HMAC-SHA512 over
 * the EXACT request bytes (`x-paystack-signature`). `req.rawBody` is captured
 * by `NestFactory.create(..., { rawBody: true })` in main.ts — the same
 * mechanism the ShipLogic webhook relies on. No DTO on purpose: the global
 * ValidationPipe's forbidNonWhitelisted would reject legitimate events when
 * Paystack adds fields; the service validates internally.
 *
 * Configure the URL on the Paystack dashboard (Settings → API Keys &
 * Webhooks) per mode — test and live have separate webhook URLs.
 */
@Controller('payments')
export class PaystackWebhookController {
  constructor(private readonly webhookService: PaystackWebhookService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request): Promise<{ received: true }> {
    const signature = req.header(PAYSTACK_SIGNATURE_HEADER);
    await this.webhookService.handle(
      (req as Request & { rawBody?: Buffer }).rawBody,
      signature,
      req.ip ?? '',
    );
    return { received: true };
  }
}
