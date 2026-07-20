import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte } from 'drizzle-orm';
import {
  DEFAULT_VALIDATION_CONFIG,
  type IngestEventResult,
  type IngestRequest,
  type IngestResponse,
  type ReadEventInput,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { exceptions, meters, readEvents, rereadTasks, runStops } from '../db/schema';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { runValidation } from '../validation/engine';
import type { PriorRead } from '../validation/types';

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

  async ingest(req: IngestRequest): Promise<IngestResponse> {
    const results: IngestEventResult[] = [];
    for (const ev of req.events) {
      results.push(await this.ingestOne(ev));
    }
    return {
      results,
      accepted: results.filter((r) => r.status === 'accepted').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      rejected: results.filter((r) => r.status === 'rejected').length,
    };
  }

  private async ingestOne(ev: ReadEventInput): Promise<IngestEventResult> {
    // Fast idempotency check — a replayed event short-circuits here.
    const [existing] = await this.db
      .select({ id: readEvents.id })
      .from(readEvents)
      .where(eq(readEvents.id, ev.id))
      .limit(1);
    if (existing) return { id: ev.id, status: 'duplicate' };

    const [meter] = await this.db.select().from(meters).where(eq(meters.id, ev.meterId)).limit(1);
    if (!meter) return { id: ev.id, status: 'rejected', message: 'unknown meter' };

    // Duplicate-stop coverage: a read landing on an already-completed stop still
    // persists; disagreeing values open a duplicate_mismatch (BUILD_SPEC §7.1).
    let duplicate: { completedValue: number } | null = null;
    let stopStatus: string | null = null;
    if (ev.runStopId) {
      const [stop] = await this.db
        .select()
        .from(runStops)
        .where(eq(runStops.id, ev.runStopId))
        .limit(1);
      if (!stop) return { id: ev.id, status: 'rejected', message: 'unknown run stop' };
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

    const history = await this.loadHistory(ev.meterId);

    const result = runValidation({
      value: ev.value,
      lat: ev.lat ?? null,
      lng: ev.lng ?? null,
      registerDials: meter.registerDials,
      history,
      config: this.config,
      duplicate,
    });

    // Insert the immutable read. onConflictDoNothing closes the race where the
    // same id arrives concurrently after our fast check.
    const inserted = await this.db
      .insert(readEvents)
      .values({
        id: ev.id,
        meterId: ev.meterId,
        runStopId: ev.runStopId ?? null,
        readerId: ev.readerId,
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
      await this.db.insert(exceptions).values({
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
      await this.db
        .update(runStops)
        .set({ status: 'read', completedReadEventId: ev.id, updatedAt: new Date() })
        .where(and(eq(runStops.id, ev.runStopId), eq(runStops.status, 'pending')));
    }

    // A reread answering an exception advances it to reread_received (W4) and
    // marks the reader's reread task done. The supervisor then compares
    // side-by-side and resolves.
    if (ev.exceptionId) {
      await this.db
        .update(exceptions)
        .set({ status: 'reread_received', updatedAt: new Date() })
        .where(eq(exceptions.id, ev.exceptionId));
      await this.db
        .update(rereadTasks)
        .set({ status: 'done', updatedAt: new Date() })
        .where(and(eq(rereadTasks.exceptionId, ev.exceptionId), eq(rereadTasks.readerId, ev.readerId)));
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
  }

  /** The meter's prior reads within the baseline window, oldest-first. */
  private async loadHistory(meterId: string): Promise<PriorRead[]> {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - this.config.baselineMonths);
    const rows = await this.db
      .select({ value: readEvents.value, consumption: readEvents.consumption })
      .from(readEvents)
      .where(and(eq(readEvents.meterId, meterId), gte(readEvents.receivedAt, cutoff)))
      .orderBy(asc(readEvents.receivedAt));
    return rows.map((r) => ({ value: r.value, consumption: r.consumption }));
  }
}
