import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Database } from '../db/client';
import type { Env } from '../config/env';
import type { AuditEntry } from '../audit/audit.service';
import type { AuditService } from '../audit/audit.service';
import { StaffService } from './staff.service';
import { LocalStaffDirectory, usernameFromDisplayName } from './local-staff-directory';
import type { CreateStaffOutcome, StaffDirectoryPort } from './staff-directory.port';
import { mapAppRoleToOrgRole, mapOrgRoleToAppRole } from '../webhooks/clerk-role-map';
import { ROLES } from '@routewrangler/contracts';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function userRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: TARGET,
    cognitoSub: 'local-only:target',
    displayName: 'Target Person',
    role: 'reader',
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/**
 * Fakes only as much of the Drizzle builder chain as StaffService walks, in the
 * house style (see clerk-webhook.test.ts). Assertions are on recorded values,
 * never on the `where` predicate — the fake receives Drizzle's SQL object, not
 * the raw argument.
 */
function fakeDb(opts: { selectRows?: unknown[]; insertReturns?: unknown[]; updateReturns?: unknown[] } = {}) {
  const calls: { inserted?: unknown; updated?: unknown } = {};
  const select = () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(opts.selectRows ?? []),
      orderBy: () => Promise.resolve(opts.selectRows ?? []),
    };
    return chain;
  };
  const db = {
    select,
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            calls.inserted = v;
            return Promise.resolve(opts.insertReturns ?? []);
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => {
            calls.updated = v;
            return Promise.resolve(opts.updateReturns ?? []);
          },
        }),
      }),
    }),
  } as unknown as Database;
  return { db, calls };
}

function fakeAudit() {
  const written: AuditEntry[] = [];
  const audit = {
    write: (e: AuditEntry) => {
      written.push(e);
      return Promise.resolve();
    },
  } as unknown as AuditService;
  return { audit, written };
}

function fakeEnv(over: Partial<Env> = {}): Env {
  return { staffProvider: 'local', authDevBypass: true, ...over } as Env;
}

function fakeDirectory(over: Partial<StaffDirectoryPort> = {}): StaffDirectoryPort {
  return {
    createStaff: () =>
      Promise.resolve({ kind: 'provisioned', cognitoSub: 'local-only:target' } as CreateStaffOutcome),
    setRole: () => Promise.resolve(),
    setActive: () => Promise.resolve(),
    listPendingInvitations: () => Promise.resolve([]),
    ...over,
  };
}

describe('usernameFromDisplayName', () => {
  it('folds a display name into a sub suffix matching the seed shape', () => {
    expect(usernameFromDisplayName('Dana Okafor')).toBe('dana-okafor');
    expect(usernameFromDisplayName("  Mary-Jane  O'Neil  ")).toBe('mary-jane-o-neil');
  });

  it('returns empty when nothing survives folding, so the caller can reject it', () => {
    // A name of only punctuation would otherwise mint the bare sub `local-only:`,
    // which every future create would then collide with.
    expect(usernameFromDisplayName('!!!')).toBe('');
  });
});

