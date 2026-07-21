import { describe, it, expect } from 'vitest';
import { mapOrgRoleToAppRole, displayNameFrom } from './clerk-role-map';
import { ClerkWebhookService, type ClerkMembershipEvent } from './clerk-webhook.service';
import type { Database } from '../db/client';

describe('clerk org-role → app-role map', () => {
  it('maps the three custom roles', () => {
    expect(mapOrgRoleToAppRole('org:admin')).toBe('admin');
    expect(mapOrgRoleToAppRole('org:supervisor')).toBe('supervisor');
    expect(mapOrgRoleToAppRole('org:reader')).toBe('reader');
  });

  it('treats the built-in member role as least privilege', () => {
    expect(mapOrgRoleToAppRole('org:member')).toBe('reader');
  });

  it('returns null for unknown roles (no access by default)', () => {
    expect(mapOrgRoleToAppRole('org:billing')).toBeNull();
    expect(mapOrgRoleToAppRole('')).toBeNull();
  });
});

describe('displayNameFrom', () => {
  it('joins first + last, else identifier, else fallback', () => {
    expect(displayNameFrom({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
    expect(displayNameFrom({ first_name: 'Ada' })).toBe('Ada');
    expect(displayNameFrom({ identifier: 'ada@x.io' })).toBe('ada@x.io');
    expect(displayNameFrom({})).toBe('Unknown user');
  });
});

/** Minimal fake Drizzle handle recording the one insert/delete chain each. */
function fakeDb() {
  const calls: { upsert?: unknown; deletedSub?: string } = {};
  let deleteReturns: unknown[] = [{ id: 'row' }];
  const db = {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: () => {
          calls.upsert = v;
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: (cond: { sub?: string }) => ({
        returning: () => {
          calls.deletedSub = cond?.sub;
          return Promise.resolve(deleteReturns);
        },
      }),
    }),
  } as unknown as Database;
  return { db, calls, setDeleteReturns: (r: unknown[]) => (deleteReturns = r) };
}

// The fake's `where(cond)` receives Drizzle's SQL object, not our sub — so we
// assert on the recorded upsert values and delete invocation, not the predicate.
function svc(db: Database) {
  return new ClerkWebhookService(db);
}

describe('ClerkWebhookService.handle', () => {
  const membership = (type: string, role: string): ClerkMembershipEvent => ({
    type,
    data: { role, public_user_data: { user_id: 'user_123', first_name: 'Jer', last_name: 'Amehl' } },
  });

  it('provisions a row on created with a known role', async () => {
    const { db, calls } = fakeDb();
    const out = await svc(db).handle(membership('organizationMembership.created', 'org:supervisor'));
    expect(out).toEqual({ action: 'upserted', sub: 'user_123', role: 'supervisor' });
    expect(calls.upsert).toMatchObject({
      cognitoSub: 'user_123',
      displayName: 'Jer Amehl',
      role: 'supervisor',
    });
  });

  it('updates the row on updated with a new role', async () => {
    const { db, calls } = fakeDb();
    const out = await svc(db).handle(membership('organizationMembership.updated', 'org:admin'));
    expect(out).toEqual({ action: 'upserted', sub: 'user_123', role: 'admin' });
    expect(calls.upsert).toMatchObject({ role: 'admin' });
  });

  it('revokes (deletes) on an unmapped role', async () => {
    const { db, calls } = fakeDb();
    const out = await svc(db).handle(membership('organizationMembership.updated', 'org:billing'));
    expect(out).toEqual({ action: 'deleted', sub: 'user_123' });
    expect(calls.upsert).toBeUndefined();
  });

  it('revokes on membership deleted', async () => {
    const { db } = fakeDb();
    const out = await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    expect(out).toEqual({ action: 'deleted', sub: 'user_123' });
  });

  it('ignores a delete when no local row exists', async () => {
    const { db, setDeleteReturns } = fakeDb();
    setDeleteReturns([]);
    const out = await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    expect(out).toEqual({ action: 'ignored', reason: 'no local user for user_123' });
  });

  it('ignores events without a user_id', async () => {
    const { db } = fakeDb();
    const out = await svc(db).handle({ type: 'organizationMembership.created', data: { role: 'org:admin' } });
    expect(out.action).toBe('ignored');
  });

  it('defers when the delete hits a foreign-key violation', async () => {
    const calls: { deletedSub?: string } = {};
    const db = {
      delete: () => ({
        where: () => ({
          returning: () => Promise.reject(new Error('violates foreign key constraint')),
        }),
      }),
    } as unknown as Database;
    void calls;
    const out = await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    expect(out).toEqual({ action: 'deferred', sub: 'user_123', reason: 'foreign-key references exist' });
  });
});
