import { describe, expect, it } from 'vitest';
import { isValidTimeZone, todayIn } from './clock';

describe('todayIn', () => {
  it('returns the local calendar date, not the UTC one, after the UTC rollover', () => {
    // 2026-07-22T00:07Z is still 2026-07-21 at 17:07 in Los Angeles. Deriving
    // "today" from toISOString() returned 2026-07-22 here, which dropped every
    // in-flight run out of "today" and reported it as overdue — every evening,
    // for the ~7 hours between 5pm Pacific and midnight UTC.
    const instant = new Date('2026-07-22T00:07:00Z');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-07-21');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-07-22');
  });

  it('formats as YYYY-MM-DD, matching the stored run_date', () => {
    expect(todayIn('America/Los_Angeles', new Date('2026-01-05T18:00:00Z'))).toBe('2026-01-05');
  });

  it('zero-pads single-digit months and days', () => {
    // en-CA without 2-digit options would yield "2026-1-5" and never match a row.
    expect(todayIn('UTC', new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });

  it('crosses the date line correctly for a zone ahead of UTC', () => {
    expect(todayIn('Pacific/Auckland', new Date('2026-07-21T13:00:00Z'))).toBe('2026-07-22');
  });
});

describe('isValidTimeZone', () => {
  it('accepts real IANA zones and rejects typos, so a bad env fails at boot', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Los Angeles')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
