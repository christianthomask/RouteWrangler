import { Module } from '@nestjs/common';
import { RereadTasksController } from './reread-tasks.controller';
import { RereadTasksService } from './reread-tasks.service';

/** Reader-facing field endpoints (reread task delivery). */
@Module({
  controllers: [RereadTasksController],
  providers: [RereadTasksService],
})
export class FieldModule {}
