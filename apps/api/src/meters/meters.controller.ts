import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { MeterHistoryResponse } from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { MetersService } from './meters.service';

@Roles('supervisor', 'admin')
@Controller('meters')
export class MetersController {
  constructor(private readonly meters: MetersService) {}

  /** GET /meters/:id/history (BUILD_SPEC §9). */
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string): Promise<MeterHistoryResponse> {
    return this.meters.history(id);
  }
}
