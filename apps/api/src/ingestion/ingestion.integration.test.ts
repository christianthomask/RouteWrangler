import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDb, type Database } from '../db/client';
import { RunsService } from '../runs/runs.service';
import type { AuditService } from '../audit/audit.service';
import {
  clients,
  exceptions,
  meters,
  readEvents,
  routeRuns,
  routes,
  runStops,
  skipReasons,
  users,
} from '../db/schema';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { seedTaxonomy } from '../../seed/taxonomy';
import { IngestionService } from './ingestion.service';

/**
 * Idempotency AC (BUILD_SPEC §7.1): replaying a full synced batch creates zero
 * duplicates and returns per-event statuses. DB-backed — runs when DATABASE_URL
 * is set (CI + local Postgres), skipped otherwise so unit runs stay hermetic.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * These suites write real rows to whatever DATABASE_URL points at — locally,
 * the dev database. Left behind, the fixtures show up as phantom clients and
 * meters in the console. Each suite records what it created and removes it,
 * children first, so a developer's database looks the same after a test run as
 * before one.
 */
interface Fixtures {
  clientIds: string[];
  readerIds: string[];
}

function tracker(): Fixtures {
  return { clientIds: [], readerIds: [] };
}

async function cleanup(db: Database, f: Fixtures): Promise<void> {
  if (!f.clientIds.length && !f.readerIds.length) return;

  const runIds = f.clientIds.length
    ? (
        await db
          .select({ id: routeRuns.id })
          .from(routeRuns)
          .where(inArray(routeRuns.clientId, f.clientIds))
      ).map((r) => r.id)
    : [];
  const stopIds = runIds.length
    ? (await db.select({ id: runStops.id }).from(runStops).where(inArray(runStops.runId, runIds))).map(
        (r) => r.id,
      )
    : [];
  const meterIds = f.clientIds.length
    ? (await db.select({ id: meters.id }).from(meters).where(inArray(meters.clientId, f.clientIds))).map(
        (m) => m.id,
      )
    : [];

  /*
   * Strict child-to-parent order. Exceptions reference read_events, and
   * run_stops references a read event back — so every exception goes first, the
   * back-reference is nulled, and only then can the reads be removed.
   */
  if (f.clientIds.length) await db.delete(exceptions).where(inArray(exceptions.clientId, f.clientIds));
  if (stopIds.length) {
    await db.update(runStops).set({ completedReadEventId: null }).where(inArray(runStops.id, stopIds));
  }
  if (meterIds.length) await db.delete(readEvents).where(inArray(readEvents.meterId, meterIds));
  if (stopIds.length) await db.delete(runStops).where(inArray(runStops.id, stopIds));
  if (runIds.length) await db.delete(routeRuns).where(inArray(routeRuns.id, runIds));
  if (meterIds.length) await db.delete(meters).where(inArray(meters.id, meterIds));
  if (f.clientIds.length) {
    await db.delete(routes).where(inArray(routes.clientId, f.clientIds));
    await db.delete(clients).where(inArray(clients.id, f.clientIds));
  }
  if (f.readerIds.length) await db.delete(users).where(inArray(users.id, f.readerIds));
}

