import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateStaffRequestSchema,
  UpdateStaffActiveRequestSchema,
  UpdateStaffRoleRequestSchema,
  type CreateStaffResponse,
  type StaffListResponse,
  type StaffMember,
} from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { StaffService } from './staff.service';

/** Staff administration — the only admin-gated surface in the API (ADR-024). */
@Roles('admin')
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(): Promise<StaffListResponse> {
    return this.staff.list();
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: AuthUser): Promise<CreateStaffResponse> {
    const parsed = CreateStaffRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.staff.create(parsed.data, user.id);
  }

  @Patch(':id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<StaffMember> {
    const parsed = UpdateStaffRoleRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.staff.setRole(id, parsed.data.role, user.id);
  }

  @Patch(':id/active')
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<StaffMember> {
    const parsed = UpdateStaffActiveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.staff.setActive(id, parsed.data.active, user.id);
  }

  /**
   * Withdraw an invitation that was never accepted — the wrong address, or
   * someone who never started. Only ever removes rows with no identity attached;
   * a staff member who has signed in is deactivated, never deleted (ADR-027).
   */
  @Delete('invitations/:id')
  @HttpCode(204)
  revokeInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.staff.revokeInvitation(id, user.id);
  }
}
