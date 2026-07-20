import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/** Billing export (BUILD_SPEC §7.4, W4). */
@Module({
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
