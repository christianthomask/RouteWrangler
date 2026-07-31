import { registerMax } from '../validation';
import type { Derived, PriorRead, ValidationInput } from './types';

/**
 * The instant `config.baselineMonths` before a read was captured. Mirrors what
 * ingestion's history query does, so the engine and the SQL agree on where the
 * window starts instead of each having its own idea of it.
 */
function windowStart(capturedAt: string, months: number): number {
  const at = new Date(capturedAt);
  if (Number.isNaN(at.getTime())) {
    // The caller controls this value and the whole window is measured from it;
    // guessing would mean silently validating against an unbounded history.
    throw new Error(`ValidationInput.capturedAt is not a valid timestamp: ${capturedAt}`);
  }
  at.setMonth(at.getMonth() - months);
  return at.getTime();
}

/**
 * The prior reads that actually count toward this read's baseline.
 *
 * `config.baselineMonths` used to be declared and never enforced: `derive`
 * averaged whatever history it was handed and honouring the window was left to
 * each caller. The server bounded its query; the field app did not — so the same
 * read could be judged against a different band depending on which side of the
 * wire evaluated it, and those two are supposed to agree (ADR-020). The rule now
 * lives with the code that depends on it.
 *
 * A prior read whose timestamp will not parse is excluded rather than assumed
 * recent: it cannot be shown to be inside the window.
 */
function withinWindow(input: ValidationInput): PriorRead[] {
  const start = windowStart(input.capturedAt, input.config.baselineMonths);
  return input.history.filter((h) => {
    const t = new Date(h.capturedAt).getTime();
    return !Number.isNaN(t) && t >= start;
  });
}

/**
 * Computes the shared derived context from a read and its history. Baseline is
 * the mean of prior *positive* consumptions over the window (ADR-010); zeros and
 * nulls are excluded so a normal meter's band isn't dragged down by gaps. The
 * effective consumption for the current read is resolved here too: an in-band
 * rollover reports true wrap usage, everything else reports the signed delta.
 */
export function derive(input: ValidationInput): Derived {
  const { value, registerDials, config } = input;
  const history = withinWindow(input);

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

  // Nulls are PRESERVED here (unlike the baseline above, which excludes them):
  // this is a positional series, not a sample. Filtering gaps out would close
  // the hole and splice two separate zero runs into one apparently unbroken
  // streak — a meter with no reading is not a meter reading zero. Rules that
  // walk this series must treat a null as a break.
  const recentConsumptions: (number | null)[] = [
    ...history.map((h) => h.consumption),
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
