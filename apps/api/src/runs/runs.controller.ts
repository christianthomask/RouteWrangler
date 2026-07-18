import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { RunDetail, RunListResponse, RunStatus } from '@routewrangler/contracts';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  /**
   * GET /runs — a reader sees only their own runs; staff may filter by reader
   * (client scoping is a query concern, not a guard concern — ADR-007).
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: RunStatus,
    @Query('readerId') readerId?: string,
  ): Promise<RunListResponse> {
    const effectiveReader = user.role === 'reader' ? user.id : readerId;
    const runs = await this.runs.list({ readerId: effectiveReader, status });
    return { runs };
  }

  /** GET /runs/:id — run detail with ordered stops (feeds simulator playback). */
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<RunDetail> {
    return this.runs.detail(id);
  }
}
