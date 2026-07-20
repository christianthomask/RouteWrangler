import { describe, it, expect } from 'vitest';
import { counts, stateFromIngest, syncable, type QueuedAction } from './types';

function a(id: string, seq: number, state: QueuedAction['state']): QueuedAction {
  return { id, kind: 'read', state, seq, createdAt: seq };
}

describe('field queue logic', () => {
  it('syncs pending + failed in capture order, skipping synced/syncing', () => {
    const actions = [a('c', 3, 'failed'), a('a', 1, 'synced'), a('b', 2, 'pending'), a('d', 4, 'syncing')];
    expect(syncable(actions).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('treats accepted and duplicate as landed exactly once; rejected as failed', () => {
    expect(stateFromIngest('accepted')).toBe('synced');
    expect(stateFromIngest('duplicate')).toBe('synced'); // idempotent replay
    expect(stateFromIngest('rejected')).toBe('failed');
  });

  it('tallies per-state counts', () => {
    expect(counts([a('a', 1, 'pending'), a('b', 2, 'synced'), a('c', 3, 'pending')])).toEqual({
      pending: 2,
      syncing: 0,
      synced: 1,
      failed: 0,
    });
  });
});
