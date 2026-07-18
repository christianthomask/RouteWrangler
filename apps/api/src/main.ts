import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });

  // Request/response validation is Zod-based via @routewrangler/contracts
  // (ADR-001), not class-validator — so no global ValidationPipe here.
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  const logger = new Logger('bootstrap');
  logger.log(`routewrangler-api listening on :${env.PORT}`);
  if (!env.authConfigured) {
    logger.warn('Cognito not configured — authenticated endpoints return 503 (see docs/runbook.md)');
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
