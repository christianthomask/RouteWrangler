import { describe, it, expect } from 'vitest';
import { generateHistory, mulberry32, seasonalMultiplier, type MeterSimConfig } from './generate';
import { applyAnomaly, EXPECTED_EXCEPTION } from './anomalies';

describe('deterministic generation', () => {
  it('mulberry32 is reproducible for a given seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('seasonal curve peaks in summer', () => {
    expect(seasonalMultiplier(7)).toBeGreaterThan(seasonalMultiplier(0)); // Aug > Jan
    expect(seasonalMultiplier(7)).toBe(seasonalMultiplier(19)); // wraps
  });

  it('generateHistory is deterministic and wraps at the register max', () => {
    const cfg: MeterSimConfig = { seed: 7, baseMonthlyUsage: 100, registerDials: 4, startValue: 9900 };
    const end = new Date('2026-01-01T00:00:00.000Z');
    const h1 = generateHistory(cfg, 12, end);
    const h2 = generateHistory(cfg, 12, end);
    expect(h1).toEqual(h2);
    expect(h1).toHaveLength(12);
    expect(h1.every((r) => r.value >= 0 && r.value <= 9999)).toBe(true);
  });
});

describe('anomaly matrix covers every kind', () => {
  it('every kind has an expected-exception mapping', () => {
    for (const kind of Object.keys(EXPECTED_EXCEPTION)) {
      expect(EXPECTED_EXCEPTION).toHaveProperty(kind);
    }
  });

  it('applyAnomaly is deterministic given a seeded prng', () => {
    const ctx = () => ({
      prevValue: 5000,
      baseline: 100,
      registerDials: 5,
      baseLat: 37,
      baseLng: -122,
      prng: mulberry32(1),
    });
    expect(applyAnomaly('high', ctx())).toEqual(applyAnomaly('high', ctx()));
  });
});
