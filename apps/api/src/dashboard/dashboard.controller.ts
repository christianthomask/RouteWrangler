import { Controller, Get } from '@nestjs/common';
import type { Dashboard } from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { DashboardService } from './dashboard.service';

@Roles('supervisor', 'admin')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(): Promise<Dashboard> {
    return this.dashboard.get();
  }
}
