import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { Public } from '../auth/public.decorator';
import { ClerkWebhookService, type ClerkMembershipEvent } from './clerk-webhook.service';

/**
 * Clerk webhook receiver (ADR-015). Public — it carries no bearer token; its
 * authenticity is proven by the Svix signature over the raw body, verified with
 * `CLERK_WEBHOOK_SECRET`. Requires `rawBody` (see main.ts): the signature is
 * over the exact bytes, so we must not re-serialize the parsed JSON.
 */
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly service: ClerkWebhookService,
  ) {}

  @Public()
  @Post()
  async receive(@Req() req: Request & { rawBody?: Buffer }) {
    const secret = this.env.CLERK_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException(
        'CLERK_WEBHOOK_SECRET not configured — see docs/runbook.md',
      );
    }
    if (!req.rawBody) {
      throw new BadRequestException('missing raw body');
    }

    let evt: ClerkMembershipEvent;
    try {
      const wh = new Webhook(secret);
      evt = wh.verify(req.rawBody.toString('utf8'), {
        'svix-id': header(req, 'svix-id'),
        'svix-timestamp': header(req, 'svix-timestamp'),
        'svix-signature': header(req, 'svix-signature'),
      }) as ClerkMembershipEvent;
    } catch {
      throw new BadRequestException('invalid webhook signature');
    }

    const outcome = await this.service.handle(evt);
    return { ok: true, ...outcome };
  }
}

function header(req: Request, name: string): string {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}
