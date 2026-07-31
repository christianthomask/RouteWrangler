import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateStaffRequest,
  CreateStaffResponse,
  PendingInvitation,
  Role,
  StaffListResponse,
  StaffMember,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import { users, type UserRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { STAFF_DIRECTORY, type StaffDirectoryPort } from './staff-directory.port';

function toStaffMember(row: UserRow): StaffMember {
  return {
    id: row.id,
    authSub: row.authSub,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A row that has a role and an address but no identity yet is, by definition,
 * an outstanding invitation (ADR-027). There is no separate invitations table
 * to drift out of step with this one.
 */
function toPendingInvitation(row: UserRow): PendingInvitation | null {
  if (row.authSub !== null || row.email === null) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Admin staff administration (ADR-024). The `users` row is the authorization
 * record — the auth guard reads role and `active` from it on every request — so
 * this service owns those writes for every provider, and delegates only the
 * identity-provider side to the injected port.
 */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectoryPort,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<StaffListResponse> {
    // Inactive staff are included on purpose: this is the screen where you
    // reactivate someone, and hiding them would make that impossible.
    const rows = await this.db.select().from(users).orderBy(asc(users.displayName));
    return {
      provider: this.env.staffProvider,
      staff: rows.map(toStaffMember),
      pendingInvitations: rows
        .map(toPendingInvitation)
        .filter((inv): inv is PendingInvitation => inv !== null),
    };
  }

  async create(req: CreateStaffRequest, actorId: string): Promise<CreateStaffResponse> {
    // The local adapter mints an account that the dev shim will accept without
    // any credential. If the shim is off, such a row is at best unusable and at
    // worst a way to manufacture access, so refuse rather than create it.
    if (this.env.staffProvider === 'local' && !this.env.authDevBypass) {
      throw new BadRequestException(
        'no identity provider is configured — set NEON_AUTH_BASE_URL to invite staff',
      );
    }

    const outcome = await this.directory.createStaff(req);

    // Both outcomes write exactly one row. The only difference is whether the
    // subject id is known yet, which is what makes the invitation claimable.
    const [row] = await this.db
      .insert(users)
      .values(
        outcome.kind === 'provisioned'
          ? { authSub: outcome.authSub, displayName: req.displayName, role: req.role }
          : { email: outcome.email, displayName: req.displayName, role: req.role },
      )
      // A repeat create must not silently adopt an existing person's row — the
      // admin would think they made a new account and instead have renamed and
      // re-roled someone else.
      .onConflictDoNothing()
      .returning();

    if (!row) {
      throw new ConflictException(
        outcome.kind === 'provisioned'
          ? `a staff member with sub ${outcome.authSub} already exists`
          : `${outcome.email} is already a staff member or has an outstanding invitation`,
      );
    }

    if (outcome.kind === 'invited') {
      const invitation = toPendingInvitation(row) as PendingInvitation;
      await this.audit.write({
        actorId,
        action: 'user.invited',
        entity: 'user',
        entityId: row.id,
        meta: { email: invitation.email, role: req.role },
      });
      return { member: null, invitation };
    }

    const member = toStaffMember(row);
    await this.audit.write({
      actorId,
      action: 'user.created',
      entity: 'user',
      entityId: member.id,
      meta: { authSub: member.authSub, role: member.role },
    });
    return { member, invitation: null };
  }

  async setRole(id: string, role: Role, actorId: string): Promise<StaffMember> {
    if (id === actorId) {
      throw new BadRequestException('you cannot change your own role');
    }
    const target = await this.load(id);
    if (target.role === role) return target;

    await this.directory.setRole(target.authSub, role);

    const [updated] = await this.db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(sql`${users.id} = ${id} AND ${this.notTheLastAdmin(id)}`)
      .returning();

    if (!updated) throw this.lastAdminConflict();

    const member = toStaffMember(updated);
    await this.audit.write({
      actorId,
      action: 'user.role_changed',
      entity: 'user',
      entityId: id,
      meta: { previousRole: target.role, role },
    });
    return member;
  }

  async setActive(id: string, active: boolean, actorId: string): Promise<StaffMember> {
    if (id === actorId) {
      throw new BadRequestException('you cannot deactivate your own account');
    }
    const target = await this.load(id);
    if (target.active === active) return target;

    await this.directory.setActive(target.authSub, active);

    const [updated] = await this.db
      .update(users)
      .set({ active, updatedAt: new Date() })
      // Deactivating is the dangerous direction; reactivating can never strand
      // the org without an admin, so it carries no guard.
      .where(active ? eq(users.id, id) : sql`${users.id} = ${id} AND ${this.notTheLastAdmin(id)}`)
      .returning();

    if (!updated) throw this.lastAdminConflict();

    const member = toStaffMember(updated);
    await this.audit.write({
      actorId,
      action: active ? 'user.reactivated' : 'user.deactivated',
      entity: 'user',
      entityId: id,
      meta: { authSub: member.authSub, role: member.role },
    });
    return member;
  }

  /**
   * Withdraw an invitation nobody has accepted. Restricted to unclaimed rows by
   * the `auth_sub IS NULL` predicate, so this can never be used as a delete path
   * for a real staff member — those are deactivated, never removed, because runs
   * and audit entries reference them.
   */
  async revokeInvitation(id: string, actorId: string): Promise<void> {
    const [deleted] = await this.db
      .delete(users)
      .where(sql`${users.id} = ${id} AND ${isNull(users.authSub)}`)
      .returning();

    if (!deleted) {
      throw new NotFoundException('no outstanding invitation with that id');
    }
    await this.audit.write({
      actorId,
      action: 'user.invitation_revoked',
      entity: 'user',
      entityId: id,
      meta: { email: deleted.email, role: deleted.role },
    });
  }

  /**
   * Folded into the UPDATE's WHERE rather than checked beforehand: two admins
   * demoting each other concurrently would both pass a prior SELECT and leave
   * the organization with nobody who can administer it. As a predicate, the
   * loser's UPDATE matches zero rows (M2 pattern).
   *
   * An invited-but-never-signed-in admin does not count as cover here — they
   * hold no identity yet, so "there is another admin" would be false in the only
   * sense that matters, which is that somebody can actually log in and act.
   */
  private notTheLastAdmin(id: string) {
    return sql`(${users.role} <> 'admin' OR EXISTS (
      SELECT 1 FROM users other
      WHERE other.role = 'admin' AND other.active = true
        AND other.auth_sub IS NOT NULL AND other.id <> ${id}
    ))`;
  }

  private lastAdminConflict(): ConflictException {
    return new ConflictException(
      'that is the last active admin — promote another admin first',
    );
  }

  private async load(id: string): Promise<StaffMember> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!row) throw new NotFoundException('no such staff member');
    return toStaffMember(row);
  }
}
