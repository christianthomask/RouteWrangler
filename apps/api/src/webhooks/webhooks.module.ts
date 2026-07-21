import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';

/** Inbound provider webhooks (currently Clerk org-membership → users). */
@Module({
  controllers: [ClerkWebhookController],
  providers: [ClerkWebhookService],
})
export class WebhooksModule {}
