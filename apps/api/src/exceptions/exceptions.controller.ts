import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ExceptionFiltersSchema,
  NoteRequestSchema,
  OrderRereadRequestSchema,
  ResolveRequestSchema,
  type ExceptionDetail,
  type ExceptionListResponse,
} from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { ExceptionsService } from './exceptions.service';

/** The supervisor console centerpiece (BUILD_SPEC §7.3). Staff-only. */
@Roles('supervisor', 'admin')
@Controller('exceptions')
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  async list(@Query() query: unknown): Promise<ExceptionListResponse> {
    const parsed = ExceptionFiltersSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const items = await this.exceptions.list(parsed.data);
    return { exceptions: items, total: items.length };
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ExceptionDetail> {
    return this.exceptions.detail(id);
  }

  @Post(':id/reread')
  reread(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ExceptionDetail> {
    const parsed = OrderRereadRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.exceptions.orderReread(id, parsed.data.note, user.id);
  }

  @Post(':id/override')
  override(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ExceptionDetail> {
    const parsed = ResolveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.exceptions.override(id, parsed.data, user.id);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ExceptionDetail> {
    const parsed = ResolveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.exceptions.resolve(id, parsed.data, user.id);
  }

  @Post(':id/escalate')
  escalate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ExceptionDetail> {
    const parsed = NoteRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.exceptions.escalate(id, parsed.data.note, user.id);
  }
}
