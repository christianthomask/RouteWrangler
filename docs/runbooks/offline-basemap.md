# Runbook — Offline basemap tiles (ADR-022)

This provisions the self-hosted vector basemap the field app renders under the
route. Run it once per **service region** from a machine with internet (e.g. a
local Claude Code session) — the remote build session cannot reach the tile data
or Cloudflare. The web client, offline caching, prefetch, and SVG fallback are
already shipped; this only supplies the tile *data* and wires the env.

The client turns the basemap on the moment `NEXT_PUBLIC_MAP_STYLE_URL` is set;
until then it uses the offline SVG plot.

## 1. Extract a PMTiles pack from the Protomaps daily build

We **do not** run planetiler. Protomaps publishes a daily planet build, and the
`pmtiles` CLI extracts a bbox from it over HTTP range requests — a city-scale
pack takes seconds and needs no JVM and no multi-GB download.

```bash
# CLI: https://github.com/protomaps/go-pmtiles/releases (Linux assets are .tar.gz)
pmtiles extract https://build.protomaps.com/$(date -d '2 days ago' +%Y%m%d).pmtiles \
  centralcoast.pmtiles \
  --bbox=-120.9999,35.1328,-120.5096,35.5158 \
  --maxzoom=15
```

Builds are retained about two weeks, so **compute the date** rather than pinning
one; a missing build 404s. Set `--bbox` to the union of the routes the pack
serves, with margin — one pack per region, or one merged pack for regions close
enough to overlap (SLO + Morro Bay are ~20 km apart, so merged is smaller than
the two separately).

Verify before uploading:

```bash
pmtiles show centralcoast.pmtiles   # bounds, maxzoom, layer list
pmtiles verify centralcoast.pmtiles
```

> **Schema:** these packs use the **protomaps** schema (`earth, landcover,
> landuse, water, boundaries, roads, buildings, places, pois`) — *not*
> OpenMapTiles. The style in step 3 must target it; an OpenMapTiles style will
> render a blank map against these tiles.

## 2. Upload to R2

```bash
wrangler r2 bucket create verameter-tiles          # once
wrangler r2 object put verameter-tiles/centralcoast.pmtiles \
  --file centralcoast.pmtiles --content-type application/octet-stream --remote
```

The bucket is **public** (`wrangler r2 bucket dev-url enable verameter-tiles`),
which is a deliberate deviation from the original private-bucket plan: the packs
are unmodified public OpenStreetMap data, so there is nothing in them to protect,
and public range reads let the app's tile route stay a thin proxy with no R2
binding. Restrict origins anyway so the bandwidth isn't hotlinked:

```bash
wrangler r2 bucket cors set verameter-tiles --file tiles-cors.json
```

with `allowed.origins` set to the app origins, `methods` `GET`/`HEAD`, and
`range` in `allowed.headers` (range requests are the whole access pattern).

## 3. Serve `{z}/{x}/{y}` + style on the app origin

Offline caching depends on tiles being **same-origin 200 responses**, so serve
them from the web app's domain, not a raw R2 URL:

This is why the app serves `{z}/{x}/{y}` itself instead of pointing MapLibre at
a `pmtiles://` URL directly: a pmtiles source does single-file byte ranges, which
`warmRouteTiles` cannot pre-warm and the service worker cannot cache per tile.
Pointing the client straight at R2 would work online and silently fail offline.

Both routes live in the **existing Next.js app** (`apps/web`) — no separate
Worker to deploy:

- `apps/web/src/app/tiles/[z]/[x]/[y]/route.ts` → picks the pack whose bounds
  contain the tile, range-reads it from the public R2 URL with the `pmtiles`
  package, and returns it (long `Cache-Control`). Tiles are stored gzipped, so it
  passes `Content-Encoding: gzip` through rather than re-compressing.
- `apps/web/src/app/map/style.json/route.ts` → a MapLibre style built with
  `layers()` from `@protomaps/basemaps`, source pointed at `/tiles/{z}/{x}/{y}.mvt`
  on the request's own origin. The style is generated rather than committed, so
  it can't drift from the schema in the packs.

Both paths are already matched by the field service worker's cache-first rule
(`/tiles/`, `/map/`), so no SW change is needed.

> **Known gap:** glyphs and sprites are still fetched from
> `protomaps.github.io`, so **labels do not render offline** — streets and water
> do. Closing it means mirroring the three Noto Sans font stacks and the v4
> sprite sheet into the same bucket and repointing `glyphs`/`sprite`.

## 4. Set the env and deploy

```
NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json
```

This is now the **default** in `lib/config.ts`, since the app serves its own
style — set the env var only to point at a different style. Deploy as usual. On first load the field app fetches the style, renders the basemap, and
`warmRouteTiles` begins caching each opened run's bbox for offline use.

## 5. Verify

- Open a run online → the map shows streets; DevTools ▸ Application ▸ Cache shows
  a growing `verameter-tiles` cache.
- Toggle offline (airplane mode) and reopen the run → the basemap still renders
  from cache; the route/stops overlay is unchanged.
- Force a style/tile failure (bad URL) → the app falls back to the SVG plot with
  no error surfaced to the reader.

## Notes

- **Zoom range** cached for offline is z13–16 (`lib/field/mapCache.ts`); widen
  `MIN_ZOOM`/`MAX_ZOOM` if readers pinch in further, at the cost of cache size.
- **Refresh** a region by rebuilding the pack and re-uploading; the basemap is
  cosmetic — billing and reads never depend on it, so staleness is safe.
- **Multiple regions**: add the pack to the bounds table in the tile route; it
  picks the covering pack per tile, so no path prefix or client hint is needed.
  A tile outside every pack returns empty and the map simply shows background.
- **Currently provisioned**: `centralcoast.pmtiles` (San Luis Obispo + Morro Bay)
  and `bend.pmtiles` (Bend, OR) — the three seeded client cities.
