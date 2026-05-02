import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { PayfastConfig } from './payments/payfast/payfast-config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Express trust-proxy config drives req.ip resolution. Required for the
  // PayFast ITN webhook source-IP allowlist check. Defaults to 1 (Railway's
  // single edge proxy hop); override via TRUST_PROXY env var if topology
  // changes (e.g., Cloudflare added in front).
  const payfastConfig = app.get(PayfastConfig);
  app.set('trust proxy', payfastConfig.trustProxy);

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
