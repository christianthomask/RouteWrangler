import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  // rawBody: true preserves the exact request bytes so the Clerk webhook can
  // verify its Svix signature (see webhooks/clerk-webhook.controller.ts).
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    rawBody: true,
  });

  // Request/response validation is Zod-based via @routewrangler/contracts
  // (ADR-001), not class-validator — so no global ValidationPipe here.
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');

  const logger = new Logger('bootstrap');
  logger.log(`routewrangler-api listening on :${env.PORT}`);
  logger.log(`auth provider: ${env.AUTH_PROVIDER} (${env.authConfigured ? 'configured' : 'unconfigured'})`);
  if (!env.authConfigured && !env.authDevBypass) {
    logger.warn('auth not configured — authenticated endpoints return 503 (see docs/runbook.md)');
  }
  if (env.authDevBypass) {
    logger.warn('AUTH_DEV_BYPASS active — trusting x-dev-user-sub (local only, never prod)');
  }
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
