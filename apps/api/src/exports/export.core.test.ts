import { describe, expect, it } from 'vitest';
import { classify, exportFilename, render, type StopRow } from './export.core';

const base: StopRow = {
  meterId: '00000000-0000-0000-0000-000000000001',
  meterSerial: 'SLO-1-001',
  serviceAddress: '1 Main St',
  readValue: 1000,
  consumption: 42,
  readAt: '2026-07-18T10:00:00.000Z',
  exceptionCode: null,
  exceptionStatus: null,
  exceptionBlocksBilling: false,
};

describe('export classify (BUILD_SPEC §7.4)', () => {
  it('a clean read is billable', () => {
    const c = classify([base]);
    expect(c.counts).toEqual({ billable: 1, held: 0, missing: 0 });
    expect(c.billable[0]!.meterSerial).toBe('SLO-1-001');
  });

  it('an unresolved blocking exception holds the read out', () => {
    const c = classify([{ ...base, exceptionCode: 'high_read', exceptionStatus: 'open', exceptionBlocksBilling: true }]);
    expect(c.counts).toEqual({ billable: 0, held: 1, missing: 0 });
    expect(c.holds[0]!.reason).toBe('blocking_exception');
    expect(c.holds[0]!.exceptionCode).toBe('high_read');
  });

  it('a resolved/overridden blocking exception is billable again', () => {
    const resolved = classify([{ ...base, exceptionCode: 'high_read', exceptionStatus: 'resolved', exceptionBlocksBilling: true }]);
    const overridden = classify([{ ...base, exceptionCode: 'low_read', exceptionStatus: 'overridden', exceptionBlocksBilling: true }]);
    expect(resolved.counts.billable).toBe(1);
    expect(overridden.counts.billable).toBe(1);
  });

  it('a non-blocking exception does not hold the read', () => {
    const c = classify([{ ...base, exceptionCode: 'location_absent', exceptionStatus: 'open', exceptionBlocksBilling: false }]);
    expect(c.counts.billable).toBe(1);
  });

  it('a stop with no read is missing, not held', () => {
    const c = classify([{ ...base, readValue: null, readAt: null }]);
    expect(c.counts).toEqual({ billable: 0, held: 0, missing: 1 });
    expect(c.holds[0]!.reason).toBe('not_read');
  });

  it('mixed cycle counts each bucket', () => {
    const c = classify([
      base,
      { ...base, meterSerial: 'SLO-1-002', exceptionCode: 'leak_spike', exceptionStatus: 'open', exceptionBlocksBilling: true },
      { ...base, meterSerial: 'SLO-1-003', readValue: null, readAt: null },
    ]);
    expect(c.counts).toEqual({ billable: 1, held: 1, missing: 1 });
  });
});

describe('export render', () => {
  it('renders a header + CRLF rows and escapes commas', () => {
    const csv = render('csv', [
      { meterSerial: 'M1', serviceAddress: '1 Main St, Apt 2', readAt: '2026-07-18T10:00:00.000Z', readValue: 1234, consumption: 42 },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('meter_serial,service_address,read_date,read_value,consumption');
    expect(lines[1]).toBe('M1,"1 Main St, Apt 2",2026-07-18,1234,42');
  });

  it('filenames are slugged', () => {
    expect(exportFilename('San Luis Obispo', '2026-07', 'csv')).toBe('san-luis-obispo-2026-07.csv');
  });
});
