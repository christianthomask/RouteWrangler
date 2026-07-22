import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  RunExportRequestSchema,
  type ExportCyclesResponse,
  type ExportListResponse,
  type ExportPreview,
  type ExportRunView,
} from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { ExportsService } from './exports.service';

/** Billing export endpoints (BUILD_SPEC §7.4). Supervisor/admin only. */
@Roles('supervisor', 'admin')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('cycles')
  async cycles(
    // Without the explicit exception factory a missing param reaches the pipe as
    // `undefined` and surfaces the internal "The value passed as UUID is not a
    // string" rather than naming the parameter the caller left out.
    @Query('clientId', new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException('clientId is required and must be a uuid') }))
    clientId: string,
  ): Promise<ExportCyclesResponse> {
    return { cycles: await this.exports.cyclesFor(clientId) };
  }

  @Get('preview')
  preview(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('cycleId') cycleId: string,
  ): Promise<ExportPreview> {
    return this.exports.preview(clientId, cycleId);
  }

  @Get()
  list(@Query('clientId') clientId?: string): Promise<ExportListResponse> {
    return this.exports.list(clientId);
  }

  @Post()
  run(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<ExportRunView> {
    const req = RunExportRequestSchema.parse(body);
    return this.exports.run(req.clientId, req.cycleId, user);
  }

  @Get(':id/download')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.exports.file(id);
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${file.filename}"`)
      .send(file.body);
  }
}
