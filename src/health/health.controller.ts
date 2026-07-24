import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';

// Lightweight liveness probe for Railway health checks and uptime monitors.
// Deliberately does NOT touch Postgres so it stays fast and reports process
// liveness independent of DB availability. @Public bypasses the global
// JwtAuthGuard so the probe gets a 200 instead of a 401.
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
