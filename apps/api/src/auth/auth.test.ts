import { describe, it, expect } from 'vitest';
import { extractBearer } from './jwt-auth.guard';
import { extractGroups } from './token-verifier';

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
  it('reads the configured claim (Cognito: cognito:groups)', () => {
    expect(
      extractGroups({ 'cognito:groups': ['supervisor', 'admin'] }, 'cognito:groups'),
    ).toEqual(['supervisor', 'admin']);
  });

  it('reads a different claim per provider (Entra: roles)', () => {
    expect(extractGroups({ roles: ['admin'] }, 'roles')).toEqual(['admin']);
    // The Cognito claim is ignored when the provider looks at `roles`.
    expect(extractGroups({ 'cognito:groups': ['admin'] }, 'roles')).toEqual([]);
  });

  it('returns an empty array when absent or malformed', () => {
    expect(extractGroups({}, 'cognito:groups')).toEqual([]);
    expect(extractGroups({ 'cognito:groups': 'supervisor' }, 'cognito:groups')).toEqual([]);
  });
});
