import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

// Lightweight liveness probe for Railway health checks and uptime monitors.
// Deliberately does NOT touch Postgres so it stays fast and reports process
// liveness independent of DB availability.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
