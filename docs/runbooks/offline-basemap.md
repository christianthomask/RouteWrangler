# Runbook — Offline basemap tiles (ADR-022)

This provisions the self-hosted vector basemap the field app renders under the
route. Run it once per **service region** from a machine with internet (e.g. a
local Claude Code session) — the remote build session cannot reach the tile data
or Cloudflare. The web client, offline caching, prefetch, and SVG fallback are
already shipped; this only supplies the tile *data* and wires the env.

The client turns the basemap on the moment `NEXT_PUBLIC_MAP_STYLE_URL` is set;
until then it uses the offline SVG plot.

## 1. Build a PMTiles pack from OpenStreetMap

Pick an OSM extract covering your region (Geofabrik publishes per-state/county
`.osm.pbf`). Build vector tiles with planetiler (Java 21+):

```bash
# ~1–2 GB RAM per small region; output is a single file.
wget https://download.geofabrik.de/north-america/us/california-latest.osm.pbf

java -Xmx4g -jar planetiler.jar \
  --download \
  --osm-path=california-latest.osm.pbf \
  --output=region-slo.pmtiles \
  --bounds=-120.90,35.10,-120.50,35.40   # minLng,minLat,maxLng,maxLat of the region
```

`--bounds` keeps the pack small — set it to the union of the routes this region
serves, with margin. Planetiler emits the OpenMapTiles schema, which the style in
step 3 targets.

## 2. Upload to R2

```bash
wrangler r2 bucket create verameter-tiles          # once
wrangler r2 object put verameter-tiles/region-slo.pmtiles --file region-slo.pmtiles
```

Do not make the bucket public; the Worker in step 3 is the only reader.

## 3. Serve `{z}/{x}/{y}` + style on the app origin

Offline caching depends on tiles being **same-origin 200 responses**, so serve
them from the web app's domain, not a raw R2 URL:

- Add a route on the web Worker (or a bound Worker) for:
  - `GET /tiles/:z/:x/:y` → read the tile from `region-slo.pmtiles` on R2 and
    return it (`application/x-protobuf`, long `Cache-Control`). The `pmtiles` npm
    package reads a range from an R2 object via its `Source` interface; pick the
    region pack by the requested tile's location (or shard packs per region and
    route by a path prefix, e.g. `/tiles/slo/:z/:x/:y`).
  - `GET /map/style.json` → a MapLibre style whose vector source is
    `{ "tiles": ["https://<app-origin>/tiles/{z}/{x}/{y}"], "type": "vector" }`
    with OpenMapTiles-schema layers (water, roads, labels). Start from a
    ready-made OpenMapTiles style JSON and point its source at the URL above.

Both paths are already matched by the field service worker's cache-first rule
(`/tiles/`, `/map/`), so no SW change is needed.

## 4. Set the env and deploy

```
NEXT_PUBLIC_MAP_STYLE_URL=/map/style.json
```

Add it to the web app's build/runtime env (GitHub Actions / wrangler vars), then
deploy. On first load the field app fetches the style, renders the basemap, and
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
- **Multiple regions**: shard `.pmtiles` per region and route by path prefix, or
  build one bounded pack per client utility.
