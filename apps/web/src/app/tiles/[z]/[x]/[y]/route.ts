import { PMTiles } from 'pmtiles';

/**
 * Vector basemap tile server (ADR-022, docs/runbooks/offline-basemap.md).
 *
 * Serves `{z}/{x}/{y}` MVT tiles out of PMTiles archives on public R2 via HTTP
 * range requests. We deliberately do NOT expose a `pmtiles://` source to the
 * client: the field service worker caches `/tiles/` cache-first and the
 * per-route prefetch (lib/field/mapCache.ts) warms the offline store by
 * fetching tile URLs. Single-file byte ranges cannot be pre-warmed that way, so
 * a `pmtiles://` source would silently break offline basemaps.
 *
 * Runs on the Workers runtime under OpenNext — fetch/DecompressionStream only,
 * no Node-specific APIs.
 */

interface Pack {
  url: string;
  /** [west, south, east, north] */
  bounds: readonly [number, number, number, number];
}

const PACKS: readonly Pack[] = [
  {
    // San Luis Obispo + Morro Bay
    url: 'https://pub-2ee088749431423b8d9f7253c9e8bbc4.r2.dev/centralcoast.pmtiles',
    bounds: [-120.9999, 35.1328, -120.5096, 35.5158],
  },
  {
    // Bend, OR
    url: 'https://pub-2ee088749431423b8d9f7253c9e8bbc4.r2.dev/bend.pmtiles',
    bounds: [-121.4653, 43.9082, -121.1653, 44.2082],
  },
];

/**
 * Upper bound for a *well-formed* coordinate, not the data's maxzoom (15). The
 * pmtiles tile-id math is only safe to z26. Anything above the archive's own
 * maxzoom is a valid request we simply have no data for, so it falls through to
 * a 204 rather than a 400: overzoomed requests are well-formed and must not
 * surface as hard errors.
 */
const MAX_ZOOM = 26;

/** Tiles are immutable for a given pack build — cache hard, everywhere. */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' };

/**
 * "No data here" is only true for the *current* set of packs — adding a region
 * later must not be masked by a year-long cached empty. Short TTL so new
 * coverage appears on its own.
 */
const EMPTY_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400' };

/**
 * One PMTiles instance per pack, kept in module scope. Each instance holds the
 * parsed header and a directory cache, so warm requests cost a single range
 * request for the tile itself rather than re-fetching the header every time.
 */
const archives = new Map<string, PMTiles>();

function archiveFor(pack: Pack): PMTiles {
  let pmt = archives.get(pack.url);
  if (!pmt) {
    pmt = new PMTiles(pack.url);
    archives.set(pack.url, pmt);
  }
  return pmt;
}

/** Longitude of the western edge of tile column `x` at zoom `z`. */
function tileLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

/** Latitude of the northern edge of tile row `y` at zoom `z` (Web Mercator). */
function tileLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

/** Does the tile's bbox overlap the pack's bbox? */
function covers(pack: Pack, z: number, x: number, y: number): boolean {
  const west = tileLon(x, z);
  const east = tileLon(x + 1, z);
  const north = tileLat(y, z);
  const south = tileLat(y + 1, z);
  const [pw, ps, pe, pn] = pack.bounds;
  return west < pe && east > pw && south < pn && north > ps;
}

function parseInt10(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z: zRaw, x: xRaw, y: yRaw } = await ctx.params;

  // The style template requests `.mvt`; tolerate a bare `{y}` too.
  const z = parseInt10(zRaw);
  const x = parseInt10(xRaw);
  const y = parseInt10(yRaw.replace(/\.(mvt|pbf)$/, ''));

  if (z === null || x === null || y === null || z > MAX_ZOOM) {
    return new Response('Bad tile coordinates', { status: 400 });
  }
  const limit = 2 ** z;
  if (x >= limit || y >= limit) {
    return new Response('Tile coordinates out of range for zoom', { status: 400 });
  }

  const pack = PACKS.find((p) => covers(p, z, x, y));
  // Outside every pack — same short TTL, for the same reason.
  if (!pack) return new Response(null, { status: 204, headers: EMPTY_CACHE_HEADERS });

  let tile;
  try {
    tile = await archiveFor(pack).getZxy(z, x, y);
  } catch {
    // A transient R2/range failure must not take the map down — treat as empty.
    // Don't cache it, so the next request retries against origin.
    return new Response(null, { status: 204 });
  }

  // Sparse archives legitimately have no tile for a covered bbox (e.g. ocean).
  if (!tile) return new Response(null, { status: 204, headers: EMPTY_CACHE_HEADERS });

  // NOTE: these archives use gzip *internal tile compression*, but pmtiles@4
  // already decompresses in `getZxy` (it applies `header.tileCompression`
  // itself), so `tile.data` is plain MVT. Setting Content-Encoding: gzip here
  // would be a lie and break every client. Leave transport compression to the
  // platform.
  return new Response(tile.data as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      ...CACHE_HEADERS,
    },
  });
}
