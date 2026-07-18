import { registerMax } from '@routewrangler/contracts';
import {
  DEMO_ANOMALY_PLAN,
  generateHistory,
  type AnomalyKind,
  type GeneratedRead,
} from '@routewrangler/simulator';
import type { Database } from '../src/db/client';
import { clients, meters, readEvents, routeRuns, routes, routeStops, runStops } from '../src/db/schema';
import { clientId, hashSeed, meterId, readId, routeId, routeStopId, runId, runStopId } from './ids';

const CLIENTS = [
  { name: 'San Luis Obispo', state: 'CA', code: 'SLO', lat: 35.2828, lng: -120.6596 },
  { name: 'Morro Bay', state: 'CA', code: 'MB', lat: 35.3658, lng: -120.8499 },
  { name: 'Bend', state: 'OR', code: 'BND', lat: 44.0582, lng: -121.3153 }, // out-of-state
];
const ROUTES_PER_CLIENT = 2;
const METERS_PER_ROUTE = 10;
const HISTORY_MONTHS = 12;
const NOMINAL_USAGE = 100; // matches simulator DEMO_NOMINAL_USAGE

const routeName = (i: number) => `Route ${i + 1}`;

/** The demo route is client 0, route 0 — its stops line up with DEMO_ANOMALY_PLAN. */
function demoKind(clientIdx: number, routeIdx: number, meterIdx: number): AnomalyKind {
  if (clientIdx === 0 && routeIdx === 0) return DEMO_ANOMALY_PLAN[meterIdx] ?? 'clean';
  return 'clean';
}

/** Prepares a meter's history to satisfy an anomaly kind's preconditions. */
function shapeHistory(kind: AnomalyKind, dials: number, hist: GeneratedRead[]): GeneratedRead[] {
  if (hist.length < 3) return hist;
  const out = hist.map((h) => ({ ...h }));
  if (kind === 'rollover_in_band' || kind === 'rollover_oob') {
    out[out.length - 1]!.value = registerMax(dials) - 50; // park near the top
  } else if (kind === 'zero') {
    const v = out[out.length - 3]!.value;
    out[out.length - 2] = { ...out[out.length - 2]!, value: v, consumption: 0 };
    out[out.length - 1] = { ...out[out.length - 1]!, value: v, consumption: 0 };
  }
  return out;
}

export interface WorldResult {
  demoRunId: string;
  meterCount: number;
  readCount: number;
}

/**
 * Builds the deterministic world (BUILD_SPEC §5, §7.6): clients, meters, routes,
 * route_stops, 12 months of seasonal history, and today's open demo run whose
 * stops are pre-shaped so playback trips every validation rule. Idempotent.
 */
export async function seedWorld(db: Database, readerId: string, endDate: Date): Promise<WorldResult> {
  const readRows: (typeof readEvents.$inferInsert)[] = [];
  let meterCount = 0;
  let demoRunId = '';

  for (let ci = 0; ci < CLIENTS.length; ci++) {
    const c = CLIENTS[ci]!;
    const cId = clientId(c.name);
    await db
      .insert(clients)
      .values({ id: cId, name: c.name, state: c.state })
      .onConflictDoNothing({ target: clients.id });

    for (let ri = 0; ri < ROUTES_PER_CLIENT; ri++) {
      const rId = routeId(c.name, routeName(ri));
      await db
        .insert(routes)
        .values({ id: rId, clientId: cId, name: routeName(ri) })
        .onConflictDoNothing({ target: routes.id });

      for (let mi = 0; mi < METERS_PER_ROUTE; mi++) {
        const serial = `${c.code}-${ri + 1}-${String(mi + 1).padStart(3, '0')}`;
        const kind = demoKind(ci, ri, mi);
        const dials = kind === 'rollover_in_band' || kind === 'rollover_oob' ? 4 : 5;
        const mId = meterId(serial);
        const lat = c.lat + ((hashSeed(serial) % 1000) - 500) / 100000;
        const lng = c.lng + ((hashSeed(`${serial}:lng`) % 1000) - 500) / 100000;

        await db
          .insert(meters)
          .values({
            id: mId,
            clientId: cId,
            serial,
            serviceAddress: `${100 + mi} Example St, ${c.name}`,
            lat,
            lng,
            registerDials: dials,
            accessNotes: mi === 0 ? 'Beware of dog' : null,
          })
          .onConflictDoNothing({ target: meters.id });

        await db
          .insert(routeStops)
          .values({ id: routeStopId(rId, mi), routeId: rId, meterId: mId, sequence: mi })
          .onConflictDoNothing({ target: routeStops.id });

        const startValue = 500 + (hashSeed(serial) % 3000);
        const history = shapeHistory(
          kind,
          dials,
          generateHistory({ seed: hashSeed(serial), baseMonthlyUsage: NOMINAL_USAGE, registerDials: dials, startValue }, HISTORY_MONTHS, endDate),
        );
        for (const h of history) {
          readRows.push({
            id: readId(mId, h.capturedAt),
            meterId: mId,
            runStopId: null,
            readerId,
            value: h.value,
            capturedAt: new Date(h.capturedAt),
            receivedAt: new Date(h.capturedAt), // historical: received when captured
            sourceType: 'simulated',
            lat,
            lng,
            annotations: {},
            consumption: h.consumption,
            billable: true,
          });
        }
        meterCount++;
      }
    }
  }

  // Batch-insert history (idempotent on id).
  for (let i = 0; i < readRows.length; i += 200) {
    await db.insert(readEvents).values(readRows.slice(i, i + 200)).onConflictDoNothing({ target: readEvents.id });
  }

  // Today's open demo run on the demo route, assigned to the reader.
  const demoRouteId = routeId(CLIENTS[0]!.name, routeName(0));
  const demoClientId = clientId(CLIENTS[0]!.name);
  const runDate = endDate.toISOString().slice(0, 10);
  const cycleId = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}`;
  demoRunId = runId(demoRouteId, runDate);

  await db
    .insert(routeRuns)
    .values({
      id: demoRunId,
      routeId: demoRouteId,
      clientId: demoClientId,
      readerId,
      runDate,
      cycleId,
      status: 'open',
    })
    .onConflictDoNothing({ target: routeRuns.id });

  for (let mi = 0; mi < METERS_PER_ROUTE; mi++) {
    const serial = `${CLIENTS[0]!.code}-1-${String(mi + 1).padStart(3, '0')}`;
    await db
      .insert(runStops)
      .values({
        id: runStopId(demoRunId, mi),
        runId: demoRunId,
        meterId: meterId(serial),
        sequence: mi,
        status: 'pending',
      })
      .onConflictDoNothing({ target: runStops.id });
  }

  return { demoRunId, meterCount, readCount: readRows.length };
}
