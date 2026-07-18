import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  ExceptionCode,
  SeverityCode,
  TaxonomyResponse,
} from '@routewrangler/contracts';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { exceptionTypes, severities, skipReasons } from '../db/schema';

export interface ResolvedType {
  typeId: string;
  severityId: string;
  code: ExceptionCode;
}

/**
 * Loads the seeded taxonomy lookups (ADR-003) and caches them. Provides the
 * GET /taxonomy payload for the UI and code→id resolution for ingestion. The
 * cache is lazy and process-lifetime; taxonomy only changes via a re-seed +
 * redeploy, so no invalidation is needed in v1.
 */
@Injectable()
export class TaxonomyService {
  private cache: {
    response: TaxonomyResponse;
    typeByCode: Map<ExceptionCode, ResolvedType>;
  } | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  async load() {
    if (this.cache) return this.cache;

    const severityRows = await this.db.select().from(severities);
    const typeRows = await this.db.select().from(exceptionTypes);
    const skipRows = await this.db.select().from(skipReasons);

    const sevById = new Map(severityRows.map((s) => [s.id, s]));

    const typeByCode = new Map<ExceptionCode, ResolvedType>();
    for (const t of typeRows) {
      typeByCode.set(t.code as ExceptionCode, {
        typeId: t.id,
        severityId: t.defaultSeverityId,
        code: t.code as ExceptionCode,
      });
    }

    const response: TaxonomyResponse = {
      severities: severityRows
        .sort((a, b) => a.rank - b.rank)
        .map((s) => ({ code: s.code as SeverityCode, label: s.label, rank: s.rank })),
      exceptionTypes: typeRows.map((t) => ({
        code: t.code as ExceptionCode,
        label: t.label,
        defaultSeverity: (sevById.get(t.defaultSeverityId)?.code ?? 'medium') as SeverityCode,
        blocksBilling: t.blocksBilling,
      })),
      skipReasons: skipRows.map((s) => ({ code: s.code as never, label: s.label })),
    };

    this.cache = { response, typeByCode };
    return this.cache;
  }

  async getTaxonomy(): Promise<TaxonomyResponse> {
    return (await this.load()).response;
  }

  async resolve(code: ExceptionCode): Promise<ResolvedType> {
    const { typeByCode } = await this.load();
    const resolved = typeByCode.get(code);
    if (!resolved) {
      throw new Error(`taxonomy missing exception type '${code}' — re-seed required`);
    }
    return resolved;
  }

  /** Resolve a skip reason code → id (used by run close-out, Sprint 3). */
  async resolveSkipReason(code: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(skipReasons)
      .where(eq(skipReasons.code, code))
      .limit(1);
    return row?.id ?? null;
  }
}
