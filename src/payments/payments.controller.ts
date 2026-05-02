import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsNotifyService } from './payments-notify.service';

/**
 * PaymentsController — public-facing PayFast webhook endpoints.
 *
 * The notify route receives `application/x-www-form-urlencoded` bodies posted
 * by PayFast's server when a transaction status changes. Express's default
 * urlencoded body parser populates `req.body` with the parsed fields in
 * insertion order (which the signature algorithm depends on).
 *
 * No DTO is used: PayFast may add new fields without notice; the global
 * ValidationPipe with `forbidNonWhitelisted: true` would reject legitimate
 * ITNs. PaymentsNotifyService validates the body internally.
 *
 * `req.ip` resolution depends on `app.set('trust proxy', N)` configured in
 * main.ts. Without correct trust-proxy config, `req.ip` is the LB's IP and
 * the source-IP allowlist check would reject every ITN.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly notifyService: PaymentsNotifyService) {}

  @Public()
  @Post('notify')
  @HttpCode(HttpStatus.OK)
  async notify(@Req() req: Request): Promise<void> {
    const body = (req.body ?? {}) as Record<string, string>;
    const sourceIp = req.ip ?? '';
    await this.notifyService.handle(body, sourceIp);
  }
}
