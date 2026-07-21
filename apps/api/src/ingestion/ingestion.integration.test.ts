import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client';
import { clients, meters, readEvents, users } from '../db/schema';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { IngestionService } from './ingestion.service';

/**
 * Idempotency AC (BUILD_SPEC §7.1): replaying a full synced batch creates zero
 * duplicates and returns per-event statuses. DB-backed — runs when DATABASE_URL
 * is set (CI + local Postgres), skipped otherwise so unit runs stay hermetic.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('ingestion idempotency (integration)', () => {
  const { db, sql } = createDb(url ?? '');
  const svc = new IngestionService(db, new TaxonomyService(db));

  afterAll(async () => {
    await sql.end();
  });

  it('a replayed batch creates zero duplicates and returns exactly-once', async () => {
    // Minimal fixtures with fresh ids (FKs: client ← meter, user ← reader).
    const clientId = randomUUID();
    const meterId = randomUUID();
    const readerId = randomUUID();
    await db
      .insert(clients)
      .values({ id: clientId, name: `T-${clientId.slice(0, 8)}`, state: 'CA' });
    await db.insert(meters).values({
      id: meterId,
      clientId,
      serial: `T-${meterId.slice(0, 8)}`,
      serviceAddress: '1 Test St',
      registerDials: 5,
    });
    await db.insert(users).values({
      id: readerId,
      cognitoSub: `test:${readerId}`,
      displayName: 'Test Reader',
      role: 'reader',
    });

    const event = {
      id: randomUUID(),
      meterId,
      readerId,
      value: 1234,
      capturedAt: '2026-07-18T10:00:00.000Z',
      sourceType: 'simulated' as const,
      lat: 35.1,
      lng: -120.1,
    };
    const batch = { events: [event] };
    const actor = { id: readerId, role: 'reader' as const };

    const first = await svc.ingest(batch, actor);
    expect(first.accepted).toBe(1);
    expect(first.results[0]!.status).toBe('accepted');

    // Replay the same batch three times.
    for (let i = 0; i < 3; i++) {
      const replay = await svc.ingest(batch, actor);
      expect(replay.duplicates).toBe(1);
      expect(replay.accepted).toBe(0);
      expect(replay.results[0]!.status).toBe('duplicate');
    }

    const rows = await db.select().from(readEvents).where(eq(readEvents.id, event.id));
    expect(rows).toHaveLength(1); // exactly once
  });
});
