import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { users, type UserRow } from '../db/schema';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import type { TokenVerifier } from './token-verifier';
import { VERIFIER } from './verifier.provider';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './current-user';

/** What the request proved about who is calling, before any local lookup. */
interface Identity {
  sub: string;
  /** Verified email, lowercased — present only on the real-IdP path. */
  email?: string;
}

/**
 * Global guard (BUILD_SPEC §6 — "role enforcement is server-side on every
 * endpoint"). Verifies the Bearer JWT against the IdP's JWKS, then loads the
 * local `users` row; the DB row's role is authoritative, not the token's groups.
 * Routes opt out only via @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly log = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(VERIFIER) private readonly verifier: TokenVerifier | null,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const identity = await this.resolveIdentity(request);
    const row = await this.resolveUser(identity);

    // Deactivated staff keep their row (history FKs) but lose all access. This
    // is the offboarding path when the row cannot be deleted.
    if (!row.active) {
      throw new UnauthorizedException('this account has been deactivated');
    }

    const authUser: AuthUser = {
      id: row.id,
      // Non-null by construction: resolveUser only returns a row that was either
      // found by subject id or just had one written to it.
      authSub: row.authSub as string,
      displayName: row.displayName,
      role: row.role,
    };
    (request as Request & { user: AuthUser }).user = authUser;
    return true;
  }

  /**
   * Resolves who is calling. Prod path: verify the Bearer JWT against the IdP's
   * JWKS. Local path (ADR-012, never in production): trust the `x-dev-user-sub`
   * header so the simulator and web app work without an IdP. Neither available
   * → labeled 503.
   */
  private async resolveIdentity(request: Request): Promise<Identity> {
    if (this.env.authConfigured && this.verifier) {
      const token = extractBearer(request.headers.authorization);
      if (!token) throw new UnauthorizedException('missing bearer token');
      try {
        const verified = await this.verifier.verify(token);
        return { sub: verified.sub, email: verified.email };
      } catch {
        throw new UnauthorizedException('invalid token');
      }
    }

    if (this.env.authDevBypass) {
      const devSub = request.headers['x-dev-user-sub'];
      const sub = Array.isArray(devSub) ? devSub[0] : devSub;
      if (!sub) throw new UnauthorizedException('missing x-dev-user-sub (dev bypass)');
      return { sub };
    }

    throw new ServiceUnavailableException(
      'auth not configured — set NEON_AUTH_BASE_URL (see docs/runbook.md)',
    );
  }

  /**
   * The authorization record for this identity, claiming an outstanding
   * invitation if that is what this is (ADR-027).
   *
   * An admin invites someone by writing a `users` row with a role and an email
   * but no subject id. The first time that person signs in, the IdP hands us a
   * subject we have never seen, and this is where the two halves meet. No
   * webhook, no second writer, and nothing to reconcile when the IdP's delivery
   * fails — because there is no delivery.
   */
  private async resolveUser(identity: Identity): Promise<UserRow> {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.authSub, identity.sub))
      .limit(1);
    if (existing) return existing;

    if (identity.email) {
      // Claiming is one conditional UPDATE, not select-then-update: two
      // concurrent first requests from the same new user would both see the row
      // unclaimed, and the second writer would be claiming a row that is no
      // longer pending. `auth_sub IS NULL` in the predicate makes the loser
      // match zero rows; the unique index on auth_sub is the backstop.
      const [claimed] = await this.db
        .update(users)
        .set({ authSub: identity.sub, updatedAt: new Date() })
        .where(and(isNull(users.authSub), sql`lower(${users.email}) = ${identity.email}`))
        .returning();

      if (claimed) {
        this.log.log(`linked invitation ${claimed.id} (${identity.email}) to a verified identity`);
        await this.audit.write({
          actorId: claimed.id,
          action: 'user.identity_linked',
          entity: 'user',
          entityId: claimed.id,
          meta: { email: identity.email, role: claimed.role },
        });
        return claimed;
      }
    }

    // Deliberately the same message whether nobody invited this address or the
    // invitation was already claimed: someone who can sign in to the IdP should
    // not be able to probe which colleagues have accounts here.
    throw new UnauthorizedException('no local user for this identity');
  }
}

export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
