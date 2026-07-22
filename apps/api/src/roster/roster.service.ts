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

    /*
     * Two queries for the whole roster, not two per reader plus one per run.
     * The previous shape issued 1 + N + M statements — fine at four readers,
     * untenable at four hundred.
     */
    const allRuns = await this.db
      .select({
        id: routeRuns.id,
        readerId: routeRuns.readerId,
        status: routeRuns.status,
        runDate: routeRuns.runDate,
        timezone: clients.timezone,
      })
      .from(routeRuns)
      .innerJoin(clients, eq(routeRuns.clientId, clients.id));

    // "Today" belongs to the client whose work it is, so each run is judged
    // against its own client's zone rather than one server-wide date.
    const todayByReader = new Map<string, typeof allRuns>();
    for (const run of allRuns) {
      if (!run.readerId) continue;
      if (run.runDate !== todayIn(run.timezone || this.env.APP_TIMEZONE)) continue;
      const list = todayByReader.get(run.readerId) ?? [];
      list.push(run);
      todayByReader.set(run.readerId, list);
    }

    const stopCounts = await this.db
      .select({ runId: runStops.runId, status: runStops.status, n: count() })
      .from(runStops)
      .groupBy(runStops.runId, runStops.status);
    const countsByRun = new Map<string, { done: number; total: number }>();
    for (const c of stopCounts) {
      const agg = countsByRun.get(c.runId) ?? { done: 0, total: 0 };
      agg.total += c.n;
      if (c.status === 'read' || c.status === 'skipped') agg.done += c.n;
      countsByRun.set(c.runId, agg);
    }


    /*
     * Skip exceptions are attributed through the *run*, not a read — a skip has
     * no reading to hang off. Counted into the reader's exception total (a
     * reader who skips heavily should show up), but never into `flagged`, which
     * is the share of their *reads* that tripped a rule and must stay bounded.
     */
    const skipExByReader = await this.db
      .select({ readerId: routeRuns.readerId, n: count() })
      .from(exceptions)
      .innerJoin(runStops, eq(exceptions.runStopId, runStops.id))
      .innerJoin(routeRuns, eq(runStops.runId, routeRuns.id))
      .groupBy(routeRuns.readerId);
    const skipExMap = new Map(
      skipExByReader.filter((r) => r.readerId).map((r) => [r.readerId as string, r.n]),
    );

    const out: RosterReader[] = [];
    for (const r of readers) {
      const todayRuns = todayByReader.get(r.id) ?? [];
      let read = 0;
      let total = 0;
      for (const run of todayRuns) {
        const agg = countsByRun.get(run.id);
        if (!agg) continue;
        read += agg.done;
        total += agg.total;
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
        exceptions: (ex_?.n ?? 0) + (skipExMap.get(r.id) ?? 0),
        exceptionRate: rateOf(ex_?.flagged ?? 0, reads_),
      });
    }
    return out;
  }
}
