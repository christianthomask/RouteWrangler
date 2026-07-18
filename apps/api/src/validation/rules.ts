import { registerMax } from '@routewrangler/contracts';
import type { Derived, RuleModule } from './types';

/**
 * One module per exception type (BUILD_SPEC §7.1, ADR-003), registered with
 * metadata. Consumption rules are mutually exclusive — the engine takes the
 * first that fires in priority order — so their conditions are written to be
 * disjoint. Independent rules stack.
 */

const leakSpike: RuleModule = {
  code: 'leak_spike',
  category: 'consumption',
  priority: 10,
  evaluate(d: Derived) {
    if (!d.isIncrease || !d.hasBaseline || d.baseline === null || d.rawDelta === null) return null;
    return d.rawDelta >= d.baseline * d.input.config.leakSpikeMultiplier
      ? { code: 'leak_spike' }
      : null;
  },
};

const highRead: RuleModule = {
  code: 'high_read',
  category: 'consumption',
  priority: 20,
  evaluate(d: Derived) {
    if (!d.isIncrease || !d.hasBaseline || d.baseline === null || d.rawDelta === null) return null;
    const { highReadMultiplier, leakSpikeMultiplier } = d.input.config;
    return d.rawDelta >= d.baseline * highReadMultiplier &&
      d.rawDelta < d.baseline * leakSpikeMultiplier
      ? { code: 'high_read' }
      : null;
  },
};

const lowRead: RuleModule = {
  code: 'low_read',
  category: 'consumption',
  priority: 30,
  evaluate(d: Derived) {
    if (!d.isIncrease || !d.hasBaseline || d.baseline === null || d.rawDelta === null) return null;
    return d.rawDelta > 0 && d.rawDelta <= d.baseline * d.input.config.lowReadMultiplier
      ? { code: 'low_read' }
      : null;
  },
};

/**
 * Rollover (register-max math). In-band → auto-validate with a visible
 * annotation, no exception (billable). Out-of-band but wrap-like (previous read
 * near the top of the register) → rollover_out_of_band. Otherwise decline so
 * negative_consumption claims it (ADR-011).
 */
const rollover: RuleModule = {
  code: 'rollover_out_of_band',
  category: 'consumption',
  priority: 40,
  evaluate(d: Derived) {
    if (!d.isDecrease || d.rolloverConsumption === null || d.priorValue === null) return null;
    const { config } = d.input;
    const inBand =
      d.rolloverConsumption >= 0 &&
      (d.baseline === null || d.rolloverConsumption <= d.baseline * config.rolloverBandMultiplier);
    if (inBand) return { code: null, annotations: { rollover: true } };

    const max = registerMax(d.input.registerDials);
    const looksLikeWrap = d.priorValue >= max * config.rolloverProximity;
    return looksLikeWrap ? { code: 'rollover_out_of_band', annotations: { rollover: true } } : null;
  },
};

const negativeConsumption: RuleModule = {
  code: 'negative_consumption',
  category: 'consumption',
  priority: 50,
  evaluate(d: Derived) {
    return d.isDecrease ? { code: 'negative_consumption' } : null;
  },
};

const zeroStreak: RuleModule = {
  code: 'zero_consumption_streak',
  category: 'consumption',
  priority: 60,
  evaluate(d: Derived) {
    if (!d.isZero) return null;
    const n = d.input.config.zeroStreakCycles;
    const tail = d.recentConsumptions.slice(-n);
    return tail.length >= n && tail.every((c) => c === 0)
      ? { code: 'zero_consumption_streak' }
      : null;
  },
};

const locationAbsent: RuleModule = {
  code: 'location_absent',
  category: 'independent',
  priority: 100,
  evaluate(d: Derived) {
    return d.input.lat === null || d.input.lng === null ? { code: 'location_absent' } : null;
  },
};

const duplicateMismatch: RuleModule = {
  code: 'duplicate_mismatch',
  category: 'independent',
  priority: 110,
  evaluate(d: Derived) {
    const dup = d.input.duplicate;
    if (!dup) return null;
    return Math.abs(d.input.value - dup.completedValue) > d.input.config.duplicateTolerance
      ? { code: 'duplicate_mismatch' }
      : null;
  },
};

/** The rule registry. Adding a type = a new module here (+ a taxonomy row). */
export const RULES: RuleModule[] = [
  leakSpike,
  highRead,
  lowRead,
  rollover,
  negativeConsumption,
  zeroStreak,
  locationAbsent,
  duplicateMismatch,
];

export const CONSUMPTION_RULES = RULES.filter((r) => r.category === 'consumption').sort(
  (a, b) => a.priority - b.priority,
);
export const INDEPENDENT_RULES = RULES.filter((r) => r.category === 'independent').sort(
  (a, b) => a.priority - b.priority,
);
