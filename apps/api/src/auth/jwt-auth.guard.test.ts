import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '../db/client';
import type { Env } from '../config/env';
import type { AuditEntry, AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { TokenVerifier, VerifiedToken } from './token-verifier';
import type { AuthUser } from './current-user';

const LINKED = {
  id: '11111111-1111-4111-8111-111111111111',
  authSub: 'neon|abc',
  email: 'dana@example.com',
  displayName: 'Dana Okafor',
  role: 'supervisor' as const,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/** Records what the guard asked for, and what the conditional UPDATE returned. */
function fakeDb(opts: { selectRows?: unknown[]; claimReturns?: unknown[] } = {}) {
  const calls = { updated: undefined as unknown, updateCount: 0 };
  const db = {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(opts.selectRows ?? []),
      };
      return chain;
    },
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => {
            calls.updated = v;
            calls.updateCount += 1;
            return Promise.resolve(opts.claimReturns ?? []);
          },
        }),
      }),
    }),
  } as unknown as Database;
  return { db, calls };
}

function fakeAudit() {
  const written: AuditEntry[] = [];
  return {
    written,
    audit: {
      write: (e: AuditEntry) => {
        written.push(e);
        return Promise.resolve();
      },
    } as unknown as AuditService,
  };
}

const reflector = { getAllAndOverride: () => false } as unknown as Reflector;

function context(headers: Record<string, string> = {}) {
  const request = { headers } as unknown as Request;
  return {
    ctx: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext,
    request: request as Request & { user?: AuthUser },
  };
}

function verifier(token: Partial<VerifiedToken>): TokenVerifier {
  return {
    verify: () =>
      Promise.resolve({ sub: 'neon|abc', groups: [], raw: {}, ...token } as VerifiedToken),
  };
}

const IDP_ENV = { authConfigured: true, authDevBypass: false } as Env;

describe('JwtAuthGuard — resolving the caller', () => {
  it('attaches the user from the row found by subject id', async () => {
    const { db, calls } = fakeDb({ selectRows: [LINKED] });
    const { ctx, request } = context({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(reflector, db, IDP_ENV, verifier({}), fakeAudit().audit);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: LINKED.id, role: 'supervisor' });
    // A known subject must not go anywhere near the claim path.
    expect(calls.updateCount).toBe(0);
  });

  it('refuses a deactivated staff member on their very next request', async () => {
    const { db } = fakeDb({ selectRows: [{ ...LINKED, active: false }] });
    const { ctx } = context({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(reflector, db, IDP_ENV, verifier({}), fakeAudit().audit);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing bearer token when an IdP is configured', async () => {
    const { db } = fakeDb();
    const { ctx } = context();
    const guard = new JwtAuthGuard(reflector, db, IDP_ENV, verifier({}), fakeAudit().audit);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('points an unconfigured deployment at the setting it is missing', async () => {
    // The old message told operators to provision a Cognito pool that no longer
    // exists anywhere in this system (ADR-026).
    const { db } = fakeDb();
    const { ctx } = context();
    const env = { authConfigured: false, authDevBypass: false } as Env;
    const guard = new JwtAuthGuard(reflector, db, env, null, fakeAudit().audit);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/NEON_AUTH_BASE_URL/);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('trusts x-dev-user-sub only on the bypass path (ADR-012)', async () => {
    const { db } = fakeDb({ selectRows: [LINKED] });
    const { ctx, request } = context({ 'x-dev-user-sub': 'local-only:jeramehl' });
    const env = { authConfigured: false, authDevBypass: true } as Env;
    const guard = new JwtAuthGuard(reflector, db, env, null, fakeAudit().audit);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user?.id).toBe(LINKED.id);
  });
});

describe('JwtAuthGuard — claiming an invitation (ADR-027)', () => {
  const INVITED = { ...LINKED, authSub: 'neon|abc' };

  it('links an unclaimed row to the verified identity and audits it', async () => {
    const { db, calls } = fakeDb({ selectRows: [], claimReturns: [INVITED] });
    const { ctx, request } = context({ authorization: 'Bearer t' });
    const { audit, written } = fakeAudit();
    const guard = new JwtAuthGuard(
      reflector,
      db,
      IDP_ENV,
      verifier({ sub: 'neon|abc', email: 'dana@example.com' }),
      audit,
    );

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(calls.updated).toMatchObject({ authSub: 'neon|abc' });
    expect(request.user?.role).toBe('supervisor');
    expect(written[0]).toMatchObject({
      action: 'user.identity_linked',
      entityId: INVITED.id,
      meta: { email: 'dana@example.com' },
    });
  });

  it('does not attempt a claim when the token carries no verified address', async () => {
    // An unverified address must never link an invitation, so the guard should
    // not even reach the UPDATE — anything else would rely on the SQL predicate
    // to save us from a decision made upstream.
    const { db, calls } = fakeDb({ selectRows: [] });
    const { ctx } = context({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(
      reflector,
      db,
      IDP_ENV,
      verifier({ sub: 'neon|xyz', email: undefined }),
      fakeAudit().audit,
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(calls.updateCount).toBe(0);
  });

  it('rejects when the invitation was already claimed by someone else', async () => {
    // The `auth_sub IS NULL` predicate matches nothing, so the UPDATE returns no
    // row — the loser of a race must not end up with the winner's account.
    const { db } = fakeDb({ selectRows: [], claimReturns: [] });
    const { ctx } = context({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(
      reflector,
      db,
      IDP_ENV,
      verifier({ sub: 'neon|other', email: 'dana@example.com' }),
      fakeAudit().audit,
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('says the same thing whether nobody was invited or the invite was taken', async () => {
    // Otherwise anyone who can sign in to the IdP could enumerate which
    // colleagues have accounts here by watching the two messages differ.
    const noInvite = fakeDb({ selectRows: [], claimReturns: [] });
    const noEmail = fakeDb({ selectRows: [] });
    const guardA = new JwtAuthGuard(
      reflector,
      noInvite.db,
      IDP_ENV,
      verifier({ email: 'stranger@example.com' }),
      fakeAudit().audit,
    );
    const guardB = new JwtAuthGuard(
      reflector,
      noEmail.db,
      IDP_ENV,
      verifier({ email: undefined }),
      fakeAudit().audit,
    );

    const a = await guardA.canActivate(context({ authorization: 'Bearer t' }).ctx).catch((e) => e);
    const b = await guardB.canActivate(context({ authorization: 'Bearer t' }).ctx).catch((e) => e);
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('never claims on the dev-bypass path — there is no verified address there', async () => {
    const { db, calls } = fakeDb({ selectRows: [] });
    const { ctx } = context({ 'x-dev-user-sub': 'local-only:nobody' });
    const env = { authConfigured: false, authDevBypass: true } as Env;
    const guard = new JwtAuthGuard(reflector, db, env, null, fakeAudit().audit);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(calls.updateCount).toBe(0);
  });
});
