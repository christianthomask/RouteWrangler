import { describe, it, expect } from 'vitest';
import { DEFAULT_VALIDATION_CONFIG, type ValidationConfig } from '../validation';
import { runValidation } from './engine';
import type { PriorRead, ValidationInput } from './types';

const cfg: ValidationConfig = DEFAULT_VALIDATION_CONFIG;

/** The instant every fixture read is dated relative to. */
const NOW = '2026-07-30T12:00:00.000Z';

/** `NOW` minus n months, as an ISO timestamp. */
function monthsAgo(n: number): string {
  const d = new Date(NOW);
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

/** A prior read without its date — the shape the scenarios below care about. */
type Undated = Omit<PriorRead, 'capturedAt'>;

/**
 * Stamps an oldest-first list with one read per month, the newest a month before
 * `NOW`. Every scenario below is about consumption shapes rather than dates, so
 * they stay comfortably inside the baseline window; the window itself is
 * exercised on purpose in its own describe block.
 */
function dated(reads: Undated[]): PriorRead[] {
  return reads.map((r, i) => ({ ...r, capturedAt: monthsAgo(reads.length - i) }));
}

/** Steady history: `count` reads each consuming `step`, so baseline = step. */
function steadyHistory(count = 4, step = 100, start = 1000): Undated[] {
  const reads: Undated[] = [];
  let v = start;
  for (let i = 0; i < count; i++) {
    v += step;
    reads.push({ value: v, consumption: step });
  }
  return reads;
}

function input(
  partial: Partial<Omit<ValidationInput, 'history'>> & { value: number; history?: Undated[] },
): ValidationInput {
  const { history, ...rest } = partial;
  return {
    lat: 37.0,
    lng: -122.0,
    registerDials: 5, // register max 99,999
    capturedAt: NOW,
    config: cfg,
    ...rest,
    history: dated(history ?? steadyHistory()),
  };
}

describe('validation engine — every rule has a scenario that trips it', () => {
  it('clean read → billable, no exceptions', () => {
    const last = steadyHistory();
    const r = runValidation(input({ value: last[last.length - 1]!.value + 100 }));
    expect(r.exceptions).toEqual([]);
    expect(r.billable).toBe(true);
    expect(r.effectiveConsumption).toBe(100);
  });

  it('high_read: consumption 3× baseline', () => {
    const last = steadyHistory();
    const r = runValidation(input({ value: last[last.length - 1]!.value + 300 }));
    expect(r.exceptions).toEqual(['high_read']);
    expect(r.billable).toBe(false);
  });

  it('leak_spike: consumption ≥ 5× baseline (beats high_read)', () => {
    const last = steadyHistory();
    const r = runValidation(input({ value: last[last.length - 1]!.value + 600 }));
    expect(r.exceptions).toEqual(['leak_spike']);
    expect(r.billable).toBe(false);
  });

  it('low_read: 0 < consumption ≤ 0.3× baseline', () => {
    const last = steadyHistory();
    const r = runValidation(input({ value: last[last.length - 1]!.value + 20 }));
    expect(r.exceptions).toEqual(['low_read']);
  });

  it('negative_consumption: a decrease that is not a plausible wrap', () => {
    // prior 5000 (mid-register), value 4000 → wrap-implied ≈ 99,000 (out of band)
    // and prior is nowhere near the top of the register → not a rollover.
    const r = runValidation(
      input({ value: 4000, history: [...steadyHistory(3), { value: 5000, consumption: 100 }] }),
    );
    expect(r.exceptions).toEqual(['negative_consumption']);
    expect(r.billable).toBe(false);
  });

  it('rollover in-band: register wrapped near the top → annotated, billable, NO exception', () => {
    const r = runValidation(
      input({ value: 50, history: [...steadyHistory(3), { value: 99950, consumption: 100 }] }),
    );
    expect(r.exceptions).toEqual([]);
    expect(r.annotations).toMatchObject({ rollover: true });
    expect(r.billable).toBe(true);
    expect(r.effectiveConsumption).toBe(100); // (99999+1-99950)+50
  });

  it('rollover_out_of_band: looks like a wrap but implied usage is too high', () => {
    const r = runValidation(
      input({ value: 9000, history: [...steadyHistory(3), { value: 99950, consumption: 100 }] }),
    );
    expect(r.exceptions).toEqual(['rollover_out_of_band']);
    expect(r.billable).toBe(false);
  });

  it('zero_consumption_streak: N consecutive zero-consumption cycles', () => {
    const history: Undated[] = [
      { value: 2000, consumption: 100 },
      { value: 2100, consumption: 100 },
      { value: 2100, consumption: 0 },
      { value: 2100, consumption: 0 },
    ];
    const r = runValidation(input({ value: 2100, history })); // current delta 0 → 3rd zero
    expect(r.exceptions).toEqual(['zero_consumption_streak']);
  });

  it('zero_consumption_streak: a null gap breaks the streak → no exception', () => {
    // Same shape as the streak above, but the middle cycle has no computable
    // consumption (a gap in the history). Collapsing that gap would splice one
    // zero either side of it into an unbroken run of three; a meter with no
    // reading is not a meter reading zero, so the streak must NOT fire.
    const history: Undated[] = [
      { value: 2000, consumption: 100 },
      { value: 2100, consumption: 0 },
      { value: 2100, consumption: null },
      { value: 2100, consumption: 0 },
    ];
    const r = runValidation(input({ value: 2100, history })); // current delta 0
    expect(r.exceptions).toEqual([]);
    expect(r.billable).toBe(true);
  });

  it('zero_consumption_streak: a gap older than the window does not suppress a real streak', () => {
    // The gap sits outside the trailing N cycles, so the three most recent
    // cycles are still genuinely consecutive zeros and the rule fires.
    const history: Undated[] = [
      { value: 2000, consumption: null },
      { value: 2100, consumption: 100 },
      { value: 2100, consumption: 0 },
      { value: 2100, consumption: 0 },
    ];
    const r = runValidation(input({ value: 2100, history }));
    expect(r.exceptions).toEqual(['zero_consumption_streak']);
  });

  it('a single zero is not yet a streak → billable, no exception', () => {
    const history: Undated[] = [...steadyHistory(3), { value: 2100, consumption: 100 }];
    const r = runValidation(input({ value: 2100, history }));
    expect(r.exceptions).toEqual([]);
    expect(r.billable).toBe(true);
  });

  it('location_absent: missing GPS → low-severity exception that does NOT block billing', () => {
    const last = steadyHistory();
    const r = runValidation(input({ value: last[last.length - 1]!.value + 100, lat: null, lng: null }));
    expect(r.exceptions).toEqual(['location_absent']);
    expect(r.billable).toBe(true); // non-blocking
  });

  it('duplicate_mismatch: re-read of a completed stop disagrees beyond tolerance', () => {
    const last = steadyHistory();
    const r = runValidation(
      input({
        value: last[last.length - 1]!.value + 100,
        duplicate: { completedValue: last[last.length - 1]!.value + 100 + 50 },
      }),
    );
    expect(r.exceptions).toContain('duplicate_mismatch');
    expect(r.billable).toBe(true); // non-blocking
  });

  it('stacks a consumption exception with location_absent', () => {
    const last = steadyHistory();
    const r = runValidation(
      input({ value: last[last.length - 1]!.value + 300, lat: null, lng: null }),
    );
    expect(r.exceptions).toEqual(['high_read', 'location_absent']);
    expect(r.billable).toBe(false); // high_read blocks
  });

  it('no baseline: hi/lo/leak cannot judge, clean read passes', () => {
    const r = runValidation(input({ value: 1100, history: [{ value: 1000, consumption: null }] }));
    expect(r.exceptions).toEqual([]);
    expect(r.billable).toBe(true);
  });
});

/**
 * `config.baselineMonths` was declared and never enforced: `derive` averaged
 * whatever it was handed. The server bounded its query and the field app did
 * not, so the same read could be judged against two different bands.
 */
describe('validation engine — the baseline window is enforced, not assumed', () => {
  /** Explicitly dated history, newest last, in months before NOW. */
  function at(monthsBack: number, value: number, consumption: number | null): PriorRead {
    return { value, consumption, capturedAt: monthsAgo(monthsBack) };
  }

  const withHistory = (history: PriorRead[], value: number): ValidationInput => ({
    value,
    lat: 37,
    lng: -122,
    registerDials: 5,
    capturedAt: NOW,
    history,
    config: cfg,
  });

  it('ignores reads older than baselineMonths when averaging', () => {
    // Twelve months of 100s, preceded by three ancient 1000s. Averaging the lot
    // would put the baseline near 280 and make a normal 100 look like a low_read.
    const history = [
      at(30, 500, 1000),
      at(29, 1500, 1000),
      at(28, 2500, 1000),
      ...Array.from({ length: 6 }, (_, i) => at(6 - i, 3000 + i * 100, 100)),
    ];
    const r = runValidation(withHistory(history, 3600));
    expect(r.exceptions).toEqual([]);
    expect(r.billable).toBe(true);
  });

  it('a read exactly at the window edge still counts', () => {
    const history = [
      at(cfg.baselineMonths, 1000, 100),
      at(2, 1100, 100),
      at(1, 1200, 100),
    ];
    // Three in-window positives clears minBaselineReads, so hi/lo can judge —
    // and this read is 4× the baseline.
    const r = runValidation(withHistory(history, 1600));
    expect(r.exceptions).toEqual(['high_read']);
  });

  it('drops out of the window and hi/lo stops judging at all', () => {
    // Same three reads, all pushed just past the edge. Nothing is left to form a
    // baseline, so the engine declines to call it high rather than guessing.
    const history = [
      at(cfg.baselineMonths + 3, 1000, 100),
      at(cfg.baselineMonths + 2, 1100, 100),
      at(cfg.baselineMonths + 1, 1200, 100),
    ];
    const r = runValidation(withHistory(history, 1600));
    expect(r.exceptions).toEqual([]);
    expect(r.effectiveConsumption).toBeNull();
  });

  it('excludes a prior read whose timestamp will not parse', () => {
    // It cannot be shown to be inside the window, so it is not treated as if it
    // were. With it dropped there is no prior value at all.
    const history: PriorRead[] = [{ value: 1000, consumption: 100, capturedAt: 'not a date' }];
    const r = runValidation(withHistory(history, 1100));
    expect(r.effectiveConsumption).toBeNull();
  });

  it('refuses to run at all on an unparseable capture time', () => {
    // Silently falling back would mean validating against an unbounded history —
    // exactly the bug this window exists to close.
    expect(() =>
      runValidation({ ...withHistory(dated(steadyHistory()), 1500), capturedAt: 'nonsense' }),
    ).toThrow(/capturedAt/);
  });
});
