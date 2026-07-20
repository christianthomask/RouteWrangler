'use client';

import type { ConsumptionPoint } from '@routewrangler/contracts';
import { SEVERITY_VAR, type SeverityCode } from '@/design/tokens';

/**
 * The meter's trailing consumption, one series (dataviz: single series → the
 * title names it, no legend; thin 2px line; recessive axes; the flagged read is
 * direct-labeled in its severity color). The shaded band is the expected range
 * (≈0.3×–2× the meter's own baseline) so a flagged read reads as out-of-band.
 */
export function ConsumptionChart({
  points,
  flaggedSeverity,
}: {
  points: ConsumptionPoint[];
  flaggedSeverity: SeverityCode;
}) {
  const data = points.filter((p) => p.consumption != null) as (ConsumptionPoint & { consumption: number })[];
  if (data.length < 2) {
    return (
      <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', padding: 'var(--rw-space-4)' }}>
        Not enough history to chart consumption yet.
      </div>
    );
  }

  const W = 760;
  const H = 240;
  const P = { l: 46, r: 16, t: 16, b: 28 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;

  const positives = data.filter((d) => !d.flagged && d.consumption > 0).map((d) => d.consumption).sort((a, b) => a - b);
  const baseline = positives.length ? positives[Math.floor(positives.length / 2)]! : 0;
  const bandLo = baseline * 0.3;
  const bandHi = baseline * 2;

  const yMax = Math.max(...data.map((d) => d.consumption), bandHi) * 1.1 || 1;
  const x = (i: number) => P.l + (iw * i) / (data.length - 1);
  const y = (v: number) => P.t + ih - (ih * v) / yMax;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.consumption).toFixed(1)}`).join(' ');
  const ticks = [0, baseline, yMax].filter((v, i, a) => a.indexOf(v) === i);
  const labelIdx = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Consumption history" style={{ display: 'block' }}>
      {/* expected band */}
      {baseline > 0 && (
        <rect x={P.l} y={y(bandHi)} width={iw} height={Math.max(0, y(bandLo) - y(bandHi))} fill="var(--rw-success)" opacity={0.08} />
      )}
      {/* gridlines + y labels */}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={P.l} y1={y(v)} x2={W - P.r} y2={y(v)} stroke="var(--rw-border)" strokeWidth={1} />
          <text x={P.l - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--rw-text-muted)">
            {Math.round(v).toLocaleString()}
          </text>
        </g>
      ))}
      {/* consumption line */}
      <path d={linePath} fill="none" stroke="var(--rw-brand)" strokeWidth={2} strokeLinejoin="round" />
      {/* points */}
      {data.map((d, i) =>
        d.flagged ? (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.consumption)} r={5} fill={SEVERITY_VAR[flaggedSeverity]} stroke="var(--rw-surface)" strokeWidth={2} />
            <text x={x(i)} y={y(d.consumption) - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill={SEVERITY_VAR[flaggedSeverity]}>
              {Math.round(d.consumption).toLocaleString()}
            </text>
          </g>
        ) : (
          <circle key={i} cx={x(i)} cy={y(d.consumption)} r={2.5} fill="var(--rw-brand)" />
        ),
      )}
      {/* x labels */}
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize={10} fill="var(--rw-text-muted)">
          {new Date(data[i]!.capturedAt).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
        </text>
      ))}
    </svg>
  );
}
