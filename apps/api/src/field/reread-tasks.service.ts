import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { ExceptionCode, RereadTaskView } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { exceptions, exceptionTypes, meters, readEvents, rereadTasks, runStops } from '../db/schema';

/** Reader's reread task list (BUILD_SPEC §7.2) — advances issued→delivered on fetch. */
@Injectable()
export class RereadTasksService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForReader(readerId: string): Promise<RereadTaskView[]> {
    const rows = await this.db
      .select({
        id: rereadTasks.id,
        exceptionId: rereadTasks.exceptionId,
        status: rereadTasks.status,
        createdAt: rereadTasks.createdAt,
        meterId: exceptions.meterId,
        meterSerial: meters.serial,
        serviceAddress: meters.serviceAddress,
        typeCode: exceptionTypes.code,
        typeLabel: exceptionTypes.label,
        flaggedValue: readEvents.value,
        // Resolved so the reader can tap straight through to the capture screen
        // — the task was otherwise a dead end and the reread loop could not be
        // closed through the UI at all.
        runStopId: readEvents.runStopId,
        runId: runStops.runId,
      })
      .from(rereadTasks)
      .innerJoin(exceptions, eq(rereadTasks.exceptionId, exceptions.id))
      .innerJoin(exceptionTypes, eq(exceptions.typeId, exceptionTypes.id))
      .innerJoin(meters, eq(exceptions.meterId, meters.id))
      .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
      // left: a read taken outside a run (backfill) has no stop to return to.
      .leftJoin(runStops, eq(readEvents.runStopId, runStops.id))
      .where(and(eq(rereadTasks.readerId, readerId), ne(rereadTasks.status, 'done')))
      .orderBy(desc(rereadTasks.createdAt));

    // Delivered-on-sync: newly issued tasks become delivered once fetched.
    await this.db
      .update(rereadTasks)
      .set({ status: 'delivered', updatedAt: new Date() })
      .where(and(eq(rereadTasks.readerId, readerId), eq(rereadTasks.status, 'issued')));

    return rows.map((r) => ({
      id: r.id,
      exceptionId: r.exceptionId,
      status: r.status === 'issued' ? 'delivered' : r.status,
      meterId: r.meterId,
      meterSerial: r.meterSerial,
      serviceAddress: r.serviceAddress,
      typeCode: r.typeCode as ExceptionCode,
      typeLabel: r.typeLabel,
      flaggedValue: r.flaggedValue,
      runId: r.runId,
      runStopId: r.runStopId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
