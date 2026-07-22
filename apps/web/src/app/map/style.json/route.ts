import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * MapLibre style JSON for the self-hosted field basemap (ADR-022).
 *
 * The vector source points back at this app's own `/tiles/{z}/{x}/{y}.mvt`
 * handler (a tile template, not `pmtiles://`) so the field service worker can
 * cache it and lib/field/mapCache.ts can pre-warm it for offline runs.
 *
 * Glyphs and sprites are served the same way, from `/map/fonts/` and
 * `/map/sprites/` — both mirrored from protomaps.github.io into the same R2
 * bucket as the tiles. That closes the old gap where labels and icons vanished
 * with no signal even though the tile geometry still drew: every asset the map
 * needs is now same-origin under a path the service worker caches.
 */

const SOURCE = 'protomaps';

const ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>';

/**
 * The origin the *client* actually used, so every asset URL in the style stays
 * same-origin.
 *
 * `new URL(req.url).origin` is not that: the dev server normalizes it to its own
 * configured hostname, so a browser on http://127.0.0.1:3000 was handed
 * http://localhost:3000 tile, glyph and sprite URLs and every one of them failed
 * CORS — the basemap silently fell back to the plain SVG plot. The Host header
 * is what the client sent; x-forwarded-* wins behind a proxy or CDN.
 */
function originOf(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return new URL(req.url).origin;
  const proto =
    req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(req: Request): Promise<Response> {
  // Derived per-request so the style works on localhost, on preview deploys and
  // in production without a build-time env var.
  const origin = originOf(req);

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
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    // A *base* URL — MapLibre appends `.json`/`.png` and the `@2x` pair itself.
    sprite: `${origin}/map/sprites/v4/light`,
  };

  return new Response(JSON.stringify(style), {
    headers: {
      'Content-Type': 'application/json',
      // Short-lived: the style embeds the request origin and is cheap to rebuild,
      // but the SW still caches it for offline launches.
      'Cache-Control': 'public, max-age=3600',
      // The body varies by Host — tile, glyph and sprite URLs are built from the
      // request origin. Without this, a shared cache keyed on path alone can
      // serve one hostname's style to another, and every asset then fails CORS.
      // Matters wherever the app answers on more than one name (apex and www, a
      // preview domain alongside the custom one).
      Vary: 'Host',
    },
  });
}
