/**
 * Glyph (font PBF) proxy for the self-hosted field basemap (ADR-022).
 *
 * MapLibre resolves the style's `glyphs` template to
 * `/map/fonts/{fontstack}/{range}.pbf`. We serve those from our own origin
 * rather than pointing the style straight at R2 for the same reason as
 * `/tiles/`: the field service worker only caches same-origin `/map/` and
 * `/tiles/` paths, so a cross-origin glyph URL would render labels online and
 * silently drop them the moment the reader loses signal.
 *
 * Upstream is the public R2 bucket the assets were mirrored into from
 * protomaps.github.io. That bucket's `r2.dev` endpoint is rate limited (it
 * returns 429 under bursts), which is a second reason to sit behind a
 * long-lived cache here: a cold map view asks for several stacks at once.
 *
 * Runs on the Workers runtime under OpenNext — fetch only, no Node APIs.
 */

const UPSTREAM = 'https://pub-2ee088749431423b8d9f7253c9e8bbc4.r2.dev/fonts';

/**
 * The mirrored stacks. MapLibre will happily request any `text-font` value in
 * the style, but only these three appear in it (including inside the
 * `places_locality` case expression), so anything else is a typo or a stale
 * client and is cheaper to reject than to proxy.
 */
const STACKS = new Set(['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']);

/** Glyph PBFs are immutable for a given basemaps-assets version — cache hard. */
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' };

/** Unicode ranges are 256 codepoints wide and start on a multiple of 256. */
const RANGE = /^(\d{1,5})-(\d{1,5})$/;

function validRange(raw: string): boolean {
  const m = RANGE.exec(raw);
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start % 256 === 0 && end === start + 255 && end <= 65535;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ stack: string; range: string }> },
): Promise<Response> {
  const { stack: stackRaw, range: rangeRaw } = await ctx.params;

  // Next has already percent-decoded the segment, so `stack` arrives with real
  // spaces ("Noto Sans Regular") — which is exactly how the R2 keys are stored.
  const stack = decodeURIComponent(stackRaw);
  // The style template requests `.pbf`; tolerate a bare `{range}` too.
  const range = rangeRaw.replace(/\.pbf$/, '');

  if (!STACKS.has(stack) || !validRange(range)) {
    return new Response('Unknown font stack or range', { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}/${encodeURIComponent(stack)}/${range}.pbf`);
  } catch {
    // A transient R2 failure must not take labels down for good. 503 with no
    // cache headers so the client retries against origin rather than pinning
    // an error for a year.
    return new Response('Glyph upstream unavailable', { status: 503 });
  }

  if (!upstream.ok) {
    return new Response('Glyph not found', { status: upstream.status === 404 ? 404 : 503 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-protobuf',
      ...CACHE_HEADERS,
    },
  });
}