suite('ingestion idempotency (integration)', () => {
  const { db, sql } = createDb(url ?? '');
  const svc = new IngestionService(db, new TaxonomyService(db));

  const fixtures = tracker();
  /*
   * Exception types, severities and skip reasons are taxonomy-as-data (ADR-003),
   * so ingestion and skipping both resolve them from the database. CI migrates
   * but does not seed, so these suites seed the lookups themselves — idempotent,
   * and the reason they passed locally against an already-seeded dev database
   * while failing in CI.
   */
  beforeAll(async () => {
    await seedTaxonomy(db);
  });
  afterAll(async () => {
    await cleanup(db, fixtures);
    await sql.end();
  });

  it('a replayed batch creates zero duplicates and returns exactly-once', async () => {
    // Minimal fixtures with fresh ids (FKs: client ← meter, user ← reader).
    const clientId = randomUUID();
    const meterId = randomUUID();
    const readerId = randomUUID();
    fixtures.clientIds.push(clientId);
    fixtures.readerIds.push(readerId);
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

/**
 * The stop's read of record (UAT round 2 blocker). The field app invites two
 * things the ingestion path used to discard: correcting a mistyped value, and
 * reading a stop that was skipped earlier and later became reachable. Both
 * stored the read but left `completed_read_event_id` untouched, so the wrong
 * value billed in the first case and nothing billed in the second.
 */
suite('run stop read of record (integration)', () => {
  const { db, sql } = createDb(url ?? '');
  const svc = new IngestionService(db, new TaxonomyService(db));

  const fixtures = tracker();
  /*
   * Exception types, severities and skip reasons are taxonomy-as-data (ADR-003),
   * so ingestion and skipping both resolve them from the database. CI migrates
   * but does not seed, so these suites seed the lookups themselves — idempotent,
   * and the reason they passed locally against an already-seeded dev database
   * while failing in CI.
   */
  beforeAll(async () => {
    await seedTaxonomy(db);
  });
  afterAll(async () => {
    await cleanup(db, fixtures);
    await sql.end();
  });

  async function fixture() {
    const clientId = randomUUID();
    const routeId = randomUUID();
    const meterId = randomUUID();
    const readerId = randomUUID();
    const runId = randomUUID();
    const stopId = randomUUID();

    fixtures.clientIds.push(clientId);
    fixtures.readerIds.push(readerId);
    await db.insert(clients).values({ id: clientId, name: `T-${clientId.slice(0, 8)}`, state: 'CA' });
    await db.insert(routes).values({ id: routeId, clientId, name: 'R1' });
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
    await db.insert(routeRuns).values({
      id: runId,
      routeId,
      clientId,
      readerId,
      runDate: '2026-07-18',
      cycleId: '2026-07',
      status: 'open',
    });
    await db
      .insert(runStops)
      .values({ id: stopId, runId, meterId, sequence: 0, status: 'pending' });
    return { meterId, readerId, runId, stopId };
  }

  const read = (f: { meterId: string; readerId: string; stopId: string }, value: number, at: string) => ({
    id: randomUUID(),
    meterId: f.meterId,
    readerId: f.readerId,
    runStopId: f.stopId,
    value,
    capturedAt: at,
    sourceType: 'manual' as const,
    lat: 35.1,
    lng: -120.1,
  });

  it('a corrected read becomes the stop read of record', async () => {
    const f = await fixture();
    const actor = { id: f.readerId, role: 'reader' as const };

    await svc.ingest({ events: [read(f, 38000, '2026-07-18T10:00:00.000Z')] }, actor);
    const corrected = read(f, 3800, '2026-07-18T10:05:00.000Z');
    await svc.ingest({ events: [corrected] }, actor);

    const [stop] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(stop?.completedReadEventId).toBe(corrected.id);
  });

  it('an older read arriving late does not overwrite a newer one', async () => {
    // Store-and-forward drains out of order; capture time is business truth.
    const f = await fixture();
    const actor = { id: f.readerId, role: 'reader' as const };

    const newer = read(f, 1200, '2026-07-18T11:00:00.000Z');
    await svc.ingest({ events: [newer] }, actor);
    await svc.ingest({ events: [read(f, 1100, '2026-07-18T09:00:00.000Z')] }, actor);

    const [stop] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(stop?.completedReadEventId).toBe(newer.id);
  });

  it('reading a skipped stop completes it and clears the skip reason', async () => {
    const f = await fixture();
    const actor = { id: f.readerId, role: 'reader' as const };
    const [reason] = await db.select().from(skipReasons).limit(1);
    await db
      .update(runStops)
      .set({ status: 'skipped', skipReasonId: reason?.id ?? null })
      .where(eq(runStops.id, f.stopId));

    const later = read(f, 900, '2026-07-18T12:00:00.000Z');
    await svc.ingest({ events: [later] }, actor);

    const [stop] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(stop?.status).toBe('read');
    expect(stop?.completedReadEventId).toBe(later.id);
    expect(stop?.skipReasonId).toBeNull();
  });

  it('closes the run once nothing is pending', async () => {
    const f = await fixture();
    const actor = { id: f.readerId, role: 'reader' as const };

    await svc.ingest({ events: [read(f, 1000, '2026-07-18T10:00:00.000Z')] }, actor);

    const [run] = await db.select().from(routeRuns).where(eq(routeRuns.id, f.runId));
    // Left open, a finished run reports as aging the next morning.
    expect(run?.status).toBe('closed');
  });
});

/**
 * Skipping a stop (W5 + skip evidence). A skip takes a meter out of the billing
 * cycle on the reader's word alone, so it carries a reason AND a photograph of
 * that reason, and it raises `skipped_unresolved` for a supervisor to review.
 */
suite('skip evidence and review (integration)', () => {
  const { db, sql } = createDb(url ?? '');
  const audit = { write: async () => {} } as unknown as AuditService;
  const env = { APP_TIMEZONE: 'America/Los_Angeles' } as never;
  const svc = new RunsService(db, env, audit, new TaxonomyService(db));

  const fixtures = tracker();
  /*
   * Exception types, severities and skip reasons are taxonomy-as-data (ADR-003),
   * so ingestion and skipping both resolve them from the database. CI migrates
   * but does not seed, so these suites seed the lookups themselves — idempotent,
   * and the reason they passed locally against an already-seeded dev database
   * while failing in CI.
   */
  beforeAll(async () => {
    await seedTaxonomy(db);
  });
  afterAll(async () => {
    await cleanup(db, fixtures);
    await sql.end();
  });

  async function stop() {
    const clientId = randomUUID();
    const routeId = randomUUID();
    const meterId = randomUUID();
    const readerId = randomUUID();
    const runId = randomUUID();
    const stopId = randomUUID();
    fixtures.clientIds.push(clientId);
    fixtures.readerIds.push(readerId);
    await db.insert(clients).values({ id: clientId, name: `T-${clientId.slice(0, 8)}`, state: 'CA' });
    await db.insert(routes).values({ id: routeId, clientId, name: 'R1' });
    await db.insert(meters).values({
      id: meterId, clientId, serial: `T-${meterId.slice(0, 8)}`,
      serviceAddress: '1 Test St', registerDials: 5,
    });
    await db.insert(users).values({
      id: readerId, cognitoSub: `test:${readerId}`, displayName: 'Test Reader', role: 'reader',
    });
    await db.insert(routeRuns).values({
      id: runId, routeId, clientId, readerId,
      runDate: '2026-07-18', cycleId: '2026-07', status: 'open',
    });
    await db.insert(runStops).values({ id: stopId, runId, meterId, sequence: 0, status: 'pending' });
    return { runId, stopId, readerId, meterId };
  }

  it('refuses a skip with no photograph of the reason', async () => {
    const f = await stop();
    await expect(svc.skipStop(f.runId, f.stopId, 'no_access', f.readerId)).rejects.toThrow();
    const [row] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(row?.status).toBe('pending');
  });

  it('allows unsafe_conditions without one — do not ask a reader to linger', async () => {
    const f = await stop();
    await svc.skipStop(f.runId, f.stopId, 'unsafe_conditions', f.readerId);
    const [row] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(row?.status).toBe('skipped');
  });

  it('stores the photo and raises skipped_unresolved against the stop', async () => {
    const f = await stop();
    await svc.skipStop(f.runId, f.stopId, 'no_access', f.readerId, `photos/skip/${f.stopId}.jpg`);

    const [row] = await db.select().from(runStops).where(eq(runStops.id, f.stopId));
    expect(row?.skipPhotoKey).toBe(`photos/skip/${f.stopId}.jpg`);

    const raised = await db.select().from(exceptions).where(eq(exceptions.runStopId, f.stopId));
    expect(raised).toHaveLength(1);
    // The exception hangs off the stop, never a synthetic read — a placeholder
    // value would land in the meter's baseline and corrupt the next real read.
    expect(raised[0]?.readEventId).toBeNull();
  });

  it('does not stack duplicate exceptions when a skip replays', async () => {
    const f = await stop();
    await svc.skipStop(f.runId, f.stopId, 'no_access', f.readerId, 'photos/skip/x.jpg');
    await svc.skipStop(f.runId, f.stopId, 'no_access', f.readerId, 'photos/skip/x.jpg');
    const raised = await db.select().from(exceptions).where(eq(exceptions.runStopId, f.stopId));
    expect(raised).toHaveLength(1);
  });
});
