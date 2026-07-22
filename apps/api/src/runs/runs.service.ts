import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, notExists, sql, type SQL } from 'drizzle-orm';
import type {
  AssignRunRequest,
  ReassignRequest,
  RunDetail,
  RunStatus,
  RunSummary,
  Role,
  SkipReasonCode,
  SplitRequest,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { todayIn } from '../config/clock';
import type { Database } from '../db/client';
import {
  clients,
  meters,
  readEvents,
  routeRuns,
  routes,
  routeStops,
  runStops,
  skipReasons,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { currentCycleId } from '../catalog/catalog.service';
import { validateSplit, type StopLite } from './split';

/**
 * Run reads (Sprint 1) + assignment lifecycle (W1, ADR-005): materialize a run
 * from a route, reassign before it starts, and split a contiguous range of
 * pending stops to another reader. Every mutation is audited.
 */
@Injectable()
export class RunsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async list(filter: {
    readerId?: string;
    status?: RunStatus;
    unassigned?: boolean;
  }): Promise<RunSummary[]> {
    const conds = [];
    if (filter.unassigned) conds.push(isNull(routeRuns.readerId));
    else if (filter.readerId) conds.push(eq(routeRuns.readerId, filter.readerId));
    if (filter.status) conds.push(eq(routeRuns.status, filter.status));
    return this.summaries(conds.length ? and(...conds) : undefined);
  }

  /**
   * Run summaries with route/client/reader names and stop progress resolved in
   * one query, so neither console has to render a bare UUID or fan out per run.
   */
  private async summaries(where: SQL | undefined): Promise<RunSummary[]> {
    const done: SQL<number> = sql<number>`count(*) filter (where ${runStops.status} in ('read','skipped'))`;
    const rows = await this.db
      .select({
        run: routeRuns,
        routeName: routes.name,
        clientName: clients.name,
        readerName: users.displayName,
        stopCount: sql<number>`count(${runStops.id})`,
        completedCount: done,
      })
      .from(routeRuns)
      .innerJoin(routes, eq(routeRuns.routeId, routes.id))
      .innerJoin(clients, eq(routeRuns.clientId, clients.id))
      // left: an unassigned run still has to appear in the list.
      .leftJoin(users, eq(routeRuns.readerId, users.id))
      .leftJoin(runStops, eq(runStops.runId, routeRuns.id))
      .where(where)
      .groupBy(routeRuns.id, routes.name, clients.name, users.displayName)
      .orderBy(desc(routeRuns.runDate));

    return rows.map((r) => ({
      ...toSummary(r.run),
      routeName: r.routeName,
      clientName: r.clientName,
      readerName: r.readerName ?? null,
      stopCount: Number(r.stopCount),
      completedCount: Number(r.completedCount),
    }));
  }

  /**
   * Readers may only touch runs assigned to them; supervisors and admins see
   * everything (ADR-007). Scoping is a query concern rather than a guard
   * concern, so endpoints reachable by a reader must call this explicitly —
   * `@Roles` alone does not constrain *which* run is addressed.
   */
  async assertRunAccess(runId: string, actor: { id: string; role: Role }): Promise<void> {
    if (actor.role !== 'reader') return;
    const [run] = await this.db
      .select({ readerId: routeRuns.readerId })
      .from(routeRuns)
      .where(eq(routeRuns.id, runId))
      .limit(1);
    // Same 404 whether the run is missing or simply someone else's, so the
    // endpoint can't be used to probe for valid run ids.
    if (!run || run.readerId !== actor.id) throw new NotFoundException('run not found');
  }

  async detail(runId: string): Promise<RunDetail> {
    const [summary] = await this.summaries(eq(routeRuns.id, runId));
    if (!summary) throw new NotFoundException('run not found');

    const stopRows = await this.db
      .select({
        id: runStops.id,
        meterId: runStops.meterId,
        sequence: runStops.sequence,
        status: runStops.status,
        serial: meters.serial,
        serviceAddress: meters.serviceAddress,
        registerDials: meters.registerDials,
        lat: meters.lat,
        lng: meters.lng,
        skipReasonCode: skipReasons.code,
      })
      .from(runStops)
      .innerJoin(meters, eq(runStops.meterId, meters.id))
      // left: only a skipped stop has a reason.
      .leftJoin(skipReasons, eq(runStops.skipReasonId, skipReasons.id))
      .where(eq(runStops.runId, runId))
      .orderBy(asc(runStops.sequence));

    const lastValues = await this.latestValues(stopRows.map((s) => s.meterId));

    return {
      ...summary,
      stops: stopRows.map((s) => ({
        id: s.id,
        meterId: s.meterId,
        sequence: s.sequence,
        status: s.status,
        meterSerial: s.serial,
        serviceAddress: s.serviceAddress,
        registerDials: s.registerDials,
        lat: s.lat,
        lng: s.lng,
        lastValue: lastValues.get(s.meterId) ?? null,
        // The column is plain text; the taxonomy constrains the values.
        skipReasonCode: s.skipReasonCode as SkipReasonCode | null,
      })),
    };
  }

  // ── assignment lifecycle (W1) ────────────────────────────────────────────

  /** Assign a reader to a route → materialize a dated run + its pending stops. */
  async assign(req: AssignRunRequest, actorId: string): Promise<RunDetail> {
    const [route] = await this.db.select().from(routes).where(eq(routes.id, req.routeId)).limit(1);
    if (!route) throw new NotFoundException('route not found');

    // Dated in the client's working day, not the server's. Assigning a route
    // late in the afternoon must not stamp it with tomorrow's date and make it
    // invisible to "today" from the moment it exists.
    const [client] = await this.db
      .select({ timezone: clients.timezone })
      .from(clients)
      .where(eq(clients.id, route.clientId))
      .limit(1);
    const runDate = req.runDate ?? todayIn(client?.timezone || this.env.APP_TIMEZONE);
    const cycleId = req.cycleId ?? currentCycleId(new Date(runDate));
    const runId = randomUUID();

    await this.db.insert(routeRuns).values({
      id: runId,
      routeId: route.id,
      clientId: route.clientId,
      readerId: req.readerId,
      runDate,
      cycleId,
      status: 'open',
    });

    const stops = await this.db
      .select()
      .from(routeStops)
      .where(eq(routeStops.routeId, route.id))
      .orderBy(asc(routeStops.sequence));
    if (stops.length) {
      await this.db.insert(runStops).values(
        stops.map((s) => ({ runId, meterId: s.meterId, sequence: s.sequence, status: 'pending' as const })),
      );
    }

    await this.audit.write({
      actorId,
      action: 'run.assigned',
      entity: 'route_run',
      entityId: runId,
      meta: { routeId: route.id, readerId: req.readerId, runDate, cycleId, stops: stops.length },
    });
    return this.detail(runId);
  }

  /**
   * Reassign a run's reader — only before it starts (no reads yet).
   * `readerId: null` releases the run instead, leaving it unassigned.
   */
  async reassign(runId: string, req: ReassignRequest, actorId: string): Promise<RunDetail> {
    const [run] = await this.db.select().from(routeRuns).where(eq(routeRuns.id, runId)).limit(1);
    if (!run) throw new NotFoundException('run not found');

    /*
     * The "has it started?" test is folded into the UPDATE's WHERE rather than
     * run as a separate SELECT first. Checking and then updating leaves a
     * window in which the reader submits their first read — the check passes,
     * the reassign lands, and the run is now owned by someone else with a read
     * already against it. As one statement the guard is evaluated atomically
     * with the write, so a concurrent read either precedes it (0 rows updated →
     * conflict) or follows it. Two supervisors reassigning at once likewise
     * serialize: both succeed, last write wins, which is the same outcome as
     * doing it sequentially.
     */
    const updated = await this.db
      .update(routeRuns)
      .set({ readerId: req.readerId, updatedAt: new Date() })
      .where(
        and(
          eq(routeRuns.id, runId),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(runStops)
              .where(and(eq(runStops.runId, runId), inArray(runStops.status, ['read', 'skipped']))),
          ),
        ),
      )
      .returning({ id: routeRuns.id });

    if (updated.length === 0) {
      throw new ConflictException('run has already started — mid-run changes use a split');
    }

    await this.audit.write({
      actorId,
      action: req.readerId ? 'run.reassigned' : 'run.released',
      entity: 'route_run',
      entityId: runId,
      meta: { readerId: req.readerId, previousReaderId: run.readerId },
    });
    return this.detail(runId);
  }

  /** Split a contiguous range of pending stops into a new run (ADR-005). */
  async split(runId: string, req: SplitRequest, actorId: string): Promise<RunDetail> {
    const [run] = await this.db.select().from(routeRuns).where(eq(routeRuns.id, runId)).limit(1);
    if (!run) throw new NotFoundException('run not found');

    const stopRows = await this.db.select().from(runStops).where(eq(runStops.runId, runId));
    const lite: StopLite[] = stopRows.map((s) => ({ id: s.id, sequence: s.sequence, status: s.status }));
    const check = validateSplit(lite, req.stopIds);
    if (!check.ok) throw new BadRequestException(check.error);

    const newRunId = randomUUID();
    /*
     * Creating the run and re-parenting its stops must be one unit: a failure
     * between them would leave an empty orphan run, and the stops stranded on
     * the original.
     *
     * The moved-count check closes a subtler race. The status guard below stops
     * a read that lands after validateSplit from being moved — but silently, so
     * the new reader would simply be handed fewer stops than the supervisor
     * selected, with nobody told. Comparing the count against the request turns
     * that into a rollback and a conflict the caller can act on.
     */
    await this.db.transaction(async (tx) => {
      await tx.insert(routeRuns).values({
        id: newRunId,
        routeId: run.routeId,
        clientId: run.clientId,
        readerId: req.toReaderId,
        runDate: run.runDate,
        cycleId: run.cycleId,
        status: 'open',
        splitFromRunId: runId,
      });

      // Re-parent only the pending stops, and only ones still on *this* run.
      const moved = await tx
        .update(runStops)
        .set({ runId: newRunId, updatedAt: new Date() })
        .where(
          and(
            inArray(runStops.id, req.stopIds),
            eq(runStops.runId, runId),
            eq(runStops.status, 'pending'),
          ),
        )
        .returning({ id: runStops.id });

      if (moved.length !== req.stopIds.length) {
        throw new ConflictException(
          'stops changed while the split was being prepared — reload the run and retry',
        );
      }
    });

    const meta = { toReaderId: req.toReaderId, movedStops: req.stopIds.length, newRunId };
    await this.audit.write({ actorId, action: 'run.split_from', entity: 'route_run', entityId: runId, meta });
    await this.audit.write({ actorId, action: 'run.split_to', entity: 'route_run', entityId: newRunId, meta: { ...meta, fromRunId: runId } });

    return this.detail(runId);
  }

  /** Skip a stop with a seeded reason (BUILD_SPEC §7.2). Idempotent: only a
   *  pending stop is skipped; already-read/skipped stops are left as-is. */
  async skipStop(
    runId: string,
    stopId: string,
    code: SkipReasonCode,
    actorId: string,
  ): Promise<RunDetail> {
    const [reason] = await this.db
      .select({ id: skipReasons.id })
      .from(skipReasons)
      .where(eq(skipReasons.code, code))
      .limit(1);
    if (!reason) throw new NotFoundException('unknown skip reason');

    const skipped = await this.db
      .update(runStops)
      .set({ status: 'skipped', skipReasonId: reason.id, updatedAt: new Date() })
      .where(and(eq(runStops.id, stopId), eq(runStops.runId, runId), eq(runStops.status, 'pending')))
      .returning({ id: runStops.id, meterId: runStops.meterId });

    // A skip removes a meter from the billing cycle, so it needs the same
    // accountability as the other run mutations. Audited only when the update
    // actually changed something: the guard above makes this idempotent, and a
    // replayed offline skip must not stack duplicate audit rows.
    if (skipped[0]) {
      await this.audit.write({
        actorId,
        action: 'run_stop.skipped',
        entity: 'run_stop',
        entityId: stopId,
        meta: { runId, meterId: skipped[0].meterId, skipReasonCode: code },
      });
      // A run can be finished by skipping its last stop, not only by reading it.
      await this.closeIfComplete(runId);
    }
    return this.detail(runId);
  }

  /**
   * Closes a run once nothing is pending. Left open, a finished run keeps
   * reporting as in-flight and starts showing as *aging* the next day, since
   * aging is `open AND runDate < today`.
   */
  private async closeIfComplete(runId: string): Promise<void> {
    await this.db
      .update(routeRuns)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(
        and(
          eq(routeRuns.id, runId),
          eq(routeRuns.status, 'open'),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(runStops)
              .where(and(eq(runStops.runId, runId), eq(runStops.status, 'pending'))),
          ),
        ),
      );
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

/** Identity fields only; callers layer on the resolved names and counts. */
function toSummary(
  run: typeof routeRuns.$inferSelect,
): Omit<RunSummary, 'routeName' | 'clientName' | 'readerName' | 'stopCount' | 'completedCount'> {
  return {
    id: run.id,
    clientId: run.clientId,
    routeId: run.routeId,
    // An unassigned run reports null, not '' — the contract is nullable and the
    // empty string would fail its uuid validation on the client.
    readerId: run.readerId,
    runDate: run.runDate,
    cycleId: run.cycleId,
    status: run.status,
  };
}
