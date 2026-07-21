import { describe, expect, it } from 'vitest';
import type { IngestRequest } from '@routewrangler/contracts';
import { IngestionService, type IngestActor } from './ingestion.service';
import type { Database } from '../db/client';
import type { TaxonomyService } from '../taxonomy/taxonomy.service';

const actor: IngestActor = { id: '11111111-1111-4111-8111-111111111111', role: 'reader' };

function event(id: string) {
  return {
    id,
    meterId: '22222222-2222-4222-8222-222222222222',
    value: 100,
    capturedAt: new Date().toISOString(),
    sourceType: 'manual' as const,
  };
}

/**
 * A db stub whose fast idempotency lookup reports "already seen" for every
 * event, except the nth call, which throws — standing in for any unexpected
 * infrastructure failure (connection drop, deadlock) partway through a batch.
 */
function dbThatThrowsOnCall(n: number): Database {
  let calls = 0;
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => {
      calls++;
      if (calls === n) throw new Error('connection reset');
      return [{ id: 'already-ingested' }];
    },
  };
  return { select: () => chain } as unknown as Database;
}

describe('IngestionService.ingest — batch resilience', () => {
  const taxonomy = {} as TaxonomyService;

  it('an unexpected throw on one event does not abort the batch', async () => {
    const svc = new IngestionService(dbThatThrowsOnCall(2), taxonomy);
    const req: IngestRequest = {
      events: [
        event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        event('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        event('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ],
    };

    // Previously this rejected, surfacing a 500 for the whole batch even though
    // the other two events had a perfectly good outcome.
    const res = await svc.ingest(req, actor);

    expect(res.results).toHaveLength(3);
    expect(res.results.map((r) => r.status)).toEqual(['duplicate', 'failed', 'duplicate']);
    // The failure is attributed to the event that caused it, and is
    // marked retryable (failed), not terminal (rejected).
    expect(res.results[1]!.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(res.results[1]!.message).toContain('internal error');
    expect(res.results[1]!.message).toContain('connection reset');
    // Counts still describe the batch truthfully.
    expect(res.duplicates).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.rejected).toBe(0);
    expect(res.accepted).toBe(0);
  });

  it('every event failing still yields a per-event result, not a thrown batch', async () => {
    // Throwing on the 1st call means every subsequent event throws too.
    const svc = new IngestionService(dbThatThrowsOnCall(1), taxonomy);
    const res = await svc.ingest(
      { events: [event('dddddddd-dddd-4ddd-8ddd-dddddddddddd')] },
      actor,
    );
    expect(res.failed).toBe(1);
    expect(res.results[0]!.message).toContain('internal error');
  });
});
