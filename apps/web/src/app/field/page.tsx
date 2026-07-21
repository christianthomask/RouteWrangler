'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RunSummary } from '@routewrangler/contracts';
import { fetchRuns } from '@/lib/api';
import { EmptyState, Loading } from '@/components/ui';

export default function FieldTodayPage() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns()
      .then((r) => setRuns(r.runs))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: 0 }}>Today&apos;s runs</h1>
      {error ? (
        <EmptyState title="Couldn't load your runs" hint={error} />
      ) : !runs ? (
        <Loading />
      ) : runs.length === 0 ? (
        <EmptyState title="No runs assigned" hint="Your supervisor assigns routes to you; they'll show here." />
      ) : (
        runs.map((r) => {
          const pct = r.stopCount ? Math.round((r.completedCount / r.stopCount) * 100) : 0;
          return (
            <Link
              key={r.id}
              href={`/field/runs/${r.id}`}
              className="rw-card"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong style={{ minWidth: 0 }}>{r.routeName}</strong>
                <span className="rw-badge" style={{ flex: 'none' }}>{r.status}</span>
              </div>
              <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', marginTop: 4 }}>
                {r.clientName} · {r.runDate} · cycle {r.cycleId}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--rw-space-3)' }}>
                <div style={{ flex: 1, height: 8, background: 'var(--rw-surface-3)', borderRadius: 999 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--rw-brand)', borderRadius: 999 }} />
                </div>
                <span className="tabular" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', flex: 'none' }}>
                  {r.completedCount}/{r.stopCount}
                </span>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
