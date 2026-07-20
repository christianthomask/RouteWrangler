import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown>;
}

/**
 * Auditability (BUILD_SPEC §2.6): every state-changing supervisor/admin action
 * writes an audit entry. This is the single write path so no action can skip it.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      meta: entry.meta ?? {},
    });
  }

  /** Basic audit trail for an entity (the audit view, BUILD_SPEC §7.3). */
  async forEntity(entity: string, entityId: string) {
    return this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      .orderBy(desc(auditLog.at));
  }
}
