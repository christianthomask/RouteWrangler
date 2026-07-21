'use client';

import { basemapConfigured, config } from '../config';
import { boundsOf, padBBox, tilesForBBox } from './geo';

/**
 * Per-route offline tile prefetch (ADR-022). When a reader opens a run online we
 * warm the basemap tiles covering that route's bounding box so the map still
 * renders once they lose signal. It works by fetching each {z}/{x}/{y} tile URL —
 * the field service worker caches `/tiles/` cache-first, so the fetch itself is
 * what populates the offline store. Best-effort and idempotent: a second call
 * re-warms from cache for free.
 *
 * Only tile-template vector sources can be pre-warmed this way; a `pmtiles://`
 * source (single-file byte ranges) is skipped — the runbook serves tiles via a
 * Worker as {z}/{x}/{y} precisely so offline caching is simple and reliable.
 */

const MIN_ZOOM = 13;
// The tile packs are built to z15 (see the offline-basemap runbook), so z16
// requests can only ever come back empty — and because the batch is capped,
// they would crowd out z13–15 tiles the reader actually needs offline.
// MapLibre overzooms past the source maxzoom on its own, so nothing is lost.
const MAX_ZOOM = 15;
const CONCURRENCY = 8;

export interface WarmResult {
  cached: number;
  attempted: number;
  skipped: 'unconfigured' | 'offline' | 'no-bounds' | 'no-templates' | null;
}

type Located = { lat: number | null; lng: number | null };

export async function warmRouteTiles(stops: Located[]): Promise<WarmResult> {
  const nil = (skipped: WarmResult['skipped']): WarmResult => ({ cached: 0, attempted: 0, skipped });
  if (!basemapConfigured) return nil('unconfigured');
  if (typeof navigator !== 'undefined' && !navigator.onLine) return nil('offline');

  const b = boundsOf(stops);
  if (!b) return nil('no-bounds');

  const templates = await tileTemplates();
  if (templates.length === 0) return nil('no-templates');

  const tiles = tilesForBBox(padBBox(b, 0.2), MIN_ZOOM, MAX_ZOOM, 900);
  const urls = tiles.flatMap((t) =>
    templates.map((tpl) =>
      tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)),
    ),
  );

  let cached = 0;
  await pooled(urls, CONCURRENCY, async (url) => {
    try {
      const res = await fetch(url);
      if (res.ok) cached++;
    } catch {
      /* offline / transient — best effort */
    }
  });
  return { cached, attempted: urls.length, skipped: null };
}

/** Pull the {z}/{x}/{y} tile templates out of the configured MapLibre style. */
async function tileTemplates(): Promise<string[]> {
  try {
    const style = (await (await fetch(config.mapStyleUrl)).json()) as {
      sources?: Record<string, { tiles?: string[] }>;
    };
    const out: string[] = [];
    for (const src of Object.values(style.sources ?? {})) {
      if (Array.isArray(src.tiles)) out.push(...src.tiles);
    }
    return out;
  } catch {
    return [];
  }
}

/** Run `fn` over `items` with bounded concurrency. */
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
