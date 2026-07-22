import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, eq } from 'drizzle-orm';
import type { RosterReader } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { todayIn } from '../config/clock';
import { rateOf } from '../exceptions/lifecycle';
import type { Database } from '../db/client';
import { clients, exceptions, readEvents, routeRuns, runStops, users } from '../db/schema';

/** Roster — readers as entities (BUILD_SPEC §7.3). */
@Injectable()
export class RosterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(): Promise<RosterReader[]> {
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
    // `n` is the true exception total; `flagged` counts distinct reads that
    // raised at least one, which is what the rate divides by — a single reading
    // can raise both a leak spike and a location-absent (see rateOf).
    const exs = new Map(
      (
        await this.db
          .select({
            r: readEvents.readerId,
            n: count(),
            flagged: countDistinct(exceptions.readEventId),
          })
          .from(exceptions)
          .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
          .groupBy(readEvents.readerId)
      ).map((x) => [x.r, x]),
    );

    const out: RosterReader[] = [];
    for (const r of readers) {
      // "Today" belongs to the client whose work it is, so each run is judged
      // against its own client's zone rather than one server-wide date.
      const runRows = await this.db
        .select({
          id: routeRuns.id,
          status: routeRuns.status,
          runDate: routeRuns.runDate,
          timezone: clients.timezone,
        })
        .from(routeRuns)
        .innerJoin(clients, eq(routeRuns.clientId, clients.id))
        .where(eq(routeRuns.readerId, r.id));
      const todayRuns = runRows.filter(
        (x) => x.runDate === todayIn(x.timezone || this.env.APP_TIMEZONE),
      );

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
      const ex_ = exs.get(r.id);
      out.push({
        readerId: r.id,
        name: r.name,
        todaysRuns: todayRuns.length,
        openRuns: todayRuns.filter((x) => x.status === 'open').length,
        completionRate: total ? Math.round((read / total) * 100) : 0,
        reads: reads_,
        exceptions: ex_?.n ?? 0,
        exceptionRate: rateOf(ex_?.flagged ?? 0, reads_),
      });
    }
    return out;
  }
}
