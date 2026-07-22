import { describe, it, expect } from 'vitest';
import { DEFAULT_VALIDATION_CONFIG } from '@routewrangler/contracts';
import { applyAnomaly, mulberry32, type AnomalyKind } from '@routewrangler/simulator';
import { runValidation } from '@routewrangler/contracts';
import type { PriorRead } from '@routewrangler/contracts';

/**
 * The BUILD_SPEC §7.6 / §10 acceptance: every validation rule has a seeded
 * scenario that trips it, reproducible from seed. This checks the simulator's
 * anomaly matrix directly against the validation engine — the same generation
 * code the seed and playback use — so the guarantee holds without a database.
 */
const BASELINE = 100;

function steady(prevValue: number, tailZeros = 0): PriorRead[] {
  const h: PriorRead[] = [
    { value: 1000, consumption: BASELINE },
    { value: 1100, consumption: BASELINE },
    { value: 1200, consumption: BASELINE },
  ];
  if (tailZeros > 0) {
    for (let i = 0; i < tailZeros; i++) h.push({ value: prevValue, consumption: 0 });
  } else {
    h.push({ value: prevValue, consumption: BASELINE });
  }
  return h;
}

interface Case {
  kind: AnomalyKind;
  dials: number;
  prevValue: number;
  tailZeros?: number;
  expect: string | null;
}

const CASES: Case[] = [
  { kind: 'high', dials: 5, prevValue: 5000, expect: 'high_read' },
  { kind: 'low', dials: 5, prevValue: 5000, expect: 'low_read' },
  { kind: 'leak', dials: 5, prevValue: 5000, expect: 'leak_spike' },
  { kind: 'negative', dials: 5, prevValue: 5000, expect: 'negative_consumption' },
  { kind: 'rollover_in_band', dials: 4, prevValue: 9949, expect: null },
  { kind: 'rollover_oob', dials: 4, prevValue: 9949, expect: 'rollover_out_of_band' },
  { kind: 'zero', dials: 5, prevValue: 1200, tailZeros: 2, expect: 'zero_consumption_streak' },
  { kind: 'location_absent', dials: 5, prevValue: 5000, expect: 'location_absent' },
  { kind: 'clean', dials: 5, prevValue: 5000, expect: null },
];

describe('simulator anomaly matrix trips every validation rule', () => {
  it.each(CASES)('$kind → $expect', ({ kind, dials, prevValue, tailZeros, expect: code }) => {
    const read = applyAnomaly(kind, {
      prevValue,
      baseline: BASELINE,
      registerDials: dials,
      baseLat: 37,
      baseLng: -122,
      prng: mulberry32(1),
    });
    const result = runValidation({
      value: read.value,
      lat: read.lat,
      lng: read.lng,
      registerDials: dials,
      history: steady(prevValue, tailZeros ?? 0),
      config: DEFAULT_VALIDATION_CONFIG,
    });
    if (code === null) {
      expect(result.exceptions).toEqual([]);
    } else {
      expect(result.exceptions).toContain(code);
    }
  });

  it('rollover_in_band annotates and stays billable', () => {
    const read = applyAnomaly('rollover_in_band', {
      prevValue: 9949,
      baseline: BASELINE,
      registerDials: 4,
      baseLat: 37,
      baseLng: -122,
      prng: mulberry32(1),
    });
    const result = runValidation({
      value: read.value,
      lat: read.lat,
      lng: read.lng,
      registerDials: 4,
      history: steady(9949),
      config: DEFAULT_VALIDATION_CONFIG,
    });
    expect(result.annotations).toMatchObject({ rollover: true });
    expect(result.billable).toBe(true);
  });
});
