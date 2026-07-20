'use client';

/**
 * Capture GPS vs the meter's registered location (BUILD_SPEC §7.3). No map tiles
 * (offline-friendly, no vendor): a schematic with both pins, the distance
 * between them, and a plain verdict. GPS-absent is a first-class state.
 */
const NEAR_METERS = 25;

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function GpsCompare({
  meterLat,
  meterLng,
  captureLat,
  captureLng,
}: {
  meterLat: number | null;
  meterLng: number | null;
  captureLat: number | null;
  captureLng: number | null;
}) {
  const hasMeter = meterLat != null && meterLng != null;
  const hasCapture = captureLat != null && captureLng != null;

  let verdict: { text: string; color: string };
  let distance: number | null = null;
  if (!hasCapture) {
    verdict = { text: 'No GPS captured (location-absent)', color: 'var(--rw-sev-low)' };
  } else if (!hasMeter) {
    verdict = { text: 'Meter has no registered location', color: 'var(--rw-text-muted)' };
  } else {
    distance = haversine([meterLat, meterLng], [captureLat, captureLng]);
    verdict =
      distance <= NEAR_METERS
        ? { text: `Capture matches registered location (${distance.toFixed(0)} m)`, color: 'var(--rw-success)' }
        : { text: `Capture is ${distance.toFixed(0)} m from registered location`, color: 'var(--rw-sev-high)' };
  }

  // Schematic: place pins in a small box by their relative offset.
  const box = 120;
  const both = hasMeter && hasCapture;
  const spread = both ? Math.max(Math.abs(meterLat - captureLat), Math.abs(meterLng - captureLng), 1e-5) : 1;
  const pos = (lat: number, lng: number) => ({
    cx: 60 + ((lng - (meterLng ?? lng)) / (spread * 2)) * (box - 24),
    cy: 60 - ((lat - (meterLat ?? lat)) / (spread * 2)) * (box - 24),
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--rw-space-4)', alignItems: 'center' }}>
        <svg width={box} height={box} style={{ border: '1px solid var(--rw-border)', borderRadius: 'var(--rw-radius)', background: 'var(--rw-surface-2)', flex: 'none' }}>
          {hasMeter && (() => { const p = pos(meterLat, meterLng); return <g><circle cx={p.cx} cy={p.cy} r={5} fill="var(--rw-brand)" /><text x={p.cx + 8} y={p.cy + 3} fontSize={9} fill="var(--rw-text-muted)">meter</text></g>; })()}
          {both && distance != null && (() => { const m = pos(meterLat, meterLng); const c = pos(captureLat!, captureLng!); return <line x1={m.cx} y1={m.cy} x2={c.cx} y2={c.cy} stroke="var(--rw-border-strong)" strokeDasharray="3 3" />; })()}
          {hasCapture && (() => { const p = pos(captureLat, captureLng); return <g><circle cx={p.cx} cy={p.cy} r={5} fill={distance != null && distance > NEAR_METERS ? 'var(--rw-sev-high)' : 'var(--rw-success)'} /><text x={p.cx + 8} y={p.cy + 3} fontSize={9} fill="var(--rw-text-muted)">read</text></g>; })()}
        </svg>
        <div style={{ fontSize: 'var(--rw-text-sm)' }}>
          <div style={{ color: verdict.color, fontWeight: 600 }}>{verdict.text}</div>
          <div style={{ color: 'var(--rw-text-muted)', marginTop: 6 }} className="tabular">
            {hasMeter ? `Registered: ${meterLat.toFixed(5)}, ${meterLng.toFixed(5)}` : 'Registered: —'}
          </div>
          <div style={{ color: 'var(--rw-text-muted)' }} className="tabular">
            {hasCapture ? `Captured: ${captureLat.toFixed(5)}, ${captureLng.toFixed(5)}` : 'Captured: —'}
          </div>
        </div>
      </div>
    </div>
  );
}
