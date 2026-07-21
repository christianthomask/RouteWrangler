import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  ExportFormat,
  ExportListResponse,
  ExportPreview,
  ExportRunView,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import {
  clients,
  exceptionTypes,
  exceptions,
  exportRuns,
  meters,
  readEvents,
  routeRuns,
  runStops,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { classify, exportFilename, render, type StopRow } from './export.core';

/**
 * Billing export (BUILD_SPEC §7.4, W4). Gathers the cycle's reads, classifies
 * them (billable / held / missing) via the pure core, renders the client's file,
 * and persists an immutable snapshot. Re-running for the same client+cycle
 * supersedes the prior export rather than mutating it (ADR-023).
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async cyclesFor(clientId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ cycleId: routeRuns.cycleId })
      .from(routeRuns)
      .where(eq(routeRuns.clientId, clientId))
      .orderBy(desc(routeRuns.cycleId));
    return rows.map((r) => r.cycleId);
  }

  async preview(clientId: string, cycleId: string): Promise<ExportPreview> {
    const client = await this.requireClient(clientId);
    const rows = await this.stopRows(clientId, cycleId);
    const { counts, holds } = classify(rows);
    const [last] = await this.db
      .select({ id: exportRuns.id, ranAt: exportRuns.createdAt })
      .from(exportRuns)
      .where(
        and(
          eq(exportRuns.clientId, clientId),
          eq(exportRuns.cycleId, cycleId),
          isNull(exportRuns.supersededByRunId),
        ),
      )
      .orderBy(desc(exportRuns.createdAt))
      .limit(1);
    return {
      clientId,
      clientName: client.name,
      cycleId,
      totalStops: rows.length,
      counts,
      holds,
      lastExportId: last?.id ?? null,
      lastExportAt: last?.ranAt.toISOString() ?? null,
    };
  }

  async run(clientId: string, cycleId: string, actor: { id: string }): Promise<ExportRunView> {
    const client = await this.requireClient(clientId);
    const format = (this.formatOf(client.exportProfile) ?? 'csv') as ExportFormat;
    const rows = await this.stopRows(clientId, cycleId);
    const { billable, counts } = classify(rows);
    const body = render(format, billable);
    const filename = exportFilename(client.name, cycleId, format);

    // Pre-generate the new id so we can point any current export at it BEFORE
    // inserting. That keeps the partial unique index (one non-superseded export
    // per client+cycle) satisfied at every step, and — with the transaction and
    // row lock — serializes concurrent "Generate" clicks instead of leaving two
    // rows current (H4).
    const newId = randomUUID();
    const superseded = await this.db.transaction(async (tx) => {
      const prior = await tx
        .update(exportRuns)
        .set({ supersededByRunId: newId })
        .where(
          and(
            eq(exportRuns.clientId, clientId),
            eq(exportRuns.cycleId, cycleId),
            isNull(exportRuns.supersededByRunId),
          ),
        )
        .returning({ id: exportRuns.id });
      await tx
        .insert(exportRuns)
        .values({ id: newId, clientId, cycleId, ranBy: actor.id, counts, format, filename, body });
      return prior.map((p) => p.id);
    });

    await this.audit.write({
      actorId: actor.id,
      action: 'export.ran',
      entity: 'export_run',
      entityId: newId,
      meta: { clientId, cycleId, format, counts, superseded },
    });

    return this.viewById(newId);
  }

  async list(clientId?: string): Promise<ExportListResponse> {
    const rows = await this.db
      .select({
        id: exportRuns.id,
        clientId: exportRuns.clientId,
        clientName: clients.name,
        cycleId: exportRuns.cycleId,
        format: exportRuns.format,
        filename: exportRuns.filename,
        counts: exportRuns.counts,
        supersededByRunId: exportRuns.supersededByRunId,
        ranAt: exportRuns.createdAt,
        ranByName: users.displayName,
      })
      .from(exportRuns)
      .innerJoin(clients, eq(exportRuns.clientId, clients.id))
      .innerJoin(users, eq(exportRuns.ranBy, users.id))
      .where(clientId ? eq(exportRuns.clientId, clientId) : undefined)
      .orderBy(desc(exportRuns.createdAt));
    return { exports: rows.map((r) => toView(r)) };
  }

  /** The stored file body + name for download. */
  async file(id: string): Promise<{ filename: string; format: ExportFormat; body: string }> {
    const [row] = await this.db
      .select({ filename: exportRuns.filename, format: exportRuns.format, body: exportRuns.body })
      .from(exportRuns)
      .where(eq(exportRuns.id, id))
      .limit(1);
    if (!row || row.body == null) throw new NotFoundException('export not found');
    return {
      filename: row.filename ?? `${id}.csv`,
      format: row.format as ExportFormat,
      body: row.body,
    };
  }

  private async viewById(id: string): Promise<ExportRunView> {
    const [row] = await this.db
      .select({
        id: exportRuns.id,
        clientId: exportRuns.clientId,
        clientName: clients.name,
        cycleId: exportRuns.cycleId,
        format: exportRuns.format,
        filename: exportRuns.filename,
        counts: exportRuns.counts,
        supersededByRunId: exportRuns.supersededByRunId,
        ranAt: exportRuns.createdAt,
        ranByName: users.displayName,
      })
      .from(exportRuns)
      .innerJoin(clients, eq(exportRuns.clientId, clients.id))
      .innerJoin(users, eq(exportRuns.ranBy, users.id))
      .where(eq(exportRuns.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('export not found');
    return toView(row);
  }

  /**
   * The cycle's stops for the export core — one row per stop (NOT per exception).
   * A read routinely has multiple exception rows; a LEFT JOIN onto exceptions
   * would fan a stop into N rows and double-count in classify() (C1). We fetch
   * base stops once, then gather each read's exceptions separately and fold them
   * in. The certified-read swap is evaluated across all of the read's exceptions,
   * not just whichever join row happened to carry certifiedReadEventId.
   */
  private async stopRows(clientId: string, cycleId: string): Promise<StopRow[]> {
    const base = await this.db
      .select({
        meterId: meters.id,
        meterSerial: meters.serial,
        serviceAddress: meters.serviceAddress,
        completedReadId: runStops.completedReadEventId,
        readValue: readEvents.value,
        consumption: readEvents.consumption,
        readAt: readEvents.capturedAt,
      })
      .from(runStops)
      .innerJoin(routeRuns, eq(runStops.runId, routeRuns.id))
      .innerJoin(meters, eq(runStops.meterId, meters.id))
      .leftJoin(readEvents, eq(runStops.completedReadEventId, readEvents.id))
      .where(and(eq(routeRuns.clientId, clientId), eq(routeRuns.cycleId, cycleId)));

    const readIds = base.map((b) => b.completedReadId).filter((id): id is string => id != null);

    // All exceptions for those reads, grouped by read.
    const excRows = readIds.length
      ? await this.db
          .select({
            readEventId: exceptions.readEventId,
            code: exceptionTypes.code,
            status: exceptions.status,
            blocksBilling: exceptionTypes.blocksBilling,
            certifiedReadId: exceptions.certifiedReadEventId,
          })
          .from(exceptions)
          .innerJoin(exceptionTypes, eq(exceptions.typeId, exceptionTypes.id))
          .where(inArray(exceptions.readEventId, readIds))
      : [];
    const byRead = new Map<string, typeof excRows>();
    for (const e of excRows) {
      const arr = byRead.get(e.readEventId) ?? [];
      arr.push(e);
      byRead.set(e.readEventId, arr);
    }

    const certifiedIdFor = (readId: string | null): string | null => {
      if (!readId) return null;
      const cert = (byRead.get(readId) ?? [])
        .map((e) => e.certifiedReadId)
        .find((id): id is string => !!id && id !== readId);
      return cert ?? null;
    };

    const swapIds = [
      ...new Set(
        base.map((b) => certifiedIdFor(b.completedReadId)).filter((id): id is string => !!id),
      ),
    ];
    const certified = swapIds.length ? await this.readsById(swapIds) : new Map();

    return base.map((b) => {
      const exs = b.completedReadId ? (byRead.get(b.completedReadId) ?? []) : [];
      const certId = certifiedIdFor(b.completedReadId);
      const cert = certId ? certified.get(certId) : null;
      return {
        meterId: b.meterId,
        meterSerial: b.meterSerial,
        serviceAddress: b.serviceAddress,
        readValue: cert ? cert.value : b.readValue,
        consumption: cert ? cert.consumption : b.consumption,
        readAt: cert ? cert.readAt : b.readAt ? b.readAt.toISOString() : null,
        exceptions: exs.map((e) => ({
          code: e.code,
          status: e.status,
          blocksBilling: e.blocksBilling,
        })),
      };
    });
  }

  private async readsById(
    ids: string[],
  ): Promise<Map<string, { value: number; consumption: number | null; readAt: string }>> {
    const rows = await this.db
      .select({
        id: readEvents.id,
        value: readEvents.value,
        consumption: readEvents.consumption,
        capturedAt: readEvents.capturedAt,
      })
      .from(readEvents)
      .where(inArray(readEvents.id, ids));
    return new Map(
      rows.map((r) => [
        r.id,
        { value: r.value, consumption: r.consumption, readAt: r.capturedAt.toISOString() },
      ]),
    );
  }

  private async requireClient(clientId: string) {
    const [client] = await this.db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    if (!client) throw new NotFoundException('client not found');
    return client;
  }

  private formatOf(profile: unknown): string | null {
    if (profile && typeof profile === 'object' && 'format' in profile) {
      const f = (profile as { format?: unknown }).format;
      if (typeof f === 'string') return f;
    }
    return null;
  }
}

type Row = {
  id: string;
  clientId: string;
  clientName: string;
  cycleId: string;
  format: string;
  filename: string | null;
  counts: unknown;
  supersededByRunId: string | null;
  ranAt: Date;
  ranByName: string;
};

function toView(r: Row): ExportRunView {
  const counts = (r.counts ?? {}) as { billable?: number; held?: number; missing?: number };
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: r.clientName,
    cycleId: r.cycleId,
    format: (r.format as ExportFormat) ?? 'csv',
    filename: r.filename ?? `${r.id}.csv`,
    ranByName: r.ranByName,
    ranAt: r.ranAt.toISOString(),
    counts: {
      billable: counts.billable ?? 0,
      held: counts.held ?? 0,
      missing: counts.missing ?? 0,
    },
    superseded: r.supersededByRunId != null,
  };
}
