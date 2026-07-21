import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { mapOrgRoleToAppRole, displayNameFrom } from './clerk-role-map';

/** The slice of Clerk's organizationMembership.* payload we consume. */
export interface ClerkMembershipEvent {
  type: string;
  data: {
    role?: string;
    public_user_data?: {
      user_id?: string;
      first_name?: string | null;
      last_name?: string | null;
      identifier?: string | null;
    };
  };
}

export type WebhookOutcome =
  | { action: 'upserted'; sub: string; role: string }
  | { action: 'deleted'; sub: string }
  | { action: 'deferred'; sub: string; reason: string }
  | { action: 'ignored'; reason: string };

/**
 * Applies Clerk organization-membership events to the local `users` table
 * (ADR-007, ADR-015). The API is DB-authoritative for roles — the token's
 * groups are never trusted (jwt-auth.guard) — so membership is the seam that
 * grants access: a member with a mapped org role gets a `users` row keyed by
 * their Clerk `sub`; removing membership revokes it.
 */
@Injectable()
export class ClerkWebhookService {
  private readonly logger = new Logger('ClerkWebhook');

  constructor(@Inject(DB) private readonly db: Database) {}

  async handle(evt: ClerkMembershipEvent): Promise<WebhookOutcome> {
    const sub = evt.data.public_user_data?.user_id;
    if (!sub) return { action: 'ignored', reason: `no user_id on ${evt.type}` };

    if (evt.type === 'organizationMembership.deleted') {
      return this.revoke(sub);
    }

    if (
      evt.type === 'organizationMembership.created' ||
      evt.type === 'organizationMembership.updated'
    ) {
      const role = mapOrgRoleToAppRole(evt.data.role ?? '');
      if (!role) {
        // Unknown org role → no access (least privilege). If a row already
        // exists from a prior known role, revoke it.
        this.logger.warn(`unmapped org role "${evt.data.role}" for ${sub} — declining`);
        return this.revoke(sub);
      }
      const displayName = displayNameFrom(evt.data.public_user_data ?? {});
      await this.db
        .insert(users)
        .values({ cognitoSub: sub, displayName, role })
        .onConflictDoUpdate({
          target: users.cognitoSub,
          set: { displayName, role, updatedAt: new Date() },
        });
      this.logger.log(`provisioned ${sub} as ${role}`);
      return { action: 'upserted', sub, role };
    }

    return { action: 'ignored', reason: `unhandled type ${evt.type}` };
  }

  /**
   * Revokes access by deleting the local row. `users.id` is referenced by runs,
   * exceptions, and audit rows (no cascade), so a delete can hit a foreign-key
   * violation for staff with history — we defer those and log, rather than fail
   * the webhook. A hard-offboarding path (reassign/anonymize) is future work.
   */
  private async revoke(sub: string): Promise<WebhookOutcome> {
    try {
      const deleted = await this.db.delete(users).where(eq(users.cognitoSub, sub)).returning();
      if (deleted.length === 0) return { action: 'ignored', reason: `no local user for ${sub}` };
      this.logger.log(`revoked ${sub}`);
      return { action: 'deleted', sub };
    } catch (err) {
      this.logger.warn(
        `could not delete ${sub} (likely has history — manual offboarding needed): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { action: 'deferred', sub, reason: 'foreign-key references exist' };
    }
  }
}
