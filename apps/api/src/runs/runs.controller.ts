import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  AssignRunRequestSchema,
  ReassignRequestSchema,
  SkipStopRequestSchema,
  SplitRequestSchema,
  type RunDetail,
  type RunListResponse,
  type RunStatus,
} from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
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

  /** POST /runs — supervisor-owned assignment (W1). */
  @Roles('supervisor', 'admin')
  @Post()
  assign(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<RunDetail> {
    const parsed = AssignRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.runs.assign(parsed.data, user.id);
  }

  @Roles('supervisor', 'admin')
  @Post(':id/reassign')
  reassign(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() user: AuthUser): Promise<RunDetail> {
    const parsed = ReassignRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.runs.reassign(id, parsed.data, user.id);
  }

  @Roles('supervisor', 'admin')
  @Post(':id/split')
  split(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() user: AuthUser): Promise<RunDetail> {
    const parsed = SplitRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.runs.split(id, parsed.data, user.id);
  }

  /** POST /runs/:id/stops/:stopId/skip — reader skips a stop with a reason. */
  @Post(':id/stops/:stopId/skip')
  skip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() body: unknown,
  ): Promise<RunDetail> {
    const parsed = SkipStopRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.runs.skipStop(id, stopId, parsed.data.skipReasonCode);
  }
}
