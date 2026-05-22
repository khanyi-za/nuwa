import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import { PayfastConfig } from './payments/payfast/payfast-config';
import { buildCorsOptions } from './cors.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Wire class-validator's container resolver to NestJS DI so custom validators
  // can inject providers (e.g. IsCloudinaryUrl needs CloudinaryConfig). Without
  // this, custom validators that depend on DI fail at runtime.
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  // Express trust-proxy config drives req.ip resolution. Required for the
  // PayFast ITN webhook source-IP allowlist check. Defaults to 1 (Railway's
  // single edge proxy hop); override via TRUST_PROXY env var if topology
  // changes (e.g., Cloudflare added in front).
  const payfastConfig = app.get(PayfastConfig);
  app.set('trust proxy', payfastConfig.trustProxy);

  // CORS is app-wide. Without it, the browser blocks every cross-origin
  // request from the Next.js frontend. The PayFast ITN webhook is server-to-
  // server (no Origin header) and is unaffected. `credentials: true` is
  // required for the refresh-token httpOnly cookie. See cors.config.ts for
  // the env-driven allowlist + production guard.
  app.enableCors(buildCorsOptions());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
