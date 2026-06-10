import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Paginated } from './paginated';

/**
 * Wraps every mobile-surface response in the envelope maya expects
 * (`api-conventions.md` §Response envelope):
 *   - plain return      → { success: true, data }
 *   - Paginated return  → { success: true, data, pagination }
 *
 * Scoped to mobile controllers via `MobileController` — NEVER registered as a
 * global APP_INTERCEPTOR, which would reshape the existing web/admin routes.
 */
@Injectable()
export class MobileResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        if (payload instanceof Paginated) {
          return {
            success: true,
            data: payload.data,
            pagination: payload.pagination,
          };
        }
        return { success: true, data: payload ?? null };
      }),
    );
  }
}
