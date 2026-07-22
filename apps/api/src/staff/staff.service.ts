import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  CreateStaffRequest,
  CreateStaffResponse,
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
    cognitoSub: row.cognitoSub,
    displayName: row.displayName,
    role: row.role,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Admin staff administration (ADR-024). The `users` row is the authorization
 * record — the auth guard reads role and `active` from it on every request — so
 * this service owns those writes for both providers, and delegates only the
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
    const [rows, pendingInvitations] = await Promise.all([
      // Inactive staff are included on purpose: this is the screen where you
      // reactivate someone, and hiding them would make that impossible.
      this.db.select().from(users).orderBy(asc(users.displayName)),
      this.directory.listPendingInvitations(),
    ]);
    return {
      provider: this.env.staffProvider,
      staff: rows.map(toStaffMember),
      pendingInvitations,
    };
  }

  async create(req: CreateStaffRequest, actorId: string): Promise<CreateStaffResponse> {
    // The local adapter mints an account that the dev shim will accept without
    // any credential. If the shim is off, such a row is at best unusable and at
    // worst a way to manufacture access, so refuse rather than create it.
    if (this.env.staffProvider === 'local' && !this.env.authDevBypass) {
      throw new BadRequestException(
        'no identity provider is configured — set CLERK_SECRET_KEY and CLERK_ORGANIZATION_ID to invite staff',
      );
    }

    const outcome = await this.directory.createStaff(req);

    if (outcome.kind === 'invited') {
      await this.audit.write({
        actorId,
        action: 'user.invited',
        entity: 'user',
        entityId: outcome.invitation.id,
        meta: { email: outcome.invitation.email, role: req.role },
      });
      return { member: null, invitation: outcome.invitation };
    }

    const [row] = await this.db
      .insert(users)
      .values({
        cognitoSub: outcome.cognitoSub,
        displayName: req.displayName,
        role: req.role,
      })
      // A repeat create must not silently adopt an existing person's row — the
      // admin would think they made a new account and instead have renamed and
      // re-roled someone else.
      .onConflictDoNothing({ target: users.cognitoSub })
      .returning();

    if (!row) {
      throw new ConflictException(`a staff member with sub ${outcome.cognitoSub} already exists`);
    }

    const member = toStaffMember(row);
    await this.audit.write({
      actorId,
      action: 'user.created',
      entity: 'user',
      entityId: member.id,
      meta: { cognitoSub: member.cognitoSub, role: member.role },
    });
    return { member, invitation: null };
  }

  async setRole(id: string, role: Role, actorId: string): Promise<StaffMember> {
    if (id === actorId) {
      throw new BadRequestException('you cannot change your own role');
    }
    const target = await this.load(id);
    if (target.role === role) return target;

    await this.directory.setRole(target.cognitoSub, role);

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

    await this.directory.setActive(target.cognitoSub, active);

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
      meta: { cognitoSub: member.cognitoSub, role: member.role },
    });
    return member;
  }

  /**
   * Folded into the UPDATE's WHERE rather than checked beforehand: two admins
   * demoting each other concurrently would both pass a prior SELECT and leave
   * the organization with nobody who can administer it. As a predicate, the
   * loser's UPDATE matches zero rows (M2 pattern).
   */
  private notTheLastAdmin(id: string) {
    return sql`(${users.role} <> 'admin' OR EXISTS (
      SELECT 1 FROM users other
      WHERE other.role = 'admin' AND other.active = true AND other.id <> ${id}
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
