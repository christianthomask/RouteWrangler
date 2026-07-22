import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lt, ne, notInArray, sql } from 'drizzle-orm';
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
import { runValidation } from '@routewrangler/contracts';
import type { PriorRead } from '@routewrangler/contracts';
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
      // One bad event must not sink the batch. Earlier events have already
      // committed, so throwing here would hand the client a 500 despite partial
      // success — and an offline-first queue would then re-send reads that
      // already landed. Idempotency makes that harmless but not free, and it
      // hides the real per-event outcome of the rest of the batch. An unexpected
      // throw is therefore recorded as this event's failure and the loop
      // continues; the client retries exactly the events that actually failed.
      try {
        results.push(await this.ingestOne(ev, actor));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`ingest of event ${ev.id} failed: ${message}`, (err as Error)?.stack);
        // `failed`, not `rejected`: the event itself may be perfectly valid and
        // the failure ours. `rejected` is terminal and would have the field
        // queue discard a capture that never landed. One bad event must not
        // fail the batch either — the rest of the results are still truthful.
        results.push({ id: ev.id, status: 'failed', message: `internal error: ${message}` });
      }
    }
    return {
      results,
      accepted: results.filter((r) => r.status === 'accepted').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
      failed: results.filter((r) => r.status === 'failed').length,
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
    // The stop's current read of record, if any — decides below whether this
    // reading supersedes it.
    let incumbent: { id: string; capturedAt: Date } | null = null;
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
      if (stop.completedReadEventId) {
        const [completed] = await this.db
          .select({ value: readEvents.value, capturedAt: readEvents.capturedAt })
          .from(readEvents)
          .where(eq(readEvents.id, stop.completedReadEventId))
          .limit(1);
        if (completed) {
          incumbent = { id: stop.completedReadEventId, capturedAt: completed.capturedAt };
          if (stop.status === 'read') duplicate = { completedValue: completed.value };
        }
      }
    }

    const history = await this.loadHistory(ev.meterId, new Date(ev.capturedAt), ev.runStopId);

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

      /*
       * The stop's read of record is the latest reading taken at it.
       *
       * This used to fire only for a `pending` stop, which orphaned two
       * legitimate cases the field app actively invites: correcting a
       * fat-fingered value (the corrected read was stored but never became the
       * stop's read, so the wrong number billed), and reading a stop that was
       * skipped earlier and later became accessible (a valid reading that would
       * never bill at all). Idempotency is keyed on the client-generated event
       * id (ADR-008) and duplicates are rejected above, so anything reaching
       * here is a genuinely new reading.
       *
       * Compared on capture time, not arrival: a store-and-forward drain
       * replays out of order, and an older reading must not overwrite a newer
       * one. The WHERE re-asserts the incumbent we read, so two concurrent
       * captures cannot both win.
       */
      const supersedes = !incumbent || new Date(ev.capturedAt) >= incumbent.capturedAt;
      if (ev.runStopId && supersedes) {
        await tx
          .update(runStops)
          .set({
            status: 'read',
            completedReadEventId: ev.id,
            // Regaining access supersedes the skip; the reason no longer applies.
            skipReasonId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runStops.id, ev.runStopId),
              incumbent
                ? eq(runStops.completedReadEventId, incumbent.id)
                : isNull(runStops.completedReadEventId),
            ),
          );
      }

      /*
       * A run with nothing left pending is finished, so close it here rather
       * than waiting for someone to notice. Left open, a fully-worked run keeps
       * showing as in-flight and — because aging is `open AND runDate < today` —
       * every completed run would start reporting itself as overdue the next
       * morning, re-populating the very metric the timezone fix corrected.
       *
       * Guarded on there being no pending stop left, evaluated inside the same
       * transaction as the stop update above, so a concurrent read on the last
       * two stops cannot both see one remaining.
       */
      if (ev.runStopId) {
        await tx
          .update(routeRuns)
          .set({ status: 'closed', updatedAt: new Date() })
          .where(
            and(
              eq(routeRuns.status, 'open'),
              eq(
                routeRuns.id,
                sql`(SELECT run_id FROM run_stops WHERE id = ${ev.runStopId})`,
              ),
              sql`NOT EXISTS (
                SELECT 1 FROM run_stops rs
                WHERE rs.run_id = ${routeRuns.id} AND rs.status = 'pending'
              )`,
            ),
          );
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
  private async loadHistory(
    meterId: string,
    capturedAt: Date,
    excludeRunStopId?: string | null,
  ): Promise<PriorRead[]> {
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
          /*
           * Earlier reads of the SAME stop are excluded from the baseline.
           * A correction or a re-capture is another reading of one visit, not a
           * month's consumption: measured against its own predecessor it
           * differences to ~0, which made a re-read of a flagged meter look
           * clean and billable, and made a corrected value nonsense. The true
           * comparison is the previous cycle's read.
           */
          excludeRunStopId ? ne(readEvents.runStopId, excludeRunStopId) : undefined,
        ),
      )
      .orderBy(asc(readEvents.capturedAt));
    return rows.map((r) => ({ value: r.value, consumption: r.consumption }));
  }
}
