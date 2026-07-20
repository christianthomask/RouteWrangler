'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RosterReader } from '@routewrangler/contracts';
import { fetchRoster } from '@/lib/api';
import { EmptyState, Loading, num } from '@/components/ui';

export default function RosterPage() {
  const [readers, setReaders] = useState<RosterReader[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoster()
      .then((r) => setReaders(r.readers))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Roster</h1>
        <Link href="/supervisor/assign" className="rw-button" style={{ width: 'auto', padding: '0.55rem 1rem', textDecoration: 'none' }}>
          Assign a route
        </Link>
      </div>

      {error ? (
        <EmptyState title="Couldn't load the roster" hint={error} />
      ) : !readers ? (
        <Loading />
      ) : readers.length === 0 ? (
        <EmptyState title="No readers yet" hint="Readers appear here once created in Admin." />
      ) : (
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {readers.map((r) => (
              <div key={r.readerId} className="rw-row" style={{ cursor: 'default' }}>
                <div className="rw-row__top">
                  <strong>{r.name}</strong>
                  <span className="tabular" style={{ color: 'var(--rw-text-muted)' }}>
                    {r.todaysRuns} run{r.todaysRuns === 1 ? '' : 's'} today · {r.completionRate}%
                  </span>
                </div>
                <div className="rw-row__meta tabular">
                  <span>{num(r.reads)} reads</span>
                  <span>{num(r.exceptions)} exceptions</span>
                  <span>{Math.round(r.exceptionRate * 100)}% rate</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
