import { describe, it, expect } from 'vitest';
import { allowedActions, isTerminal, MAX_REREADS, rateOf } from './lifecycle';

describe('exception lifecycle', () => {
  it('open exception allows all actions incl. reread', () => {
    expect(allowedActions('open', 0)).toEqual(['reread', 'override', 'resolve', 'escalate']);
  });

  it('reread drops off once the two-reread cap is hit', () => {
    expect(allowedActions('reread_received', MAX_REREADS)).toEqual([
      'override',
      'resolve',
      'escalate',
    ]);
    expect(allowedActions('reread_ordered', 1)).toContain('reread');
  });

  it('terminal states admit no further action', () => {
    for (const s of ['resolved', 'overridden', 'escalated'] as const) {
      expect(isTerminal(s)).toBe(true);
      expect(allowedActions(s, 0)).toEqual([]);
    }
  });

  it('non-terminal states are actionable', () => {
    for (const s of ['open', 'reread_ordered', 'reread_received'] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it('keeps rereads non-terminal, so in-flight work stays on the dashboard', () => {
    // The dashboard counts non-terminal exceptions. Were a reread terminal,
    // ordering one would read as closing the item and the outstanding work
    // would silently leave the supervisor's board.
    expect(isTerminal('reread_ordered')).toBe(false);
    expect(isTerminal('reread_received')).toBe(false);
  });
});

describe('rateOf', () => {
  it('never exceeds 1, because one read can raise several exceptions', () => {
    // Eight reads that raised eleven exceptions between them rendered as "138%".
    // The rate is the share of a reader's reads that got flagged, so it counts
    // distinct flagged reads rather than exception rows.
    expect(rateOf(8, 8)).toBe(1);
    expect(rateOf(6, 8)).toBe(0.75);
  });

  it('keeps enough precision for a small non-zero rate to survive display', () => {
    // The web layer multiplies by 100, so rounding the fraction to 2dp here
    // collapsed everything under 0.5% to a flat "0%".
    expect(rateOf(1, 720)).toBeCloseTo(0.0014, 4);
    expect(rateOf(1, 720)).toBeGreaterThan(0);
  });

  it('is zero for a reader with no reads rather than dividing by zero', () => {
    expect(rateOf(0, 0)).toBe(0);
  });
});
