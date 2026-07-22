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
    @Query('unassigned') unassigned?: string,
  ): Promise<RunListResponse> {
    const isReader = user.role === 'reader';
    const effectiveReader = isReader ? user.id : readerId;
    const runs = await this.runs.list({
      readerId: effectiveReader,
      status,
      // A reader is always clamped to their own runs, so they can never ask for
      // the unassigned pool.
      unassigned: !isReader && unassigned === 'true',
    });
    return { runs };
  }

  /** GET /runs/:id — run detail with ordered stops (feeds simulator playback). */
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<RunDetail> {
    await this.runs.assertRunAccess(id, user);
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
  async skip(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stopId', ParseUUIDPipe) stopId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<RunDetail> {
    const parsed = SkipStopRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.runs.assertRunAccess(id, user);
    return this.runs.skipStop(
      id,
      stopId,
      parsed.data.skipReasonCode,
      user.id,
      parsed.data.photoKey,
    );
  }
}
