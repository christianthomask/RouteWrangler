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
        runs.map((r) => (
          <Link
            key={r.id}
            href={`/field/runs/${r.id}`}
            className="rw-card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Run · {r.runDate}</strong>
              <span className="rw-badge">{r.status}</span>
            </div>
            <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', marginTop: 4 }}>
              cycle {r.cycleId} · tap to open stops →
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
