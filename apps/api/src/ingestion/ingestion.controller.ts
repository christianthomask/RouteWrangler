import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IngestRequestSchema, type IngestResponse } from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { IngestionService } from './ingestion.service';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /**
   * POST /ingest/read-events — the one ingestion API (BUILD_SPEC §2.1, §9). Any
   * client (field app, simulator) posts single or batch. Authenticated and
   * role-gated (H2); the reader identity is the caller, never the request body.
   * Validated with the shared Zod contract; idempotent per event id.
   */
  @Roles('reader', 'supervisor', 'admin')
  @Post('read-events')
  async ingest(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<IngestResponse> {
    const parsed = IngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.ingestion.ingest(parsed.data, { id: user.id, role: user.role });
  }
}
