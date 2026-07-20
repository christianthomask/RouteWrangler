import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { FieldMeterReadsResponse } from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { meters, readEvents, users } from '../db/schema';

/** How many prior reads the field screen shows — enough context, not a full audit. */
const RECENT_LIMIT = 8;

/**
 * Meter context for the field stop screen (BUILD_SPEC §7.2): the standing access
 * notes plus the most recent reads and the note captured with each. Read-only and
 * reader-accessible — distinct from the supervisor's full meter history (§7.3).
 */
@Injectable()
export class MeterReadsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forMeter(meterId: string): Promise<FieldMeterReadsResponse> {
    const [meter] = await this.db
      .select({ accessNotes: meters.accessNotes })
      .from(meters)
      .where(eq(meters.id, meterId))
      .limit(1);
    if (!meter) throw new NotFoundException('meter not found');

    const rows = await this.db
      .select({
        id: readEvents.id,
        value: readEvents.value,
        consumption: readEvents.consumption,
        capturedAt: readEvents.capturedAt,
        sourceType: readEvents.sourceType,
        note: readEvents.note,
        readerName: users.displayName,
      })
      .from(readEvents)
      .innerJoin(users, eq(readEvents.readerId, users.id))
      .where(eq(readEvents.meterId, meterId))
      .orderBy(desc(readEvents.capturedAt))
      .limit(RECENT_LIMIT);

    return {
      accessNotes: meter.accessNotes ?? null,
      reads: rows.map((r) => ({
        id: r.id,
        value: r.value,
        consumption: r.consumption,
        capturedAt: r.capturedAt.toISOString(),
        sourceType: r.sourceType,
        readerName: r.readerName,
        note: r.note ?? null,
      })),
    };
  }
}
