'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
            {tasks.map((t) => {
              // A task with no stop (a backfill read) has nowhere to send the
              // reader, so it stays inert rather than linking somewhere useless.
              const href =
                t.runId && t.runStopId
                  ? `/field/runs/${t.runId}/stops/${t.runStopId}?reread=${t.exceptionId}`
                  : null;
              const rowStyle = {
                flexDirection: 'column' as const,
                alignItems: 'stretch' as const,
                gap: 4,
                textDecoration: 'none',
                color: 'inherit',
              };
              const body = (
                <>
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
                  {href && <span style={{ color: 'var(--rw-brand)' }}> · Tap to re-read</span>}
                </div>
                </>
              );
              return href ? (
                <Link key={t.id} href={href} className="rw-row" style={rowStyle}>
                  {body}
                </Link>
              ) : (
                <div key={t.id} className="rw-row" style={rowStyle}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
