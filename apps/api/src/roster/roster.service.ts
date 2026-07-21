import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import type { RosterReader } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { exceptions, readEvents, routeRuns, runStops, users } from '../db/schema';

/** Roster — readers as entities (BUILD_SPEC §7.3). */
@Injectable()
export class RosterService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<RosterReader[]> {
    const today = new Date().toISOString().slice(0, 10);
    const readers = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      // Deactivated staff keep their rows for history but must not appear as
      // assignable readers.
      .where(and(eq(users.role, 'reader'), eq(users.active, true)));

    const reads = new Map(
      (await this.db.select({ r: readEvents.readerId, n: count() }).from(readEvents).groupBy(readEvents.readerId)).map(
        (x) => [x.r, x.n],
      ),
    );
    const exs = new Map(
      (
        await this.db
          .select({ r: readEvents.readerId, n: count() })
          .from(exceptions)
          .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
          .groupBy(readEvents.readerId)
      ).map((x) => [x.r, x.n]),
    );

    const out: RosterReader[] = [];
    for (const r of readers) {
      const todayRuns = await this.db
        .select({ id: routeRuns.id, status: routeRuns.status })
        .from(routeRuns)
        .where(and(eq(routeRuns.readerId, r.id), eq(routeRuns.runDate, today)));

      let read = 0;
      let total = 0;
      for (const run of todayRuns) {
        const counts = await this.db
          .select({ status: runStops.status, n: count() })
          .from(runStops)
          .where(eq(runStops.runId, run.id))
          .groupBy(runStops.status);
        for (const c of counts) {
          total += c.n;
          if (c.status === 'read' || c.status === 'skipped') read += c.n;
        }
      }

      const reads_ = reads.get(r.id) ?? 0;
      const ex_ = exs.get(r.id) ?? 0;
      out.push({
        readerId: r.id,
        name: r.name,
        todaysRuns: todayRuns.length,
        openRuns: todayRuns.filter((x) => x.status === 'open').length,
        completionRate: total ? Math.round((read / total) * 100) : 0,
        reads: reads_,
        exceptions: ex_,
        exceptionRate: reads_ ? Math.round((ex_ / reads_) * 100) / 100 : 0,
      });
    }
    return out;
  }
}
