import { describe, it, expect } from 'vitest';
import { extractBearer } from './jwt-auth.guard';
import { extractGroups } from './cognito-verifier';

describe('extractBearer', () => {
  it('pulls the token from a well-formed header', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('bearer abc')).toBe('abc');
  });

  it('rejects malformed or missing headers', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('')).toBeNull();
  });
});

describe('extractGroups', () => {
  it('reads cognito:groups when present', () => {
    expect(extractGroups({ 'cognito:groups': ['supervisor', 'admin'] })).toEqual([
      'supervisor',
      'admin',
    ]);
  });

  it('returns an empty array when absent or malformed', () => {
    expect(extractGroups({})).toEqual([]);
    expect(extractGroups({ 'cognito:groups': 'supervisor' })).toEqual([]);
  });
});
