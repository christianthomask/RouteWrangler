import { Controller, Get } from '@nestjs/common';
import type { RereadTasksResponse } from '@routewrangler/contracts';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { RereadTasksService } from './reread-tasks.service';

@Controller('reread-tasks')
export class RereadTasksController {
  constructor(private readonly tasks: RereadTasksService) {}

  /** GET /reread-tasks — the current reader's outstanding reread tasks. */
  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<RereadTasksResponse> {
    return { tasks: await this.tasks.listForReader(user.id) };
  }
}
