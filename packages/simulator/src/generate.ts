import { registerMax } from '@routewrangler/contracts';

/**
 * Deterministic generation (BUILD_SPEC §5 determinism). All randomness flows
 * through a seeded PRNG so one seed reproduces the exact world every run. No
 * Date.now()/Math.random() in the value path.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monthly consumption multipliers for Central Coast water — a summer irrigation
 * bump (index 0 = January). Scale numbers are config; this shape is the seasonal
 * curve (BUILD_SPEC §7.6).
 */
export const SEASONAL_MULTIPLIERS = [
  0.85, 0.85, 0.9, 1.0, 1.15, 1.4, 1.7, 1.75, 1.5, 1.2, 0.95, 0.85,
];

export function seasonalMultiplier(monthIndex: number): number {
  return SEASONAL_MULTIPLIERS[((monthIndex % 12) + 12) % 12]!;
}

export interface MeterSimConfig {
  seed: number;
  baseMonthlyUsage: number;
  registerDials: number;
  startValue: number;
}

export interface GeneratedRead {
  /** ISO timestamp (business truth). */
  capturedAt: string;
  value: number;
  consumption: number;
}

/**
 * A 12-month (configurable) seasonal history ending just before `endDate`.
 * Values accumulate and wrap at the register max. Used by the seed to backfill
 * baselines. `monthOffset` timestamps are derived from `endDate` (passed in — no
 * ambient clock) so the series is deterministic given the seed and end date.
 */
export function generateHistory(
  cfg: MeterSimConfig,
  months: number,
  endDate: Date,
): GeneratedRead[] {
  const prng = mulberry32(cfg.seed);
  const max = registerMax(cfg.registerDials);
  const reads: GeneratedRead[] = [];
  let value = cfg.startValue;

  for (let i = months; i >= 1; i--) {
    const d = new Date(endDate);
    d.setMonth(d.getMonth() - i);
    const jitter = 0.85 + prng() * 0.3; // 0.85..1.15
    const consumption = Math.max(
      0,
      Math.round(cfg.baseMonthlyUsage * seasonalMultiplier(d.getMonth()) * jitter),
    );
    value = (value + consumption) % (max + 1);
    reads.push({ capturedAt: d.toISOString(), value, consumption });
  }
  return reads;
}
