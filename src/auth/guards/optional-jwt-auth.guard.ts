import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like `JwtAuthGuard`, but doesn't throw when no token is present.
 * If a valid JWT exists, `request.user` is populated as normal.
 * If not, `request.user` is `null` — the controller decides what to do.
 *
 * Used by checkout endpoints that serve both authenticated buyers and guests.
 * Must be paired with `@Public()` on the route (to bypass the global
 * `JwtAuthGuard` APP_GUARD), then applied as a route-level guard.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleRequest(err: any, user: any, info: any) {
    return user || null;
  }
}
