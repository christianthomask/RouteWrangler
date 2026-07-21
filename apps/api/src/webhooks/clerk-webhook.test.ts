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

/**
 * Minimal fake Drizzle handle. Revocation is now update-then-delete: deactivate
 * first (so access is revoked regardless), then try to reclaim the row. The
 * fake records both, and `failDelete` simulates the foreign-key violation that
 * staff with history always produce.
 */
function fakeDb(opts: { updateReturns?: unknown[]; failDelete?: boolean } = {}) {
  const calls: { upsert?: unknown; updated?: unknown; deleted?: boolean } = {};
  const updateReturns = opts.updateReturns ?? [{ id: 'row' }];
  const db = {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: (args: { set?: unknown }) => {
          calls.upsert = { ...(v as object), ...(args.set as object) };
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => {
            calls.updated = v;
            return Promise.resolve(updateReturns);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => {
        calls.deleted = true;
        return opts.failDelete
          ? Promise.reject(new Error('violates foreign key constraint'))
          : Promise.resolve([]);
      },
    }),
  } as unknown as Database;
  return { db, calls };
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
    const { db } = fakeDb({ updateReturns: [] });
    const out = await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    expect(out).toEqual({ action: 'ignored', reason: 'no local user for user_123' });
  });

  it('ignores events without a user_id', async () => {
    const { db } = fakeDb();
    const out = await svc(db).handle({ type: 'organizationMembership.created', data: { role: 'org:admin' } });
    expect(out.action).toBe('ignored');
  });

  // The offboarding defect: staff with history cannot be deleted (FK
  // references from runs/exceptions/audit). Revocation must not depend on the
  // delete succeeding, or a departed reader keeps working API access.
  it('deactivates rather than failing when the delete hits a foreign-key violation', async () => {
    const { db, calls } = fakeDb({ failDelete: true });
    const out = await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    expect(out).toEqual({ action: 'deactivated', sub: 'user_123' });
    expect(calls.updated).toMatchObject({ active: false });
  });

  it('deactivates before attempting the delete', async () => {
    const { db, calls } = fakeDb();
    await svc(db).handle(membership('organizationMembership.deleted', 'org:reader'));
    // Ordering is the whole point: if the delete ran first and threw, access
    // would survive. The update must always have happened.
    expect(calls.updated).toMatchObject({ active: false });
    expect(calls.deleted).toBe(true);
  });

  it('re-activates a previously deactivated user on re-add', async () => {
    const { db, calls } = fakeDb();
    const out = await svc(db).handle(membership('organizationMembership.created', 'org:reader'));
    expect(out).toEqual({ action: 'upserted', sub: 'user_123', role: 'reader' });
    expect(calls.upsert).toMatchObject({ active: true });
  });
});
