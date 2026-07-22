import { describe, it, expect } from 'vitest';
import { DEFAULT_VALIDATION_CONFIG, type ValidationConfig } from '../validation';
import { runValidation } from './engine';
import type { PriorRead, ValidationInput } from './types';

const cfg: ValidationConfig = DEFAULT_VALIDATION_CONFIG;

/** Steady history: `count` reads each consuming `step`, so baseline = step. */
function steadyHistory(count = 4, step = 100, start = 1000): PriorRead[] {
  const reads: PriorRead[] = [];
  let v = start;
  for (let i = 0; i < count; i++) {
    v += step;
    reads.push({ value: v, consumption: step });
  }
  return reads;
}

function input(partial: Partial<ValidationInput> & { value: number }): ValidationInput {
  return {
    lat: 37.0,
    lng: -122.0,
    registerDials: 5, // register max 99,999
    history: steadyHistory(),
    config: cfg,
    ...partial,
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
    const history: PriorRead[] = [
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
    const history: PriorRead[] = [
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
    const history: PriorRead[] = [
      { value: 2000, consumption: null },
      { value: 2100, consumption: 100 },
      { value: 2100, consumption: 0 },
      { value: 2100, consumption: 0 },
    ];
    const r = runValidation(input({ value: 2100, history }));
    expect(r.exceptions).toEqual(['zero_consumption_streak']);
  });

  it('a single zero is not yet a streak → billable, no exception', () => {
    const history: PriorRead[] = [...steadyHistory(3), { value: 2100, consumption: 100 }];
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
