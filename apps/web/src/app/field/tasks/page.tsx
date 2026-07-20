'use client';

import { useEffect, useState } from 'react';
import type { RereadTaskView } from '@routewrangler/contracts';
import { fetchRereadTasks } from '@/lib/api';
import { EmptyState, Loading } from '@/components/ui';

/**
 * Reread tasks delivered to this reader (BUILD_SPEC §7.2). Fetching the list
 * marks each `issued` task `delivered` server-side, so this is the point of
 * handoff. Completion happens when the reread's read event ingests.
 */
export default function RereadTasksPage() {
  const [tasks, setTasks] = useState<RereadTaskView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRereadTasks()
      .then((r) => setTasks(r.tasks))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: 0 }}>Rereads</h1>
      {error ? (
        <EmptyState title="Couldn't load your rereads" hint={error} />
      ) : !tasks ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <EmptyState title="No rereads pending" hint="When a supervisor orders a reread, it lands here." />
      ) : (
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {tasks.map((t) => (
              <div key={t.id} className="rw-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.meterSerial}
                  </strong>
                  <span
                    className="rw-badge"
                    style={{ flex: 'none', textTransform: 'uppercase', fontSize: 'var(--rw-text-xs)' }}
                  >
                    {t.status}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>{t.serviceAddress}</div>
                <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                  {t.typeLabel} · flagged value <span className="tabular">{t.flaggedValue}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
