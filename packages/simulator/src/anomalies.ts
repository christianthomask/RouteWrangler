import { registerMax } from '@routewrangler/contracts';

/**
 * Anomaly injection matrix (BUILD_SPEC §7.6). Each kind is a deterministic
 * single-read transform (except `zero`/`duplicate`, which also need context
 * from the meter's recent history / a completed stop — supplied by the caller).
 * AC: every validation rule has at least one seeded scenario that trips it.
 */
export type AnomalyKind =
  | 'clean'
  | 'high'
  | 'low'
  | 'leak'
  | 'negative'
  | 'rollover_in_band'
  | 'rollover_oob'
  | 'zero'
  | 'location_absent';

export interface AnomalyCtx {
  prevValue: number;
  /** Nominal monthly usage the seed built history around. */
  baseline: number;
  registerDials: number;
  baseLat: number;
  baseLng: number;
  prng: () => number;
}

export interface AnomalyRead {
  value: number;
  lat: number | null;
  lng: number | null;
}

/** The expected exception each kind should trip (null = passes/annotates). */
export const EXPECTED_EXCEPTION: Record<AnomalyKind, string | null> = {
  clean: null,
  high: 'high_read',
  low: 'low_read',
  leak: 'leak_spike',
  negative: 'negative_consumption',
  rollover_in_band: null,
  rollover_oob: 'rollover_out_of_band',
  zero: 'zero_consumption_streak',
  location_absent: 'location_absent',
};

export function applyAnomaly(kind: AnomalyKind, ctx: AnomalyCtx): AnomalyRead {
  const { prevValue, baseline, registerDials, prng } = ctx;
  const max = registerMax(registerDials);
  const wrap = (v: number) => ((Math.round(v) % (max + 1)) + (max + 1)) % (max + 1);
  const gps = { lat: ctx.baseLat + (prng() - 0.5) * 0.0004, lng: ctx.baseLng + (prng() - 0.5) * 0.0004 };

  switch (kind) {
    case 'clean':
      return { value: wrap(prevValue + baseline * (0.9 + prng() * 0.2)), ...gps };
    case 'high':
      return { value: wrap(prevValue + baseline * 3), ...gps };
    case 'low':
      return { value: wrap(prevValue + baseline * 0.15), ...gps };
    case 'leak':
      return { value: wrap(prevValue + baseline * 8), ...gps };
    case 'negative':
      // A big drop with the meter mid-register → not a plausible wrap.
      return { value: Math.max(0, Math.round(prevValue - baseline * 15)), ...gps };
    case 'rollover_in_band':
      // Meter near the top of the register wraps with ~normal usage.
      return { value: wrap(prevValue + baseline), ...gps };
    case 'rollover_oob':
      // Wraps, but the implied usage is well out of band.
      return { value: wrap(prevValue + baseline * 4), ...gps };
    case 'zero':
      // No usage this cycle (caller seeds prior zeros to form the streak).
      return { value: prevValue, ...gps };
    case 'location_absent':
      return { value: wrap(prevValue + baseline * (0.9 + prng() * 0.2)), lat: null, lng: null };
  }
}

/**
 * The demo plan (BUILD_SPEC §7.6 demo seed, §10). Stop sequence i gets plan[i].
 * The seed sets up each stop's meter to match (near-max register for rollover
 * kinds; prior zeros for the zero kind) so playback trips every rule
 * deterministically. `duplicate_mismatch` is exercised separately by playback
 * re-reading a completed stop.
 */
export const DEMO_ANOMALY_PLAN: AnomalyKind[] = [
  'high',
  'low',
  'leak',
  'negative',
  'rollover_in_band',
  'rollover_oob',
  'zero',
  'location_absent',
  'clean',
  'clean',
];

export const DEMO_NOMINAL_USAGE = 100;
