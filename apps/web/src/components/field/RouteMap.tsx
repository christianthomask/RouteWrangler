'use client';

/**
 * Offline route map (ADR-021). No tiles, no keys, no network: stops are plotted
 * from their own GPS coordinates as an equirectangular projection (longitude
 * corrected by cos(lat) so the route isn't stretched east–west). It shows route
 * shape, progress, and where you are — the reader hands off to the phone's native
 * Maps for turn-by-turn. Renders identically with zero signal.
 */

export type MapTone = 'done' | 'skipped' | 'pending';

export interface MapStop {
  id: string;
  sequence: number;
  lat: number | null;
  lng: number | null;
  tone: MapTone;
}

type Placed = { stop: MapStop; x: number; y: number };

const TONE: Record<MapTone, string> = {
  done: 'var(--rw-sync-synced)',
  skipped: 'var(--rw-warning)',
  pending: 'var(--rw-text-muted)',
};

const W = 320;
const PAD = 22;

function layout(stops: MapStop[], bounds: MapStop[], h: number): Placed[] {
  const geo = stops.filter((s) => s.lat != null && s.lng != null) as (MapStop & { lat: number; lng: number })[];
  const bnd = (bounds.filter((s) => s.lat != null && s.lng != null) as (MapStop & { lat: number; lng: number })[]);
  if (geo.length === 0 || bnd.length === 0) return [];

  const meanLat = (bnd.reduce((a, s) => a + s.lat, 0) / bnd.length) * (Math.PI / 180);
  const cos = Math.max(0.1, Math.cos(meanLat));
  const px = (s: { lng: number }) => s.lng * cos;
  const py = (s: { lat: number }) => s.lat;

  const xs = bnd.map(px);
  const ys = bnd.map(py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;

  const scale = Math.min((W - 2 * PAD) / spanX, (h - 2 * PAD) / spanY);
  // Center the drawn extent within the box.
  const offX = (W - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;

  return geo.map((s) => ({
    stop: s,
    x: offX + (px(s) - minX) * scale,
    // invert Y so north is up
    y: offY + (maxY - py(s)) * scale,
  }));
}

export function RouteMap({
  stops,
  currentId,
  nextId,
  focus = 'route',
  height = 200,
  onSelect,
}: {
  stops: MapStop[];
  currentId?: string;
  nextId?: string;
  focus?: 'route' | 'current';
  height?: number;
  onSelect?: (id: string) => void;
}) {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  // In 'current' focus we zoom the viewport to just current + next.
  const boundsSet =
    focus === 'current'
      ? ordered.filter((s) => s.id === currentId || s.id === nextId)
      : ordered;
  const placed = layout(ordered, boundsSet.length ? boundsSet : ordered, height);

  if (placed.length === 0) {
    return (
      <div
        className="rw-card"
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--rw-text-muted)',
          fontSize: 'var(--rw-text-sm)',
          textAlign: 'center',
          padding: 'var(--rw-space-4)',
        }}
      >
        No location data for these stops yet
      </div>
    );
  }

  const byId = new Map(placed.map((p) => [p.stop.id, p]));
  const pathPts = placed.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const cur = currentId ? byId.get(currentId) : undefined;
  const nxt = nextId ? byId.get(nextId) : undefined;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Route map"
      style={{ display: 'block', background: 'var(--rw-surface-2)', borderRadius: 'var(--rw-radius)' }}
    >
      {/* route line through all stops, in sequence */}
      {placed.length > 1 && (
        <polyline points={pathPts} fill="none" stroke="var(--rw-border)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* emphasized current → next leg */}
      {cur && nxt && (
        <line
          x1={cur.x}
          y1={cur.y}
          x2={nxt.x}
          y2={nxt.y}
          stroke="var(--rw-brand)"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="1 6"
        />
      )}

      {placed.map((p) => {
        const isCur = p.stop.id === currentId;
        const isNext = p.stop.id === nextId;
        const r = isCur ? 8 : isNext ? 6 : 4;
        const fill = isCur ? 'var(--rw-brand)' : isNext ? 'var(--rw-surface)' : TONE[p.stop.tone];
        return (
          <g
            key={p.stop.id}
            transform={`translate(${p.x} ${p.y})`}
            onClick={onSelect ? () => onSelect(p.stop.id) : undefined}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {isCur && <circle r={r + 4} fill="var(--rw-brand)" opacity={0.18} />}
            <circle
              r={r}
              fill={fill}
              stroke={isNext ? 'var(--rw-brand)' : 'var(--rw-surface)'}
              strokeWidth={isNext ? 2 : 1.5}
            />
            {/*
              * Every stop is labelled, not only the current and next ones. In
              * route focus the run-detail map rendered a single label over a
              * field of identical dots, so a reader could not tell reading order
              * or which dot was which stop.
              *
              * "Current" rather than "You": this marks the stop being worked,
              * not the reader's position — misleading on a screen that may also
              * be reporting GPS as denied.
              */}
            <text
              y={-r - 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--rw-text-secondary)"
            >
              {isCur ? 'Current' : isNext ? 'Next' : `#${p.stop.sequence + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
