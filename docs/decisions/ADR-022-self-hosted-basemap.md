# ADR-022 — Real basemap via self-hosted PMTiles + MapLibre, offline per route

Status: Accepted (client shipped; tile packs are an infra step).

## Context

The offline SVG plot (ADR-021) shows route shape and progress but no geography —
"straight points in a void," in the field it's near useless for actually finding
a house. Readers need a real basemap (streets, blocks, water) *under* the route,
and it has to survive with no signal, which is exactly where they work.

## Decision

Self-host the basemap; render it client-side; cache it per route.

- **Tiles: self-hosted PMTiles on R2.** Vector tiles are built from OpenStreetMap
  with `planetiler` into a single `.pmtiles` archive per service region and stored
  on **R2** (our existing storage vendor, ADR-015/019). No third-party map vendor,
  no API keys, no per-tile fees — consistent with the vendor-neutral tenet.
- **Serve as `{z}/{x}/{y}`, not `pmtiles://`.** A small Cloudflare Worker reads the
  PMTiles from R2 and returns individual tiles at `/tiles/{z}/{x}/{y}` on the app
  origin, with the MapLibre style at `/map/style.json`. Plain 200 responses on the
  same origin are trivially cacheable by the service worker — the key to reliable
  offline. (A `pmtiles://` source works online but its byte-range reads don't cache
  cleanly, so it's not the offline path.)
- **Render: MapLibre GL.** `BaseMap` (client-only, dynamic-imported so it stays out
  of the shared bundle and never runs during SSR) draws the route + stops as a
  GeoJSON overlay — route line, status-colored circles, current (brand) and next
  (ringed) — over the vector basemap, with the camera fit per focus.
- **Offline: per-route bounding box.** When a reader opens a run online,
  `warmRouteTiles` computes the padded bbox of the run's stops and pre-fetches the
  covering tiles (z13–16); the field service worker caches `/tiles/` and `/map/`
  cache-first in a long-lived `verameter-tiles` cache that shell version bumps do
  not evict. Losing signal mid-route leaves the map intact.
- **Always-available fallback.** `RouteMapView` renders `BaseMap` only when a style
  URL is configured *and* it loads; with no style, no WebGL, or a load error it
  falls back to the ADR-021 SVG plot. Until the tile packs are provisioned the app
  ships today's behavior, unchanged.

## Consequences

- Real streets require the one-time, online tile-pack build per region
  (`docs/runbooks/offline-basemap.md`) run from a local Claude Code session — the
  client, offline caching, prefetch, and fallback are all in place and verified
  now (MapLibre mount + overlay + camera exercised against a background style;
  fallback exercised with no style).
- Adds MapLibre GL (~WebGL, code-split) and `pmtiles`. Field devices need WebGL;
  the SVG fallback covers anything that doesn't.
- The tiles cache is per-route and unbounded within a run; a future enhancement is
  an LRU/size cap and a "clear offline maps" control. Acceptable now — a route's
  bbox at z13–16 is a small, bounded set.
- Region packs are rebuilt when the map should reflect OSM changes; billing/reads
  don't depend on the basemap, so staleness is cosmetic.
