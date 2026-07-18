import { registerMax } from '@routewrangler/contracts';
import type { Derived, ValidationInput } from './types';

/**
 * Computes the shared derived context from a read and its history. Baseline is
 * the mean of prior *positive* consumptions over the window (ADR-010); zeros and
 * nulls are excluded so a normal meter's band isn't dragged down by gaps. The
 * effective consumption for the current read is resolved here too: an in-band
 * rollover reports true wrap usage, everything else reports the signed delta.
 */
export function derive(input: ValidationInput): Derived {
  const { value, history, registerDials, config } = input;

  const priorValue = history.length > 0 ? history[history.length - 1]!.value : null;
  const rawDelta = priorValue === null ? null : value - priorValue;

  const isIncrease = rawDelta !== null && rawDelta > 0;
  const isZero = rawDelta !== null && rawDelta === 0;
  const isDecrease = rawDelta !== null && rawDelta < 0;

  const max = registerMax(registerDials);
  const rolloverConsumption = isDecrease && priorValue !== null ? max + 1 - priorValue + value : null;

  const priorPositives = history
    .map((h) => h.consumption)
    .filter((c): c is number => c !== null && c > 0);
  const hasBaseline = priorPositives.length >= config.minBaselineReads;
  const baseline = hasBaseline
    ? priorPositives.reduce((a, b) => a + b, 0) / priorPositives.length
    : null;

  // Effective consumption for streak history: rollover in-band uses wrap usage.
  const rolloverInBand =
    isDecrease &&
    rolloverConsumption !== null &&
    rolloverConsumption >= 0 &&
    (baseline === null || rolloverConsumption <= baseline * config.rolloverBandMultiplier);
  const effective = rolloverInBand ? rolloverConsumption! : (rawDelta ?? 0);

  const recentConsumptions = [
    ...history.map((h) => h.consumption).filter((c): c is number => c !== null),
    effective,
  ];

  return {
    input,
    priorValue,
    rawDelta,
    isIncrease,
    isZero,
    isDecrease,
    rolloverConsumption,
    baseline,
    hasBaseline,
    recentConsumptions,
  };
}

/** The consumption value stored on the read (see derive). */
export function effectiveConsumption(d: Derived): number | null {
  if (d.rawDelta === null) return null;
  const { config } = d.input;
  const inBand =
    d.isDecrease &&
    d.rolloverConsumption !== null &&
    d.rolloverConsumption >= 0 &&
    (d.baseline === null || d.rolloverConsumption <= d.baseline * config.rolloverBandMultiplier);
  return inBand ? d.rolloverConsumption! : d.rawDelta;
}
