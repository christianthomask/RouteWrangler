import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { DevUserListResponse } from '@routewrangler/contracts';
import { Public } from '../auth/public.decorator';
import { DB } from '../db/db.module';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import { users } from '../db/schema';

/**
 * The sign-in choices for the local dev-auth shim (ADR-012).
 *
 * Public because the login page has no credential yet — which is exactly why it
 * 404s unless the bypass is active. In any environment where the bypass is off
 * (always, in production) this endpoint does not exist, so it can never be used
 * to enumerate staff.
 *
 * The login page reads this rather than a hardcoded list so staff created
 * through admin are actually reachable, and so the list cannot drift from the
 * database the way the previous constant had.
 */
@Public()
@Controller('dev/users')
export class DevUsersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async list(): Promise<DevUserListResponse> {
    if (!this.env.authDevBypass) throw new NotFoundException();
    const rows = await this.db
      .select({ sub: users.authSub, displayName: users.displayName, role: users.role })
      .from(users)
      // Deactivated staff would be rejected by the guard immediately after
      // "signing in", which reads as a broken login rather than a revoked one.
      // Invited-but-never-linked rows have no sub to send, so they are not
      // offerable here either — the bypass has no way to become them.
      .where(and(eq(users.active, true), isNotNull(users.authSub)))
      .orderBy(asc(users.displayName));
    return { users: rows.map((r) => ({ ...r, sub: r.sub as string })) };
  }
}
