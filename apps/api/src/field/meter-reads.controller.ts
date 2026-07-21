import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { FieldMeterReadsResponse } from '@routewrangler/contracts';
import { CurrentUser, type AuthUser } from '../auth/current-user';
import { MeterReadsService } from './meter-reads.service';

@Controller('field/meters')
export class MeterReadsController {
  constructor(private readonly reads: MeterReadsService) {}

  /**
   * GET /field/meters/:id/reads — access notes + recent reads for the field screen.
   * A reader may only pull a meter that appears on one of their own runs;
   * otherwise this would expose access notes and history for any meter in any
   * client to anyone holding a valid token.
   */
  @Get(':id/reads')
  async forMeter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FieldMeterReadsResponse> {
    await this.reads.assertMeterAccess(id, user);
    return this.reads.forMeter(id);
  }
}
