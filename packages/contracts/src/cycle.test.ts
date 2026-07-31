import { describe, expect, it } from 'vitest';
import { CycleIdSchema, cycleIdForDate } from './cycle';

describe('CycleIdSchema', () => {
  it('accepts a calendar month', () => {
    expect(CycleIdSchema.safeParse('2026-07').success).toBe(true);
    expect(CycleIdSchema.safeParse('2026-01').success).toBe(true);
    expect(CycleIdSchema.safeParse('2026-12').success).toBe(true);
  });

  it('rejects the shapes that used to open a parallel cycle silently', () => {
    // Each of these would have keyed the export index (ADR-023) as a distinct
    // cycle that no other query in the system would ever match.
    for (const bad of ['2026-7', '2026-13', '2026-00', 'July', '2026', '2026-07-01', '']) {
      expect(CycleIdSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('cycleIdForDate', () => {
  it('takes the calendar month of the date it is given', () => {
    expect(cycleIdForDate('2026-07-30')).toBe('2026-07');
    expect(cycleIdForDate('2026-01-01')).toBe('2026-01');
  });

  it('is the same on the last day of a month as on the first', () => {
    // The bug this replaced read getUTCMonth() off `new Date()`: at 17:00 on
    // 2026-07-31 Pacific it is already 2026-08 in UTC, so work done in July was
    // filed against August while its run date still said July.
    expect(cycleIdForDate('2026-07-31')).toBe('2026-07');
    expect(cycleIdForDate('2026-08-01')).toBe('2026-08');
  });
});
