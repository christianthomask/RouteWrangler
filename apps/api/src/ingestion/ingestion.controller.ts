import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IngestRequestSchema, type IngestResponse } from '@routewrangler/contracts';
import { IngestionService } from './ingestion.service';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /**
   * POST /ingest/read-events — the one public ingestion API (BUILD_SPEC §2.1,
   * §9). Any client (field app, simulator) posts single or batch. Validated with
   * the shared Zod contract; idempotent per event id.
   */
  @Post('read-events')
  async ingest(@Body() body: unknown): Promise<IngestResponse> {
    const parsed = IngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.ingestion.ingest(parsed.data);
  }
}
