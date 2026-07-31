import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pre-warm is the difference between a reader having a map in a valley with
 * no signal and having a grey rectangle. It had no tests, and every one of its
 * skip conditions is a silent way to warm nothing at all.
 */
const cfg = vi.hoisted(() => ({ basemapConfigured: true, mapStyleUrl: '/map/style.json' }));
vi.mock('../config', () => ({
  get basemapConfigured() {
    return cfg.basemapConfigured;
  },
  config: {
    get mapStyleUrl() {
      return cfg.mapStyleUrl;
    },
  },
}));

const { warmRouteTiles } = await import('./mapCache');

const STOPS = [
  { lat: 35.28, lng: -120.66 },
  { lat: 35.29, lng: -120.64 },
];

let fetchMock: ReturnType<typeof vi.fn>;

/** A style with one tile-template source, which is what the Worker serves. */
const STYLE = {
  sources: { basemap: { tiles: ['/tiles/{z}/{x}/{y}'] } },
};

function stubFetch(style: unknown = STYLE) {
  fetchMock = vi.fn(async (url: unknown) => {
    if (String(url) === cfg.mapStyleUrl) {
      return { ok: true, json: () => Promise.resolve(style) } as unknown as Response;
    }
    return { ok: true } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
}

function requested() {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  cfg.basemapConfigured = true;
  cfg.mapStyleUrl = '/map/style.json';
  vi.stubGlobal('navigator', { onLine: true });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('warmRouteTiles — when it declines, and says why', () => {
  it('skips with a reason when no basemap is configured', async () => {
    cfg.basemapConfigured = false;
    const res = await warmRouteTiles(STOPS);
    expect(res).toEqual({ cached: 0, attempted: 0, skipped: 'unconfigured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips while offline — there is nothing to warm from', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect((await warmRouteTiles(STOPS)).skipped).toBe('offline');
  });

  it('skips when no stop has coordinates', async () => {
    // A route whose meters were never geocoded has no bounding box to cover.
    const res = await warmRouteTiles([{ lat: null, lng: null }]);
    expect(res.skipped).toBe('no-bounds');
  });

  it('skips a pmtiles:// style rather than fetching nonsense', async () => {
    // Byte-range sources cannot be warmed tile-by-tile; the Worker serves
    // {z}/{x}/{y} precisely so this path is simple.
    stubFetch({ sources: { basemap: { url: 'pmtiles://https://r2/pack.pmtiles' } } });
    expect((await warmRouteTiles(STOPS)).skipped).toBe('no-templates');
  });

  it('skips when the style itself cannot be fetched', async () => {
    fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await warmRouteTiles(STOPS)).skipped).toBe('no-templates');
  });
});

describe('warmRouteTiles — what it warms', () => {
  it('covers z13–15 only, so z16 requests cannot crowd out the packs', async () => {
    // The packs are built to z15; z16 can only ever come back empty, and the
    // batch is capped. MapLibre overzooms on its own, so nothing is lost.
    await warmRouteTiles(STOPS);
    const zooms = new Set(
      requested()
        .filter((u) => u.startsWith('/tiles/'))
        .map((u) => u.split('/')[2]),
    );
    expect([...zooms].sort()).toEqual(['13', '14', '15']);
  });

  it('warms glyphs and sprites alongside the geometry', async () => {
    // Geometry without labels is a map of unnamed streets. Warming them
    // separately would let a reader who goes offline immediately get one and
    // not the other.
    const urls = requestedAfterWarm(await warmRouteTiles(STOPS));
    expect(urls.some((u) => u.includes('/map/fonts/'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/map/sprites/v4/light.png'))).toBe(true);
    // Both DPI variants, because most field phones are hi-dpi and MapLibre
    // picks at runtime.
    expect(urls.some((u) => u.endsWith('light@2x.png'))).toBe(true);
  });

  it('counts what actually cached, not what it asked for', async () => {
    fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === cfg.mapStyleUrl) {
        return { ok: true, json: () => Promise.resolve(STYLE) } as unknown as Response;
      }
      return { ok: !u.startsWith('/tiles/') } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await warmRouteTiles(STOPS);
    expect(res.attempted).toBeGreaterThan(res.cached);
    expect(res.skipped).toBeNull();
  });

  it('survives a network error mid-warm and reports the rest', async () => {
    // Best-effort by design: losing signal halfway through must leave the tiles
    // already fetched in the cache rather than throwing the run open screen away.
    let n = 0;
    fetchMock = vi.fn(async (url: unknown) => {
      if (String(url) === cfg.mapStyleUrl) {
        return { ok: true, json: () => Promise.resolve(STYLE) } as unknown as Response;
      }
      if (++n % 3 === 0) throw new Error('network');
      return { ok: true } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await warmRouteTiles(STOPS);
    expect(res.cached).toBeGreaterThan(0);
    expect(res.cached).toBeLessThan(res.attempted);
  });

  it('is idempotent — a second warm asks for the same set', async () => {
    await warmRouteTiles(STOPS);
    const first = requested().slice(1).sort();
    stubFetch();
    await warmRouteTiles(STOPS);
    expect(requested().slice(1).sort()).toEqual(first);
  });
});

/** The URLs requested during the warm that produced `res` (style fetch aside). */
function requestedAfterWarm(res: { attempted: number }): string[] {
  expect(res.attempted).toBeGreaterThan(0);
  return requested();
}