describe('LocalStaffDirectory', () => {
  it('mints a local-only sub the dev shim will recognise', async () => {
    const out = await new LocalStaffDirectory().createStaff({ displayName: 'Dana Okafor', role: 'reader' });
    expect(out).toEqual({ kind: 'provisioned', cognitoSub: 'local-only:dana-okafor' });
  });

  it('prefers an explicit username over one derived from the display name', async () => {
    const out = await new LocalStaffDirectory().createStaff({
      displayName: 'Dana Okafor',
      role: 'reader',
      username: 'dokafor',
    });
    expect(out).toEqual({ kind: 'provisioned', cognitoSub: 'local-only:dokafor' });
  });

  it('rejects a display name that folds to nothing', async () => {
    await expect(new LocalStaffDirectory().createStaff({ displayName: '???', role: 'reader' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('mapAppRoleToOrgRole', () => {
  it('round-trips through mapOrgRoleToAppRole for every app role', () => {
    // A role we push to Clerk must come back as the same role via the webhook,
    // or an admin's change would silently land as something else.
    for (const role of ROLES) {
      expect(mapOrgRoleToAppRole(mapAppRoleToOrgRole(role))).toBe(role);
    }
  });
});

describe('StaffService.create', () => {
  it('refuses to mint a local account when the dev bypass is off', async () => {
    // Such a row is unusable at best, and a way to manufacture access at worst.
    const { db } = fakeDb();
    const svc = new StaffService(db, fakeEnv({ authDevBypass: false }), fakeDirectory(), fakeAudit().audit);
    await expect(svc.create({ displayName: 'Dana', role: 'admin' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('writes no user row when the provider returns an invitation', async () => {
    const { db, calls } = fakeDb();
    const { audit, written } = fakeAudit();
    const directory = fakeDirectory({
      createStaff: () =>
        Promise.resolve({
          kind: 'invited',
          invitation: { id: 'inv_1', email: 'd@example.com', role: 'reader', createdAt: '2026-01-01T00:00:00.000Z' },
        }),
    });
    const svc = new StaffService(db, fakeEnv({ staffProvider: 'clerk' }), directory, audit);

    const res = await svc.create({ displayName: 'Dana', role: 'reader', email: 'd@example.com' }, ACTOR);

    expect(res.member).toBeNull();
    expect(res.invitation?.id).toBe('inv_1');
    // Clerk owns identity: the row must come from the membership webhook, so
    // that there is exactly one writer of the authorization record.
    expect(calls.inserted).toBeUndefined();
    expect(written[0]?.action).toBe('user.invited');
  });

  it('reports a conflict rather than adopting an existing row on a duplicate sub', async () => {
    // onConflictDoNothing returns no rows; treating that as success would let an
    // admin silently rename and re-role a different person.
    const { db } = fakeDb({ insertReturns: [] });
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.create({ displayName: 'Dana', role: 'reader' }, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('audits the created user', async () => {
    const { db } = fakeDb({ insertReturns: [userRow()] });
    const { audit, written } = fakeAudit();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), audit);

    const res = await svc.create({ displayName: 'Target Person', role: 'reader' }, ACTOR);

    expect(res.member?.id).toBe(TARGET);
    expect(written[0]).toMatchObject({ actorId: ACTOR, action: 'user.created', entity: 'user', entityId: TARGET });
  });
});

describe('StaffService.setRole', () => {
  it('refuses to change your own role', async () => {
    // Otherwise the last admin can demote themselves and lock the org out.
    const { db } = fakeDb();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.setRole(ACTOR, 'reader', ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for an unknown staff member', async () => {
    const { db } = fakeDb({ selectRows: [] });
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.setRole(TARGET, 'admin', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a no-op when the role already matches, without touching the provider', async () => {
    let pushed = false;
    const { db, calls } = fakeDb({ selectRows: [userRow({ role: 'reader' })] });
    const directory = fakeDirectory({
      setRole: () => {
        pushed = true;
        return Promise.resolve();
      },
    });
    const svc = new StaffService(db, fakeEnv(), directory, fakeAudit().audit);

    await svc.setRole(TARGET, 'reader', ACTOR);

    expect(pushed).toBe(false);
    expect(calls.updated).toBeUndefined();
  });

  it('conflicts when the guarded update matches no row (the last active admin)', async () => {
    // The last-admin check is a predicate on the UPDATE, not a prior SELECT, so
    // two admins demoting each other concurrently cannot both succeed.
    const { db } = fakeDb({ selectRows: [userRow({ role: 'admin' })], updateReturns: [] });
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.setRole(TARGET, 'reader', ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records the previous role in the audit meta', async () => {
    const { db } = fakeDb({
      selectRows: [userRow({ role: 'reader' })],
      updateReturns: [userRow({ role: 'supervisor' })],
    });
    const { audit, written } = fakeAudit();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), audit);

    await svc.setRole(TARGET, 'supervisor', ACTOR);

    expect(written[0]).toMatchObject({
      action: 'user.role_changed',
      entityId: TARGET,
      meta: { previousRole: 'reader', role: 'supervisor' },
    });
  });
});

describe('StaffService.setActive', () => {
  it('refuses to deactivate your own account', async () => {
    const { db } = fakeDb();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.setActive(ACTOR, false, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates by setting active false, never deleting the row', async () => {
    // users.id is FK-referenced without cascade; a delete would throw for anyone
    // with history and leave them with working access.
    const { db, calls } = fakeDb({
      selectRows: [userRow({ active: true })],
      updateReturns: [userRow({ active: false })],
    });
    const { audit, written } = fakeAudit();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), audit);

    const res = await svc.setActive(TARGET, false, ACTOR);

    expect(res.active).toBe(false);
    expect(calls.updated).toMatchObject({ active: false });
    expect(written[0]?.action).toBe('user.deactivated');
  });

  it('conflicts when deactivating the last active admin', async () => {
    const { db } = fakeDb({ selectRows: [userRow({ role: 'admin', active: true })], updateReturns: [] });
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), fakeAudit().audit);
    await expect(svc.setActive(TARGET, false, ACTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits a reactivation distinctly from a deactivation', async () => {
    const { db } = fakeDb({
      selectRows: [userRow({ active: false })],
      updateReturns: [userRow({ active: true })],
    });
    const { audit, written } = fakeAudit();
    const svc = new StaffService(db, fakeEnv(), fakeDirectory(), audit);

    await svc.setActive(TARGET, true, ACTOR);

    expect(written[0]?.action).toBe('user.reactivated');
  });
});
