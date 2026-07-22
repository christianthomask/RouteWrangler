import { Inject, Injectable } from '@nestjs/common';
import { count, countDistinct, eq, notInArray } from 'drizzle-orm';
import type { Dashboard, RunProgress, SeverityCode } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { todayIn } from '../config/clock';
import { TERMINAL_STATUSES, rateOf } from '../exceptions/lifecycle';
import type { Database } from '../db/client';
import {
  clients,
  exceptions,
  readEvents,
  routeRuns,
  routes,
  runStops,
  severities,
  users,
} from '../db/schema';

/** Supervisor dashboard aggregates (BUILD_SPEC §7.3). */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async get(): Promise<Dashboard> {
    const today = todayIn(this.env.APP_TIMEZONE);

    const runRows = await this.db
      .select({
        runId: routeRuns.id,
        routeName: routes.name,
        clientName: clients.name,
        readerName: users.displayName,
        runDate: routeRuns.runDate,
        status: routeRuns.status,
      })
      .from(routeRuns)
      .innerJoin(routes, eq(routeRuns.routeId, routes.id))
      .innerJoin(clients, eq(routeRuns.clientId, clients.id))
      .leftJoin(users, eq(routeRuns.readerId, users.id));

    const stopCounts = await this.db
      .select({ runId: runStops.runId, status: runStops.status, n: count() })
      .from(runStops)
      .groupBy(runStops.runId, runStops.status);

    const countsByRun = new Map<string, { read: number; skipped: number; pending: number }>();
    for (const s of stopCounts) {
      const c = countsByRun.get(s.runId) ?? { read: 0, skipped: 0, pending: 0 };
      if (s.status === 'read') c.read = s.n;
      else if (s.status === 'skipped') c.skipped = s.n;
      else c.pending = s.n;
      countsByRun.set(s.runId, c);
    }

    const toProgress = (r: (typeof runRows)[number]): RunProgress => {
      const c = countsByRun.get(r.runId) ?? { read: 0, skipped: 0, pending: 0 };
      const total = c.read + c.skipped + c.pending;
      return {
        runId: r.runId,
        routeName: r.routeName,
        clientName: r.clientName,
        readerName: r.readerName,
        runDate: r.runDate,
        status: r.status,
        totalStops: total,
        readStops: c.read,
        skippedStops: c.skipped,
        pendingStops: c.pending,
        completionPct: total ? Math.round(((c.read + c.skipped) / total) * 100) : 0,
      };
    };

    const runs = runRows.filter((r) => r.runDate === today).map(toProgress);
    const agingRuns = runRows
      .filter((r) => r.status === 'open' && r.runDate < today)
      .map(toProgress);

    // Counts every *non-terminal* exception, not just `status = 'open'`. A
    // reread that has been ordered or received is still the supervisor's work;
    // filtering to 'open' made ordering a reread look like closing the item, so
    // outstanding work silently left the board. TERMINAL_STATUSES is the same
    // definition the lifecycle guards use, so the count cannot drift from it.
    const sevRows = await this.db
      .select({ severity: severities.code, n: count() })
      .from(exceptions)
      .innerJoin(severities, eq(exceptions.severityId, severities.id))
      .where(notInArray(exceptions.status, TERMINAL_STATUSES))
      .groupBy(severities.code);
    const exceptionsBySeverity = sevRows.map((s) => ({
      severity: s.severity as SeverityCode,
      open: s.n,
    }));
    const openExceptions = exceptionsBySeverity.reduce((a, b) => a + b.open, 0);

    const readerRows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(eq(users.role, 'reader'));

    const readsByReader = await this.db
      .select({ readerId: readEvents.readerId, n: count() })
      .from(readEvents)
      .groupBy(readEvents.readerId);
    const readsMap = new Map(readsByReader.map((r) => [r.readerId, r.n]));

    const exByReader = await this.db
      .select({
        readerId: readEvents.readerId,
        n: count(),
        // A single read can raise several exceptions — a leak spike and a
        // location-absent from one reading. Dividing raw exception rows by reads
        // is therefore unbounded above 1, and rendered a reader at "138%".
        // The rate is the share of a reader's reads that got flagged, so it
        // counts distinct flagged reads; `n` stays the true exception total.
        flagged: countDistinct(exceptions.readEventId),
      })
      .from(exceptions)
      .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
      .groupBy(readEvents.readerId);
    const exMap = new Map(exByReader.map((r) => [r.readerId, r]));

    const readers = readerRows.map((r) => {
      const reads = readsMap.get(r.id) ?? 0;
      const ex = exMap.get(r.id);
      return {
        readerId: r.id,
        readerName: r.name,
        reads,
        exceptions: ex?.n ?? 0,
        exceptionRate: rateOf(ex?.flagged ?? 0, reads),
      };
    });

    return { runs, exceptionsBySeverity, openExceptions, readers, agingRuns };
  }
}
