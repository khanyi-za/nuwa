import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Default machine-readable error code derived from HTTP status when a thrown
 * exception doesn't carry an explicit `code`. Domain endpoints may override by
 * throwing e.g. `new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message })`.
 * Codes match maya `api-conventions.md` §Error codes — the client branches on
 * `error.code`, not the message.
 */
function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'BUSINESS_RULE_VIOLATION';
    case 429:
      return 'RATE_LIMIT_EXCEEDED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}

/**
 * Maps any exception thrown inside a mobile controller to the maya error
 * envelope: `{ success: false, error: { code, message } }`. Scoped to mobile
 * controllers via `MobileController` so web/admin error shapes are untouched.
 */
@Catch()
export class MobileExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('MobileApi');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = defaultCode(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (typeof obj.code === 'string') code = obj.code;
        const m = obj.message;
        if (Array.isArray(m)) message = m.join('; ');
        else if (typeof m === 'string') message = m;
      }
    } else {
      this.logger.error(
        `Unhandled mobile API error: ${(exception as Error)?.message ?? exception}`,
        (exception as Error)?.stack,
      );
    }

    res.status(status).json({ success: false, error: { code, message } });
  }
}
