/**
 * Sprite sheet proxy for the self-hosted field basemap (ADR-022).
 *
 * MapLibre takes the style's `sprite` value as a *base* and appends the
 * variant itself — `.json`/`.png`, plus the `@2x` pair on high-DPI screens —
 * so this handler sees `/map/sprites/v4/light.json`, `/map/sprites/v4/light@2x.png`
 * and so on. Same-origin for the same reason as `/tiles/` and `/map/fonts/`:
 * the field service worker caches `/map/` cache-first, and a cross-origin
 * sprite URL would drop every map icon as soon as the reader loses signal.
 *
 * Runs on the Workers runtime under OpenNext — fetch only, no Node APIs.
 */

const UPSTREAM = 'https://pub-2ee088749431423b8d9f7253c9e8bbc4.r2.dev/sprites';

/** Sprites are immutable for a given basemaps-assets version — cache hard. */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' };

/**
 * Exactly the four objects mirrored into R2. An allowlist rather than a path
 * sanitiser: the set is tiny and fixed, so there is no reason to let arbitrary
 * segments through to the bucket.
 */
const FILES: Record<string, string> = {
  'v4/light.json': 'application/json',
  'v4/light.png': 'image/png',
  'v4/light@2x.json': 'application/json',
  'v4/light@2x.png': 'image/png',
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string[] }> },
): Promise<Response> {
  const { file } = await ctx.params;
  const key = file.map((s) => decodeURIComponent(s)).join('/');

  const contentType = FILES[key];
  if (!contentType) return new Response('Unknown sprite', { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${key.split('/').map(encodeURIComponent).join('/')}`);
  } catch {
    // Transient R2 failure — 503 uncached so the client retries against origin.
    return new Response('Sprite upstream unavailable', { status: 503 });
  }

  if (!upstream.ok) {
    return new Response('Sprite not found', { status: upstream.status === 404 ? 404 : 503 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      ...CACHE_HEADERS,
    },
  });
}
