import { describe, it, expect } from 'vitest';
import { validateSplit, type StopLite } from './split';

const stops: StopLite[] = [
  { id: 's0', sequence: 0, status: 'read' },
  { id: 's1', sequence: 1, status: 'pending' },
  { id: 's2', sequence: 2, status: 'pending' },
  { id: 's3', sequence: 3, status: 'pending' },
  { id: 's4', sequence: 4, status: 'skipped' },
];

describe('split invariant (ADR-005)', () => {
  it('accepts a contiguous range of pending stops', () => {
    const r = validateSplit(stops, ['s2', 's3']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.moving.map((s) => s.id)).toEqual(['s2', 's3']);
  });

  it('rejects moving a read stop', () => {
    const r = validateSplit(stops, ['s0', 's1']);
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects moving a skipped stop', () => {
    expect(validateSplit(stops, ['s3', 's4'])).toMatchObject({ ok: false });
  });

  it('rejects a non-contiguous selection (gap in the middle)', () => {
    // s1 and s3 pending but s2 (pending) left out → gap
    expect(validateSplit(stops, ['s1', 's3'])).toMatchObject({ ok: false });
  });

  it('rejects an unknown stop and an empty selection', () => {
    expect(validateSplit(stops, ['nope'])).toMatchObject({ ok: false });
    expect(validateSplit(stops, [])).toMatchObject({ ok: false });
  });
});
