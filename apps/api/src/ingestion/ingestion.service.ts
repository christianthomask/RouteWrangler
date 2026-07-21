import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import {
  DEFAULT_VALIDATION_CONFIG,
  registerMax,
  type IngestEventResult,
  type IngestRequest,
  type IngestResponse,
  type ReadEventInput,
  type Role,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { exceptions, meters, readEvents, rereadTasks, routeRuns, runStops } from '../db/schema';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { runValidation } from '../validation/engine';
import type { PriorRead } from '../validation/types';
import { MAX_REREADS, TERMINAL_STATUSES } from '../exceptions/lifecycle';

/** The authenticated caller — the reader identity is derived from this, never
 *  from the request body (H2). */
export interface IngestActor {
  id: string;
  role: Role;
}

/**
 * Ingestion pipeline (BUILD_SPEC §7.1, W2/W3). Idempotent on the client-generated
 * event id (ADR-008): replaying a synced batch creates zero duplicates and
 * returns a per-event status. Events are processed in arrival order (capture
 * order) so store-and-forward reconciliation is deterministic. Reads are
 * immutable (ADR-002): every read is an insert; corrections are new events.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly config = DEFAULT_VALIDATION_CONFIG;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly taxonomy: TaxonomyService,
  ) {}

  async ingest(req: IngestRequest, actor: IngestActor): Promise<IngestResponse> {
    const results: IngestEventResult[] = [];
    for (const ev of req.events) {
      results.push(await this.ingestOne(ev, actor));
    }
    return {
      results,
      accepted: results.filter((r) => r.status === 'accepted').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
    };
  }

  private async ingestOne(ev: ReadEventInput, actor: IngestActor): Promise<IngestEventResult> {
    // Fast idempotency check — a replayed event short-circuits here.
    const [existing] = await this.db
      .select({ id: readEvents.id })
      .from(readEvents)
      .where(eq(readEvents.id, ev.id))
      .limit(1);
    if (existing) return { id: ev.id, status: 'duplicate' };

    const [meter] = await this.db.select().from(meters).where(eq(meters.id, ev.meterId)).limit(1);
    if (!meter) return { id: ev.id, status: 'rejected', message: 'unknown meter' };

    // A reading beyond the meter's physical register capacity is impossible and
    // would poison the baseline — reject it (M1; the contract already rejects
    // Infinity/NaN, this bounds the finite range per meter).
    if (ev.value > registerMax(meter.registerDials)) {
      return { id: ev.id, status: 'rejected', message: 'value exceeds register capacity' };
    }

    // Duplicate-stop coverage: a read landing on an already-completed stop still
    // persists; disagreeing values open a duplicate_mismatch (BUILD_SPEC §7.1).
    let duplicate: { completedValue: number } | null = null;
    let stopStatus: string | null = null;
    if (ev.runStopId) {
      const [stop] = await this.db
        .select({
          status: runStops.status,
          completedReadEventId: runStops.completedReadEventId,
          runReaderId: routeRuns.readerId,
        })
        .from(runStops)
        .innerJoin(routeRuns, eq(runStops.runId, routeRuns.id))
        .where(eq(runStops.id, ev.runStopId))
        .limit(1);
      if (!stop) return { id: ev.id, status: 'rejected', message: 'unknown run stop' };
      // Ownership (H2): a reader may only post to stops on their own assigned
      // run. Supervisors/admins may post on anyone's behalf (tools, backfill).
      if (actor.role === 'reader' && stop.runReaderId !== actor.id) {
        return { id: ev.id, status: 'rejected', message: 'run stop not assigned to you' };
      }
      stopStatus = stop.status;
      if (stop.status === 'read' && stop.completedReadEventId) {
        const [completed] = await this.db
          .select({ value: readEvents.value })
          .from(readEvents)
          .where(eq(readEvents.id, stop.completedReadEventId))
          .limit(1);
        if (completed) duplicate = { completedValue: completed.value };
      }
    }

    const history = await this.loadHistory(ev.meterId, new Date(ev.capturedAt));

    const result = runValidation({
      value: ev.value,
      lat: ev.lat ?? null,
      lng: ev.lng ?? null,
      registerDials: meter.registerDials,
      history,
      config: this.config,
      duplicate,
    });

    // All writes for one event are atomic (C2). If any step throws, nothing
    // commits — so a replay finds either a complete event or none at all, and
    // can repair it, instead of a half-written read that short-circuits forever.
    return this.db.transaction(async (tx) => {
      // Insert the immutable read with the AUTHENTICATED reader (H2) — the body's
      // readerId is never trusted. onConflictDoNothing closes the race where the
      // same id arrives concurrently after our fast check.
      const inserted = await tx
        .insert(readEvents)
        .values({
          id: ev.id,
          meterId: ev.meterId,
          runStopId: ev.runStopId ?? null,
          readerId: actor.id,
          value: ev.value,
          capturedAt: new Date(ev.capturedAt),
          sourceType: ev.sourceType,
          lat: ev.lat ?? null,
          lng: ev.lng ?? null,
          photoKey: ev.photoKey ?? null,
          note: ev.note?.trim() ? ev.note.trim() : null,
          annotations: result.annotations,
          consumption: result.effectiveConsumption,
          billable: result.billable,
          exceptionId: ev.exceptionId ?? null,
        })
        .onConflictDoNothing({ target: readEvents.id })
        .returning({ id: readEvents.id });

      if (inserted.length === 0) return { id: ev.id, status: 'duplicate' };

      // Open typed exceptions for each finding.
      for (const code of result.exceptions) {
        const resolved = await this.taxonomy.resolve(code);
        await tx.insert(exceptions).values({
          readEventId: ev.id,
          meterId: ev.meterId,
          clientId: meter.clientId,
          typeId: resolved.typeId,
          severityId: resolved.severityId,
          status: 'open',
        });
      }

      // First read completes a pending stop; a completed stop is left as-is.
      if (ev.runStopId && stopStatus === 'pending') {
        await tx
          .update(runStops)
          .set({ status: 'read', completedReadEventId: ev.id, updatedAt: new Date() })
          .where(and(eq(runStops.id, ev.runStopId), eq(runStops.status, 'pending')));
      }

      // A reread answering an exception advances it to reread_received (W4).
      // Guarded (H3): same meter only, never resurrect a terminal exception, and
      // honour the reread cap — the count is bumped atomically. A late/duplicate
      // reread that fails the guard is simply ignored (the read still persists).
      if (ev.exceptionId) {
        const advanced = await tx
          .update(exceptions)
          .set({
            status: 'reread_received',
            rereadCount: sql`${exceptions.rereadCount} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(exceptions.id, ev.exceptionId),
              eq(exceptions.meterId, ev.meterId),
              notInArray(exceptions.status, TERMINAL_STATUSES),
              lt(exceptions.rereadCount, MAX_REREADS),
            ),
          )
          .returning({ id: exceptions.id });
        if (advanced.length) {
          await tx
            .update(rereadTasks)
            .set({ status: 'done', updatedAt: new Date() })
            .where(
              and(eq(rereadTasks.exceptionId, ev.exceptionId), eq(rereadTasks.readerId, actor.id)),
            );
        }
      }

      if (result.exceptions.length > 0) {
        this.logger.log(
          `read ${ev.id} on meter ${meter.serial}: ${result.exceptions.join(', ')} (billable=${result.billable})`,
        );
      }

      return {
        id: ev.id,
        status: 'accepted',
        billable: result.billable,
        exceptions: result.exceptions,
        annotations: result.annotations,
      };
    });
  }

  /**
   * The meter's prior reads for the baseline, ordered by capture time and bounded
   * to reads captured BEFORE this one (H1). Ordering by received_at let an
   * out-of-order store-and-forward sync compare a read against a later capture
   * and fabricate a false negative_consumption; capture time is business truth.
   */
  private async loadHistory(meterId: string, capturedAt: Date): Promise<PriorRead[]> {
    const cutoff = new Date(capturedAt);
    cutoff.setMonth(cutoff.getMonth() - this.config.baselineMonths);
    const rows = await this.db
      .select({ value: readEvents.value, consumption: readEvents.consumption })
      .from(readEvents)
      .where(
        and(
          eq(readEvents.meterId, meterId),
          gte(readEvents.capturedAt, cutoff),
          lt(readEvents.capturedAt, capturedAt),
        ),
      )
      .orderBy(asc(readEvents.capturedAt));
    return rows.map((r) => ({ value: r.value, consumption: r.consumption }));
  }
}
