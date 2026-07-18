import {
  EXCEPTION_META,
  SEVERITY_META,
  SKIP_REASON_META,
  type ExceptionCode,
} from '@routewrangler/contracts';
import type { Database } from '../src/db/client';
import { exceptionTypes, severities, skipReasons } from '../src/db/schema';
import { id } from './ids';

/**
 * Seeds the taxonomy lookup tables from the shared metadata (ADR-003). One
 * authoritative definition in @routewrangler/contracts drives both the seed and
 * the code that reasons about types. Idempotent (upsert on code).
 */
export async function seedTaxonomy(db: Database) {
  for (const s of SEVERITY_META) {
    await db
      .insert(severities)
      .values({ id: id(`severity:${s.code}`), code: s.code, label: s.label, rank: s.rank })
      .onConflictDoUpdate({ target: severities.code, set: { label: s.label, rank: s.rank } });
  }

  for (const code of Object.keys(EXCEPTION_META) as ExceptionCode[]) {
    const meta = EXCEPTION_META[code];
    await db
      .insert(exceptionTypes)
      .values({
        id: id(`exception_type:${code}`),
        code,
        label: meta.label,
        defaultSeverityId: id(`severity:${meta.defaultSeverity}`),
        blocksBilling: meta.blocksBilling,
      })
      .onConflictDoUpdate({
        target: exceptionTypes.code,
        set: {
          label: meta.label,
          defaultSeverityId: id(`severity:${meta.defaultSeverity}`),
          blocksBilling: meta.blocksBilling,
        },
      });
  }

  for (const r of SKIP_REASON_META) {
    await db
      .insert(skipReasons)
      .values({ id: id(`skip_reason:${r.code}`), code: r.code, label: r.label })
      .onConflictDoUpdate({ target: skipReasons.code, set: { label: r.label } });
  }
}
