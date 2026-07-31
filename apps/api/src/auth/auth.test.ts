import { describe, it, expect } from 'vitest';
import { extractBearer } from './jwt-auth.guard';
import { extractGroups, extractVerifiedEmail } from './token-verifier';

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
  it('reads the configured claim', () => {
    expect(extractGroups({ groups: ['supervisor', 'admin'] }, 'groups')).toEqual([
      'supervisor',
      'admin',
    ]);
  });

  it('reads a different claim per provider', () => {
    expect(extractGroups({ roles: ['admin'] }, 'roles')).toEqual(['admin']);
    // The `groups` claim is ignored when the provider looks at `roles`.
    expect(extractGroups({ groups: ['admin'] }, 'roles')).toEqual([]);
  });

  it('returns an empty array when absent or malformed', () => {
    expect(extractGroups({}, 'groups')).toEqual([]);
    expect(extractGroups({ groups: 'supervisor' }, 'groups')).toEqual([]);
  });
});

/**
 * This value decides whether a stranger can claim a colleague's pre-assigned
 * role (ADR-027), so the tests below are about what it *refuses*, not what it
 * returns.
 */
describe('extractVerifiedEmail', () => {
  it('accepts the OIDC spelling and normalizes for comparison', () => {
    expect(extractVerifiedEmail({ email: ' Dana@Example.COM ', email_verified: true })).toBe(
      'dana@example.com',
    );
  });

  it('accepts the Better Auth spelling that Neon Auth emits', () => {
    expect(extractVerifiedEmail({ email: 'dana@example.com', emailVerified: true })).toBe(
      'dana@example.com',
    );
  });

  it('accepts the string "true" some providers send', () => {
    expect(extractVerifiedEmail({ email: 'dana@example.com', email_verified: 'true' })).toBe(
      'dana@example.com',
    );
  });

  it('refuses an address the IdP has not verified', () => {
    expect(extractVerifiedEmail({ email: 'dana@example.com', email_verified: false })).toBeUndefined();
  });

  it('refuses an address with no verification claim at all', () => {
    // Absence is not permission: this token is about to be used to hand someone
    // a role that an admin assigned to a specific person.
    expect(extractVerifiedEmail({ email: 'dana@example.com' })).toBeUndefined();
  });

  it('refuses a non-string or obviously malformed address', () => {
    expect(extractVerifiedEmail({ email: 42, email_verified: true })).toBeUndefined();
    expect(extractVerifiedEmail({ email: 'not-an-address', email_verified: true })).toBeUndefined();
    expect(extractVerifiedEmail({ email_verified: true })).toBeUndefined();
  });
});
