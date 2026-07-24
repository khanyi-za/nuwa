import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import { buildCorsOptions } from './cors.config';

async function bootstrap() {
  // `rawBody: true` captures req.rawBody as a Buffer. Required by BOTH
  // webhook handlers: Paystack signs HMAC-SHA512 over the exact request
  // bytes, and ShipLogic's handler hashes them for idempotency.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Wire class-validator's container resolver to NestJS DI so custom validators
  // can inject providers (e.g. IsCloudinaryUrl needs CloudinaryConfig). Without
  // this, custom validators that depend on DI fail at runtime.
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  // Express trust-proxy config drives req.ip resolution. Required for the
  // Correct req.ip resolution behind the load balancer (webhook audit rows
  // record source IPs). Defaults to 1 (Railway's single edge proxy hop);
  // override via TRUST_PROXY env var if topology changes (e.g., Cloudflare
  // added in front).
  const trustProxyRaw = process.env.TRUST_PROXY;
  const trustProxy =
    trustProxyRaw === undefined || trustProxyRaw === ''
      ? 1
      : Number.parseInt(trustProxyRaw, 10);
  if (Number.isNaN(trustProxy) || trustProxy < 0) {
    throw new Error(
      `TRUST_PROXY must be a non-negative integer, got '${trustProxyRaw}'`,
    );
  }
  app.set('trust proxy', trustProxy);

  // CORS is app-wide. Without it, the browser blocks every cross-origin
  // request from the Next.js frontend. Payment/shipping webhooks are server-to-
  // server (no Origin header) and is unaffected. `credentials: true` is
  // required for the refresh-token httpOnly cookie. See cors.config.ts for
  // the env-driven allowlist + production guard.
  app.enableCors(buildCorsOptions());

  // socket.io transport for the chat gateway (ChatModule). Same HTTP server;
  // the /chat namespace authenticates the JWT on handshake.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Bind to the IPv6 wildcard (also accepts IPv4). Railway's health check and
  // private networking reach the container over IPv6, so binding 0.0.0.0 (or
  // relying on Node's default) leaves the probe unable to connect.
  await app.listen(process.env.PORT ?? 3000, '::');
}
bootstrap();
