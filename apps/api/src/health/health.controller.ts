import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    let db: 'up' | 'down' = 'up';
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      db = 'down';
    }
    return { status: 'ok', service: 'routewrangler-api', db };
  }
}
