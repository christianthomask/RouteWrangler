/**
 * Pure geo helpers shared by the map camera and the offline tile prefetch
 * (ADR-022). Web Mercator slippy-tile math — no dependencies, unit-tested.
 */

export interface LngLat {
  lng: number;
  lat: number;
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** Tight bounds of the located points, or null when none have coordinates. */
export function boundsOf(points: Array<{ lat: number | null; lng: number | null }>): BBox | null {
  const pts = points.filter((p) => p.lat != null && p.lng != null) as LngLat[];
  if (pts.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of pts) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Expand a bbox by a fraction of its span (and at least `minDeg`, so a single
 * point still yields a real area to cache/frame). Latitude is clamped to the
 * Mercator-valid range.
 */
export function padBBox(b: BBox, fraction = 0.15, minDeg = 0.003): BBox {
  const padLng = Math.max((b.maxLng - b.minLng) * fraction, minDeg);
  const padLat = Math.max((b.maxLat - b.minLat) * fraction, minDeg);
  return {
    minLng: b.minLng - padLng,
    maxLng: b.maxLng + padLng,
    minLat: Math.max(-85.05, b.minLat - padLat),
    maxLat: Math.min(85.05, b.maxLat + padLat),
  };
}

export function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

/**
 * Every tile covering the bbox across [minZoom, maxZoom]. Bounded by MAX_TILES
 * so a stray huge bbox can never queue an unbounded prefetch — the caller logs
 * when the cap trims coverage.
 */
export function tilesForBBox(b: BBox, minZoom: number, maxZoom: number, maxTiles = 1500): Tile[] {
  const tiles: Tile[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const x0 = Math.max(0, lngToTileX(b.minLng, z));
    const x1 = Math.min(n - 1, lngToTileX(b.maxLng, z));
    // y grows southward, so maxLat → smaller y
    const y0 = Math.max(0, latToTileY(b.maxLat, z));
    const y1 = Math.min(n - 1, latToTileY(b.minLat, z));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push({ z, x, y });
        if (tiles.length >= maxTiles) return tiles;
      }
    }
  }
  return tiles;
}
