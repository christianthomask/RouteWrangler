import { Module } from '@nestjs/common';
import { RereadTasksController } from './reread-tasks.controller';
import { RereadTasksService } from './reread-tasks.service';
import { MeterReadsController } from './meter-reads.controller';
import { MeterReadsService } from './meter-reads.service';

/** Reader-facing field endpoints (reread task delivery, meter read history). */
@Module({
  controllers: [RereadTasksController, MeterReadsController],
  providers: [RereadTasksService, MeterReadsService],
})
export class FieldModule {}
