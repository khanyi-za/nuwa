import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ShippingWebhookService } from './shipping-webhook.service';

/**
 * Public-facing ShipLogic webhook receiver.
 *
 * Routing:
 *   POST /shipping/webhook/:secret
 *
 * The path-embedded `:secret` is matched constant-time against the configured
 * `SHIPLOGIC_WEBHOOK_SECRET`. On mismatch we return `404` (stealth — looks
 * like a missing endpoint to scanners). Any IP-allowlist enforcement is
 * delegated to `ShippingWebhookService.checkIp`.
 *
 * Idempotency is built on a SHA-256 hash of the raw request bytes. Express's
 * `rawBody: true` (configured in `main.ts`) makes `req.rawBody` available as
 * a Buffer; we never rely on the parsed form because re-serialization can
 * subtly change the bytes and would defeat de-duplication on retries.
 */
@Controller('shipping/webhook')
export class ShippingWebhookController {
  constructor(private readonly service: ShippingWebhookService) {}

  @Public()
  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<{ received: true; status: 'accepted' | 'duplicate' }> {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      // `rawBody: true` should populate this for every POST. Missing means
      // something stripped it (proxy, alt body parser). Refuse rather than
      // silently re-stringify and hash a normalised form.
      throw new BadRequestException('raw body unavailable');
    }
    const rawBody = raw.toString('utf8');
    const sourceIp = req.ip ?? null;

    const outcome = await this.service.ingest({ secret, sourceIp, rawBody });

    switch (outcome) {
      case 'accepted':
      case 'duplicate':
        return { received: true, status: outcome };
      case 'malformed':
        throw new BadRequestException('payload is not valid JSON');
      case 'unauthenticated':
      case 'ip_rejected':
        // Stealth: don't reveal which check failed.
        throw new NotFoundException();
    }
  }
}
