import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * MapLibre style JSON for the self-hosted field basemap (ADR-022).
 *
 * The vector source points back at this app's own `/tiles/{z}/{x}/{y}.mvt`
 * handler (a tile template, not `pmtiles://`) so the field service worker can
 * cache it and lib/field/mapCache.ts can pre-warm it for offline runs.
 *
 * KNOWN GAP: glyphs and sprites are still fetched from protomaps.github.io, so
 * map *labels* and icons will not render with no signal even though the tile
 * geometry will. Self-hosting those assets is tracked separately.
 */

const SOURCE = 'protomaps';

const ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>';

export async function GET(req: Request): Promise<Response> {
  // Derive the origin from the request so the style works on localhost, on
  // preview deploys and in production without a build-time env var.
  const origin = new URL(req.url).origin;

  const style = {
    version: 8,
    sources: {
      // Key MUST match the first argument to layers() below.
      [SOURCE]: {
        type: 'vector',
        tiles: [`${origin}/tiles/{z}/{x}/{y}.mvt`],
        minzoom: 0,
        maxzoom: 15,
        attribution: ATTRIBUTION,
      },
    },
    layers: layers(SOURCE, namedFlavor('light'), { lang: 'en' }),
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
  };

  return new Response(JSON.stringify(style), {
    headers: {
      'Content-Type': 'application/json',
      // Short-lived: the style embeds the request origin and is cheap to rebuild,
      // but the SW still caches it for offline launches.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
