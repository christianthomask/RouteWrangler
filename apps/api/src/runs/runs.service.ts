import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { RunDetail, RunStatus, RunSummary } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { meters, readEvents, routeRuns, runStops } from '../db/schema';

/**
 * Minimal run reads for Sprint 1 — enough for the simulator's playback client to
 * fetch its worklist over the public API (no privileged DB access). Full run
 * lifecycle (materialization, splits, close-out) is Sprint 3.
 */
@Injectable()
export class RunsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(filter: { readerId?: string; status?: RunStatus }): Promise<RunSummary[]> {
    const conds = [];
    if (filter.readerId) conds.push(eq(routeRuns.readerId, filter.readerId));
    if (filter.status) conds.push(eq(routeRuns.status, filter.status));
    const rows = await this.db
      .select()
      .from(routeRuns)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(routeRuns.runDate));
    return rows.map(toSummary);
  }

  async detail(runId: string): Promise<RunDetail> {
    const [run] = await this.db.select().from(routeRuns).where(eq(routeRuns.id, runId)).limit(1);
    if (!run) throw new NotFoundException('run not found');

    const stopRows = await this.db
      .select({
        id: runStops.id,
        meterId: runStops.meterId,
        sequence: runStops.sequence,
        status: runStops.status,
        serial: meters.serial,
        registerDials: meters.registerDials,
        lat: meters.lat,
        lng: meters.lng,
      })
      .from(runStops)
      .innerJoin(meters, eq(runStops.meterId, meters.id))
      .where(eq(runStops.runId, runId))
      .orderBy(asc(runStops.sequence));

    const lastValues = await this.latestValues(stopRows.map((s) => s.meterId));

    return {
      ...toSummary(run),
      stops: stopRows.map((s) => ({
        id: s.id,
        meterId: s.meterId,
        sequence: s.sequence,
        status: s.status,
        meterSerial: s.serial,
        registerDials: s.registerDials,
        lat: s.lat,
        lng: s.lng,
        lastValue: lastValues.get(s.meterId) ?? null,
      })),
    };
  }

  /** Latest read value per meter (one query, distinct-on). */
  private async latestValues(meterIds: string[]): Promise<Map<string, number>> {
    if (meterIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([readEvents.meterId], {
        meterId: readEvents.meterId,
        value: readEvents.value,
      })
      .from(readEvents)
      .where(inArray(readEvents.meterId, meterIds))
      .orderBy(readEvents.meterId, desc(readEvents.receivedAt));
    return new Map(rows.map((r) => [r.meterId, r.value]));
  }
}

function toSummary(run: typeof routeRuns.$inferSelect): RunSummary {
  return {
    id: run.id,
    clientId: run.clientId,
    routeId: run.routeId,
    readerId: run.readerId ?? '',
    runDate: run.runDate,
    cycleId: run.cycleId,
    status: run.status,
  };
}
