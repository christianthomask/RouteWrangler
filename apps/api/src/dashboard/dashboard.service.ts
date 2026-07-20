import { Inject, Injectable } from '@nestjs/common';
import { count, eq } from 'drizzle-orm';
import type { Dashboard, RunProgress, SeverityCode } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
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
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(): Promise<Dashboard> {
    const today = new Date().toISOString().slice(0, 10);

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

    const sevRows = await this.db
      .select({ severity: severities.code, n: count() })
      .from(exceptions)
      .innerJoin(severities, eq(exceptions.severityId, severities.id))
      .where(eq(exceptions.status, 'open'))
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
      .select({ readerId: readEvents.readerId, n: count() })
      .from(exceptions)
      .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
      .groupBy(readEvents.readerId);
    const exMap = new Map(exByReader.map((r) => [r.readerId, r.n]));

    const readers = readerRows.map((r) => {
      const reads = readsMap.get(r.id) ?? 0;
      const ex = exMap.get(r.id) ?? 0;
      return {
        readerId: r.id,
        readerName: r.name,
        reads,
        exceptions: ex,
        exceptionRate: reads ? Math.round((ex / reads) * 100) / 100 : 0,
      };
    });

    return { runs, exceptionsBySeverity, openExceptions, readers, agingRuns };
  }
}
