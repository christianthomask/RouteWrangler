import { Controller, Get } from '@nestjs/common';
import type { RosterResponse } from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { RosterService } from './roster.service';

@Roles('supervisor', 'admin')
@Controller('roster')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get()
  async list(): Promise<RosterResponse> {
    return { readers: await this.roster.list() };
  }
}
