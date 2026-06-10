import {
  applyDecorators,
  Controller,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { MobileResponseInterceptor } from './mobile-response.interceptor';
import { MobileExceptionFilter } from './mobile-exception.filter';

/**
 * Controller decorator for the mobile/buyer surface. Binds the response
 * envelope + error filter at controller scope (not globally) so the maya
 * contract is applied to these routes only. All mobile routes live under the
 * `/api` prefix the maya client targets (`maya/lib/api-client.ts`).
 *
 * Usage: `@MobileController('api/products')`
 */
export function MobileController(path: string): ClassDecorator {
  return applyDecorators(
    Controller(path),
    UseInterceptors(MobileResponseInterceptor),
    UseFilters(MobileExceptionFilter),
  );
}
