import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { FieldMeterReadsResponse } from '@routewrangler/contracts';
import { MeterReadsService } from './meter-reads.service';

@Controller('field/meters')
export class MeterReadsController {
  constructor(private readonly reads: MeterReadsService) {}

  /** GET /field/meters/:id/reads — access notes + recent reads for the field screen. */
  @Get(':id/reads')
  forMeter(@Param('id', ParseUUIDPipe) id: string): Promise<FieldMeterReadsResponse> {
    return this.reads.forMeter(id);
  }
}
