import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import {
  DEFAULT_VALIDATION_CONFIG,
  type ExceptionCode,
  type ExceptionDetail,
  type ExceptionFilters,
  type ExceptionListItem,
  type ExceptionStatus,
  type ReadEventView,
  type ResolveRequest,
  type SeverityCode,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import {
  clients,
  exceptions,
  exceptionTypes,
  meters,
  readEvents,
  rereadTasks,
  routeRuns,
  runStops,
  severities,
} from '../db/schema';
import { STORAGE, type StoragePort } from '../storage/storage.port';
import { AuditService } from '../audit/audit.service';
import { MAX_REREADS, TERMINAL_STATUSES, allowedActions, isTerminal } from './lifecycle';

const PHOTO_URL_TTL = 900;

@Injectable()
export class ExceptionsService {
  private readonly config = DEFAULT_VALIDATION_CONFIG;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly audit: AuditService,
  ) {}

  async list(filters: ExceptionFilters): Promise<ExceptionListItem[]> {
    const conds = [];
    if (filters.type) conds.push(eq(exceptionTypes.code, filters.type));
    if (filters.severity) conds.push(eq(severities.code, filters.severity));
    if (filters.status) conds.push(eq(exceptions.status, filters.status));
    if (filters.clientId) conds.push(eq(exceptions.clientId, filters.clientId));
    if (filters.routeId) conds.push(eq(routeRuns.routeId, filters.routeId));

    const rows = await this.db
      .select({
        id: exceptions.id,
        typeCode: exceptionTypes.code,
        typeLabel: exceptionTypes.label,
        severityCode: severities.code,
        severityRank: severities.rank,
        status: exceptions.status,
        clientId: exceptions.clientId,
        clientName: clients.name,
        meterId: exceptions.meterId,
        meterSerial: meters.serial,
        serviceAddress: meters.serviceAddress,
        value: readEvents.value,
        consumption: readEvents.consumption,
        rereadCount: exceptions.rereadCount,
        createdAt: exceptions.createdAt,
      })
      .from(exceptions)
      .innerJoin(exceptionTypes, eq(exceptions.typeId, exceptionTypes.id))
      .innerJoin(severities, eq(exceptions.severityId, severities.id))
      .innerJoin(meters, eq(exceptions.meterId, meters.id))
      .innerJoin(clients, eq(exceptions.clientId, clients.id))
      .innerJoin(readEvents, eq(exceptions.readEventId, readEvents.id))
      .leftJoin(runStops, eq(readEvents.runStopId, runStops.id))
      .leftJoin(routeRuns, eq(runStops.runId, routeRuns.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(severities.rank), desc(exceptions.createdAt));

    return rows.map((r) => ({
      id: r.id,
      typeCode: r.typeCode as ExceptionCode,
      typeLabel: r.typeLabel,
      severityCode: r.severityCode as SeverityCode,
      status: r.status,
      clientId: r.clientId,
      clientName: r.clientName,
      meterId: r.meterId,
      meterSerial: r.meterSerial,
      serviceAddress: r.serviceAddress,
      value: r.value,
      consumption: r.consumption,
      rereadCount: r.rereadCount,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async detail(id: string): Promise<ExceptionDetail> {
    const [row] = await this.db
      .select({
        id: exceptions.id,
        typeCode: exceptionTypes.code,
        typeLabel: exceptionTypes.label,
        severityCode: severities.code,
        status: exceptions.status,
        rereadCount: exceptions.rereadCount,
        resolutionNote: exceptions.resolutionNote,
        certifiedReadEventId: exceptions.certifiedReadEventId,
        createdAt: exceptions.createdAt,
        clientId: clients.id,
        clientName: clients.name,
        meterId: meters.id,
        meterSerial: meters.serial,
        serviceAddress: meters.serviceAddress,
        meterLat: meters.lat,
        meterLng: meters.lng,
        registerDials: meters.registerDials,
        accessNotes: meters.accessNotes,
        flaggedReadId: exceptions.readEventId,
      })
      .from(exceptions)
      .innerJoin(exceptionTypes, eq(exceptions.typeId, exceptionTypes.id))
      .innerJoin(severities, eq(exceptions.severityId, severities.id))
      .innerJoin(meters, eq(exceptions.meterId, meters.id))
      .innerJoin(clients, eq(exceptions.clientId, clients.id))
      .where(eq(exceptions.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('exception not found');

    const [flaggedRow] = await this.db
      .select()
      .from(readEvents)
      .where(eq(readEvents.id, row.flaggedReadId))
      .limit(1);

    const rereadRows = await this.db
      .select()
      .from(readEvents)
      .where(eq(readEvents.exceptionId, id))
      .orderBy(asc(readEvents.receivedAt));

    const flaggedRead = await this.toReadView(flaggedRow!);
    const rereads = await Promise.all(rereadRows.map((r) => this.toReadView(r)));

    // Trailing consumption series for the chart.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (this.config.baselineMonths + 1));
    const series = await this.db
      .select({
        capturedAt: readEvents.capturedAt,
        value: readEvents.value,
        consumption: readEvents.consumption,
        id: readEvents.id,
      })
      .from(readEvents)
      .where(and(eq(readEvents.meterId, row.meterId), gte(readEvents.capturedAt, cutoff)))
      .orderBy(asc(readEvents.capturedAt));

    return {
      id: row.id,
      typeCode: row.typeCode as ExceptionCode,
      typeLabel: row.typeLabel,
      severityCode: row.severityCode as SeverityCode,
      status: row.status,
      rereadCount: row.rereadCount,
      resolutionNote: row.resolutionNote,
      certifiedReadEventId: row.certifiedReadEventId,
      createdAt: row.createdAt.toISOString(),
      client: { id: row.clientId, name: row.clientName },
      meter: {
        id: row.meterId,
        serial: row.meterSerial,
        serviceAddress: row.serviceAddress,
        lat: row.meterLat,
        lng: row.meterLng,
        registerDials: row.registerDials,
        accessNotes: row.accessNotes,
      },
      flaggedRead,
      rereads,
      consumptionSeries: series.map((s) => ({
        capturedAt: s.capturedAt.toISOString(),
        value: s.value,
        consumption: s.consumption,
        flagged: s.id === row.flaggedReadId,
      })),
      allowedActions: allowedActions(row.status, row.rereadCount),
    };
  }

  private async toReadView(r: typeof readEvents.$inferSelect): Promise<ReadEventView> {
    let photoUrl: string | null = null;
    if (r.photoKey && this.storage.configured) {
      try {
        photoUrl = await this.storage.presignDownload(r.photoKey, PHOTO_URL_TTL);
      } catch {
        photoUrl = null;
      }
    }
    return {
      id: r.id,
      value: r.value,
      consumption: r.consumption,
      capturedAt: r.capturedAt.toISOString(),
      receivedAt: r.receivedAt.toISOString(),
      sourceType: r.sourceType,
      lat: r.lat,
      lng: r.lng,
      billable: r.billable,
      annotations: (r.annotations ?? {}) as Record<string, unknown>,
      note: r.note ?? null,
      photoUrl,
    };
  }

  // ── action lifecycle (W4) ────────────────────────────────────────────────
  private async load(id: string) {
    const [row] = await this.db.select().from(exceptions).where(eq(exceptions.id, id)).limit(1);
    if (!row) throw new NotFoundException('exception not found');
    return row;
  }

  private ensureNotTerminal(status: ExceptionStatus) {
    if (isTerminal(status)) {
      throw new ConflictException(`exception is ${status} — no further actions`);
    }
  }

  async orderReread(id: string, note: string | undefined, actorId: string): Promise<ExceptionDetail> {
    const ex = await this.load(id);
    this.ensureNotTerminal(ex.status);
    if (ex.rereadCount >= MAX_REREADS) {
      throw new ConflictException('reread cap reached — override or escalate');
    }
    const readerId = (await this.flaggedReader(ex.readEventId)) ?? actorId;

    /*
     * The checks above are a fast path for the common case; they are not the
     * enforcement. Two supervisors ordering a reread at the same time would
     * both read rereadCount = 1, both pass the cap check, and both write 2 —
     * one increment lost, and the cap silently exceeded by issuing two tasks.
     *
     * So the real guard lives in the UPDATE's WHERE (still non-terminal, still
     * under the cap) and the count is incremented from the column rather than
     * from the value we read. The task insert shares the transaction, so a
     * losing racer rolls its task back instead of leaving an orphan pointing at
     * an exception that never moved.
     */
    const rereadCount = sql`${exceptions.rereadCount} + 1`;
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(exceptions)
        .set({
          status: 'reread_ordered',
          rereadCount,
          actionedBy: actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(exceptions.id, id),
            notInArray(exceptions.status, TERMINAL_STATUSES),
            lt(exceptions.rereadCount, MAX_REREADS),
          ),
        )
        .returning({ id: exceptions.id });

      if (updated.length === 0) {
        throw new ConflictException(
          'exception changed while the reread was being ordered — reload and retry',
        );
      }

      await tx.insert(rereadTasks).values({ exceptionId: id, readerId, status: 'issued' });
    });

    await this.audit.write({
      actorId,
      action: 'exception.reread_ordered',
      entity: 'exception',
      entityId: id,
      meta: { note: note ?? null, rereadCount: ex.rereadCount + 1 },
    });
    return this.detail(id);
  }

  async override(id: string, req: ResolveRequest, actorId: string): Promise<ExceptionDetail> {
    return this.close(id, 'overridden', req, actorId, 'exception.overridden');
  }

  async resolve(id: string, req: ResolveRequest, actorId: string): Promise<ExceptionDetail> {
    return this.close(id, 'resolved', req, actorId, 'exception.resolved');
  }

  async escalate(id: string, note: string, actorId: string): Promise<ExceptionDetail> {
    const ex = await this.load(id);
    this.ensureNotTerminal(ex.status);
    // Guard repeated in the WHERE: between the check above and this write, a
    // concurrent resolve/override could have made the exception terminal, and
    // an unguarded UPDATE would silently reopen a closed decision.
    const updated = await this.db
      .update(exceptions)
      .set({ status: 'escalated', resolutionNote: note, actionedBy: actorId, updatedAt: new Date() })
      .where(and(eq(exceptions.id, id), notInArray(exceptions.status, TERMINAL_STATUSES)))
      .returning({ id: exceptions.id });
    if (updated.length === 0) {
      throw new ConflictException('exception was closed by another action — reload and retry');
    }
    await this.audit.write({
      actorId,
      action: 'exception.escalated',
      entity: 'exception',
      entityId: id,
      meta: { note },
    });
    return this.detail(id);
  }

  private async close(
    id: string,
    status: 'resolved' | 'overridden',
    req: ResolveRequest,
    actorId: string,
    action: string,
  ): Promise<ExceptionDetail> {
    const ex = await this.load(id);
    this.ensureNotTerminal(ex.status);
    const certified = req.certifiedReadEventId ?? ex.readEventId;
    await this.assertReadBelongs(certified, ex);
    // Same guard as escalate: this decides what gets billed, so two supervisors
    // closing the same exception concurrently must not both win — the second
    // gets a conflict rather than silently overwriting the first's certified
    // read and resolution note.
    const updated = await this.db
      .update(exceptions)
      .set({
        status,
        resolutionNote: req.note,
        certifiedReadEventId: certified,
        actionedBy: actorId,
        updatedAt: new Date(),
      })
      .where(and(eq(exceptions.id, id), notInArray(exceptions.status, TERMINAL_STATUSES)))
      .returning({ id: exceptions.id });
    if (updated.length === 0) {
      throw new ConflictException('exception was closed by another action — reload and retry');
    }
    await this.audit.write({
      actorId,
      action,
      entity: 'exception',
      entityId: id,
      meta: { note: req.note, certifiedReadEventId: certified },
    });
    return this.detail(id);
  }

  private async flaggedReader(readEventId: string): Promise<string | null> {
    const [r] = await this.db
      .select({ readerId: readEvents.readerId })
      .from(readEvents)
      .where(eq(readEvents.id, readEventId))
      .limit(1);
    return r?.readerId ?? null;
  }

  /**
   * A certified read is swapped into the billing export in place of the flagged
   * one (ADR-002), so it has to be a read that legitimately answers *this*
   * exception. Matching on meter alone is not enough: every prior month's read
   * is on the same meter, so a mis-selected id could pull last cycle's value
   * into this cycle's invoice.
   *
   * Accepted: the flagged read itself, a reread issued against this exception,
   * or another read from the same billing cycle. Rejected: a different meter,
   * or a read from another cycle. The cycle check only fires when both cycles
   * are known — a read with no run stop (e.g. an ad-hoc capture) isn't rejected
   * for lacking one.
   */
  private async assertReadBelongs(
    readEventId: string,
    ex: { id: string; meterId: string; readEventId: string },
  ): Promise<void> {
    const [r] = await this.db
      .select({
        meterId: readEvents.meterId,
        exceptionId: readEvents.exceptionId,
        cycleId: routeRuns.cycleId,
      })
      .from(readEvents)
      .leftJoin(runStops, eq(readEvents.runStopId, runStops.id))
      .leftJoin(routeRuns, eq(runStops.runId, routeRuns.id))
      .where(eq(readEvents.id, readEventId))
      .limit(1);

    if (!r || r.meterId !== ex.meterId) {
      throw new ConflictException('certified read does not belong to this meter');
    }
    // The flagged read, or a reread ordered for this exception, always qualify.
    if (readEventId === ex.readEventId || r.exceptionId === ex.id) return;

    const flaggedCycle = await this.cycleOfRead(ex.readEventId);
    if (flaggedCycle && r.cycleId && r.cycleId !== flaggedCycle) {
      throw new ConflictException('certified read is from a different billing cycle');
    }
  }

  /** The billing cycle a read was captured in, if it is tied to a run stop. */
  private async cycleOfRead(readEventId: string): Promise<string | null> {
    const [r] = await this.db
      .select({ cycleId: routeRuns.cycleId })
      .from(readEvents)
      .innerJoin(runStops, eq(readEvents.runStopId, runStops.id))
      .innerJoin(routeRuns, eq(runStops.runId, routeRuns.id))
      .where(eq(readEvents.id, readEventId))
      .limit(1);
    return r?.cycleId ?? null;
  }
}
