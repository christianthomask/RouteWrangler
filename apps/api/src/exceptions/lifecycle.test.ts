import { describe, it, expect } from 'vitest';
import { allowedActions, isTerminal, MAX_REREADS } from './lifecycle';

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
});
