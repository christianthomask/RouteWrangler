import { randomUUID } from 'node:crypto';
import type { IngestResponse, RunDetail, RunListResponse } from '@routewrangler/contracts';
import { applyAnomaly, DEMO_ANOMALY_PLAN, DEMO_NOMINAL_USAGE } from './anomalies';
import { mulberry32 } from './generate';

/**
 * Playback client (BUILD_SPEC §7.6). Replays a route through the PUBLIC
 * ingestion API with reader credentials — zero privileged access (§2.1). This
 * file imports only `@routewrangler/contracts` and talks HTTP; it never touches
 * the API's DB or internals.
 */
export interface PlaybackConfig {
  apiBaseUrl: string;
  /** Cognito sub for the local dev-bypass header (ADR-012). */
  readerSub?: string;
  /** Or a real Cognito bearer token (prod). */
  bearerToken?: string;
  runId?: string;
  seed?: number;
}

export interface PlaybackSummary {
  runId: string;
  batch: IngestResponse;
  duplicate: IngestResponse | null;
}

function authHeaders(cfg: PlaybackConfig): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.bearerToken) h.authorization = `Bearer ${cfg.bearerToken}`;
  if (cfg.readerSub) h['x-dev-user-sub'] = cfg.readerSub;
  return h;
}

async function api<T>(cfg: PlaybackConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(cfg), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function runPlayback(cfg: PlaybackConfig): Promise<PlaybackSummary> {
  const me = await api<{ id: string }>(cfg, '/me');

  const runId =
    cfg.runId ??
    (await api<RunListResponse>(cfg, '/runs?status=open')).runs[0]?.id;
  if (!runId) throw new Error('no open run to play back (seed a demo run first)');

  const run = await api<RunDetail>(cfg, `/runs/${runId}`);
  const prng = mulberry32(cfg.seed ?? 42);
  const capturedAt = new Date().toISOString();

  const pending = run.stops.filter((s) => s.status === 'pending');
  if (pending.length === 0) {
    throw new Error(
      `run ${runId} has no pending stops — re-seed for a fresh demo (drop, migrate, seed)`,
    );
  }
  const events = pending.map((stop, i) => {
    const kind = DEMO_ANOMALY_PLAN[i] ?? 'clean';
    const read = applyAnomaly(kind, {
      prevValue: stop.lastValue ?? 0,
      baseline: DEMO_NOMINAL_USAGE,
      registerDials: stop.registerDials,
      baseLat: stop.lat ?? 37.0,
      baseLng: stop.lng ?? -122.0,
      prng,
    });
    return {
      id: randomUUID(),
      meterId: stop.meterId,
      runStopId: stop.id,
      readerId: me.id,
      value: read.value,
      capturedAt,
      sourceType: 'simulated' as const,
      lat: read.lat,
      lng: read.lng,
    };
  });

  const batch = await api<IngestResponse>(cfg, '/ingest/read-events', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });

  // Exercise the duplicate rule: re-read the first (now completed) stop with a
  // disagreeing value (BUILD_SPEC §7.1).
  let duplicate: IngestResponse | null = null;
  const firstStop = pending[0];
  if (firstStop) {
    duplicate = await api<IngestResponse>(cfg, '/ingest/read-events', {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            id: randomUUID(),
            meterId: firstStop.meterId,
            runStopId: firstStop.id,
            readerId: me.id,
            value: (firstStop.lastValue ?? 0) + DEMO_NOMINAL_USAGE * 3 + 500,
            capturedAt,
            sourceType: 'simulated',
            lat: firstStop.lat,
            lng: firstStop.lng,
          },
        ],
      }),
    });
  }

  return { runId, batch, duplicate };
}
