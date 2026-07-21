import { describe, expect, it } from 'vitest';
import { classify, exportFilename, render, type StopRow, type StopException } from './export.core';

const base: StopRow = {
  meterId: '00000000-0000-0000-0000-000000000001',
  meterSerial: 'SLO-1-001',
  serviceAddress: '1 Main St',
  readValue: 1000,
  consumption: 42,
  readAt: '2026-07-18T10:00:00.000Z',
  skipReasonCode: null,
  exceptions: [],
};

const exc = (code: string, status: string, blocksBilling: boolean): StopException => ({
  code,
  status,
  blocksBilling,
});

describe('export classify (BUILD_SPEC §7.4)', () => {
  it('a clean read is billable', () => {
    const c = classify([base]);
    expect(c.counts).toEqual({ billable: 1, held: 0, missing: 0, skipped: 0 });
    expect(c.billable[0]!.meterSerial).toBe('SLO-1-001');
  });

  it('an unresolved blocking exception holds the read out', () => {
    const c = classify([{ ...base, exceptions: [exc('high_read', 'open', true)] }]);
    expect(c.counts).toEqual({ billable: 0, held: 1, missing: 0, skipped: 0 });
    expect(c.holds[0]!.reason).toBe('blocking_exception');
    expect(c.holds[0]!.exceptionCode).toBe('high_read');
  });

  it('a resolved/overridden blocking exception is billable again', () => {
    const resolved = classify([{ ...base, exceptions: [exc('high_read', 'resolved', true)] }]);
    const overridden = classify([{ ...base, exceptions: [exc('low_read', 'overridden', true)] }]);
    expect(resolved.counts.billable).toBe(1);
    expect(overridden.counts.billable).toBe(1);
  });

  it('a non-blocking exception does not hold the read', () => {
    const c = classify([{ ...base, exceptions: [exc('location_absent', 'open', false)] }]);
    expect(c.counts.billable).toBe(1);
  });

  it('a stop with no read is missing, not held', () => {
    const c = classify([{ ...base, readValue: null, readAt: null }]);
    expect(c.counts).toEqual({ billable: 0, held: 0, missing: 1, skipped: 0 });
    expect(c.holds[0]!.reason).toBe('not_read');
  });

  it('mixed cycle counts each bucket', () => {
    const c = classify([
      base,
      { ...base, meterSerial: 'SLO-1-002', exceptions: [exc('leak_spike', 'open', true)] },
      { ...base, meterSerial: 'SLO-1-003', readValue: null, readAt: null },
    ]);
    expect(c.counts).toEqual({ billable: 1, held: 1, missing: 1, skipped: 0 });
  });

  // M4 regression: a deliberate skip and an unworked stop are both unbillable,
  // but the client has to be able to tell them apart to know which meters still
  // need a visit.
  describe('a deliberate skip is distinct from an unworked stop (M4)', () => {
    const unread = { ...base, readValue: null, readAt: null };

    it('a skipped stop reports reason "skipped" and carries the skip code', () => {
      const c = classify([{ ...unread, skipReasonCode: 'locked_gate' }]);
      expect(c.counts).toEqual({ billable: 0, held: 0, missing: 0, skipped: 1 });
      expect(c.holds[0]!.reason).toBe('skipped');
      expect(c.holds[0]!.skipReasonCode).toBe('locked_gate');
    });

    it('an unworked stop stays "not_read" with no skip code', () => {
      const c = classify([unread]);
      expect(c.counts).toEqual({ billable: 0, held: 0, missing: 1, skipped: 0 });
      expect(c.holds[0]!.reason).toBe('not_read');
      expect(c.holds[0]!.skipReasonCode).toBeNull();
    });

    it('counts partition holds across all three reasons', () => {
      const c = classify([
        base,
        { ...base, meterSerial: 'A', exceptions: [exc('leak_spike', 'open', true)] },
        { ...unread, meterSerial: 'B' },
        { ...unread, meterSerial: 'C', skipReasonCode: 'dog_on_property' },
      ]);
      expect(c.counts).toEqual({ billable: 1, held: 1, missing: 1, skipped: 1 });
      expect(c.holds).toHaveLength(3);
    });

    it('a skip code never leaks onto a hold of another reason', () => {
      const c = classify([
        { ...base, skipReasonCode: 'locked_gate', exceptions: [exc('high_read', 'open', true)] },
      ]);
      // The read completed, so the stale skip code is irrelevant here.
      expect(c.holds[0]!.reason).toBe('blocking_exception');
      expect(c.holds[0]!.skipReasonCode).toBeNull();
    });
  });

  // C1 regression: a read with ≥2 exceptions must count ONCE, and any active
  // blocking exception holds it regardless of non-blocking siblings.
  describe('a read with multiple exceptions is one stop, not N (C1)', () => {
    it('blocking + non-blocking → held once, never billed', () => {
      const c = classify([
        {
          ...base,
          exceptions: [exc('high_read', 'open', true), exc('location_absent', 'open', false)],
        },
      ]);
      expect(c.counts).toEqual({ billable: 0, held: 1, missing: 0, skipped: 0 });
      expect(c.billable).toHaveLength(0);
      expect(c.holds).toHaveLength(1);
      expect(c.holds[0]!.exceptionCode).toBe('high_read');
    });

    it('two non-blocking exceptions → billable exactly once (no double line)', () => {
      const c = classify([
        {
          ...base,
          exceptions: [
            exc('location_absent', 'open', false),
            exc('duplicate_mismatch', 'open', false),
          ],
        },
      ]);
      expect(c.counts).toEqual({ billable: 1, held: 0, missing: 0, skipped: 0 });
      expect(c.billable).toHaveLength(1);
    });

    it('cleared blocking + still-open blocking → stays held', () => {
      const c = classify([
        {
          ...base,
          exceptions: [exc('high_read', 'resolved', true), exc('leak_spike', 'open', true)],
        },
      ]);
      expect(c.counts).toEqual({ billable: 0, held: 1, missing: 0, skipped: 0 });
      expect(c.holds[0]!.exceptionCode).toBe('leak_spike');
    });

    it('all blocking exceptions cleared → billable once', () => {
      const c = classify([
        {
          ...base,
          exceptions: [
            exc('high_read', 'resolved', true),
            exc('negative_consumption', 'overridden', true),
          ],
        },
      ]);
      expect(c.counts).toEqual({ billable: 1, held: 0, missing: 0, skipped: 0 });
      expect(c.billable).toHaveLength(1);
    });
  });
});

describe('export render', () => {
  it('renders a header + CRLF rows and escapes commas', () => {
    const csv = render('csv', [
      {
        meterSerial: 'M1',
        serviceAddress: '1 Main St, Apt 2',
        readAt: '2026-07-18T10:00:00.000Z',
        readValue: 1234,
        consumption: 42,
      },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('meter_serial,service_address,read_date,read_value,consumption');
    expect(lines[1]).toBe('M1,"1 Main St, Apt 2",2026-07-18,1234,42');
  });

  it('filenames are slugged', () => {
    expect(exportFilename('San Luis Obispo', '2026-07', 'csv')).toBe('san-luis-obispo-2026-07.csv');
  });
});
