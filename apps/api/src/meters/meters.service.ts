import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import {
  DEFAULT_VALIDATION_CONFIG,
  type ExceptionCode,
  type MeterHistoryResponse,
  type SeverityCode,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { toReadEventView } from '../read-events/read-view';
import {
  clients,
  exceptions,
  exceptionTypes,
  meters,
  readEvents,
  severities,
} from '../db/schema';
import { STORAGE, type StoragePort } from '../storage/storage.port';


/** Meter history view (BUILD_SPEC §7.3): chart, all events, prior exceptions. */
@Injectable()
export class MetersService {
  private readonly config = DEFAULT_VALIDATION_CONFIG;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async history(meterId: string): Promise<MeterHistoryResponse> {
    const [m] = await this.db
      .select({
        id: meters.id,
        serial: meters.serial,
        serviceAddress: meters.serviceAddress,
        clientName: clients.name,
        registerDials: meters.registerDials,
        accessNotes: meters.accessNotes,
      })
      .from(meters)
      .innerJoin(clients, eq(meters.clientId, clients.id))
      .where(eq(meters.id, meterId))
      .limit(1);
    if (!m) throw new NotFoundException('meter not found');

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - (this.config.baselineMonths + 1));

    const eventRows = await this.db
      .select()
      .from(readEvents)
      .where(eq(readEvents.meterId, meterId))
      .orderBy(desc(readEvents.receivedAt));

    const seriesRows = await this.db
      .select({ capturedAt: readEvents.capturedAt, value: readEvents.value, consumption: readEvents.consumption })
      .from(readEvents)
      .where(and(eq(readEvents.meterId, meterId), gte(readEvents.capturedAt, cutoff)))
      .orderBy(asc(readEvents.capturedAt));

    const exRows = await this.db
      .select({
        id: exceptions.id,
        typeCode: exceptionTypes.code,
        severityCode: severities.code,
        status: exceptions.status,
        createdAt: exceptions.createdAt,
      })
      .from(exceptions)
      .innerJoin(exceptionTypes, eq(exceptions.typeId, exceptionTypes.id))
      .innerJoin(severities, eq(exceptions.severityId, severities.id))
      .where(eq(exceptions.meterId, meterId))
      .orderBy(desc(exceptions.createdAt));

    const events = await Promise.all(eventRows.map((r) => toReadEventView(this.db, this.storage, r)));

    return {
      meter: m,
      consumptionSeries: seriesRows.map((s) => ({
        capturedAt: s.capturedAt.toISOString(),
        value: s.value,
        consumption: s.consumption,
        flagged: false,
      })),
      events,
      exceptions: exRows.map((e) => ({
        id: e.id,
        typeCode: e.typeCode as ExceptionCode,
        severityCode: e.severityCode as SeverityCode,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  // NOTE: duplicated from ExceptionsService.toReadView — the two drifted once
  // already. Worth extracting to a shared mapper.
}
