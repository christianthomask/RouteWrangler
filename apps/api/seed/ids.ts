import { v5 as uuidv5 } from 'uuid';

/**
 * Deterministic UUIDs (BUILD_SPEC §5 determinism). Every seeded row's id is a
 * UUIDv5 of a stable natural key, so re-seeding upserts the same rows and the
 * demo narrative reproduces exactly. No random ids in the seed.
 */
const NS = 'a1b2c3d4-0000-4000-8000-000000000000';

export const id = (key: string): string => uuidv5(key, NS);

export const userId = (sub: string) => id(`user:${sub}`);
export const clientId = (name: string) => id(`client:${name}`);
export const meterId = (serial: string) => id(`meter:${serial}`);
export const routeId = (client: string, name: string) => id(`route:${client}:${name}`);
export const routeStopId = (route: string, seq: number) => id(`route_stop:${route}:${seq}`);
export const runId = (route: string, date: string) => id(`run:${route}:${date}`);
export const runStopId = (run: string, seq: number) => id(`run_stop:${run}:${seq}`);
export const readId = (meter: string, capturedAt: string) => id(`read:${meter}:${capturedAt}`);

/** Small stable integer hash for PRNG seeds (from a serial, etc.). */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
