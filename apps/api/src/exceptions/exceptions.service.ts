import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
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
import { MAX_REREADS, allowedActions, isTerminal } from './lifecycle';

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
    await this.db.insert(rereadTasks).values({
      exceptionId: id,
      readerId: (await this.flaggedReader(ex.readEventId)) ?? actorId,
      status: 'issued',
    });
    await this.db
      .update(exceptions)
      .set({
        status: 'reread_ordered',
        rereadCount: ex.rereadCount + 1,
        actionedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(exceptions.id, id));
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
    await this.db
      .update(exceptions)
      .set({ status: 'escalated', resolutionNote: note, actionedBy: actorId, updatedAt: new Date() })
      .where(eq(exceptions.id, id));
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
    await this.assertReadBelongs(certified, ex.meterId);
    await this.db
      .update(exceptions)
      .set({
        status,
        resolutionNote: req.note,
        certifiedReadEventId: certified,
        actionedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(exceptions.id, id));
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

  private async assertReadBelongs(readEventId: string, meterId: string): Promise<void> {
    const [r] = await this.db
      .select({ meterId: readEvents.meterId })
      .from(readEvents)
      .where(eq(readEvents.id, readEventId))
      .limit(1);
    if (!r || r.meterId !== meterId) {
      throw new ConflictException('certified read does not belong to this meter');
    }
  }
}
