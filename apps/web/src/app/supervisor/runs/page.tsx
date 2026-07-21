'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RosterReader, RunStatus, RunSummary } from '@routewrangler/contracts';
import { fetchRoster, fetchRuns, type RunFilters } from '@/lib/api';
import { EmptyState, Loading } from '@/components/ui';

const STATUSES: RunStatus[] = ['open', 'closed'];

/**
 * Every run, not just today's. The dashboard only surfaces runs dated today,
 * which leaves yesterday's half-finished route unreachable — and so impossible
 * to reassign, release, or split. This is the way in.
 */
export default function SupervisorRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [readers, setReaders] = useState<RosterReader[]>([]);
  const [readerId, setReaderId] = useState('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [unassigned, setUnassigned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoster().then((r) => setReaders(r.readers)).catch(() => {});
  }, []);

  useEffect(() => {
    setRuns(null);
    setError(null);
    // The unassigned pool is its own query — a readerId filter would contradict it.
    const filters: RunFilters = unassigned
      ? { unassigned: true, ...(status ? { status } : {}) }
      : { ...(readerId ? { readerId } : {}), ...(status ? { status } : {}) };
    fetchRuns(filters)
      .then((r) => setRuns(r.runs))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [readerId, status, unassigned]);

  function clearFilters() {
    setReaderId('');
    setStatus('');
    setUnassigned(false);
  }

  const filtered = readerId || status || unassigned;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Runs</h1>

      <div style={{ display: 'flex', gap: 'var(--rw-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={filterLabel}>
          <span style={filterCaption}>Reader</span>
          <select
            className="rw-input"
            style={filterInput}
            value={readerId}
            disabled={unassigned}
            onChange={(e) => setReaderId(e.target.value)}
          >
            <option value="">All readers</option>
            {readers.map((r) => (
              <option key={r.readerId} value={r.readerId}>{r.name}</option>
            ))}
          </select>
        </label>

        <label style={filterLabel}>
          <span style={filterCaption}>Status</span>
          <select
            className="rw-input"
            style={{ ...filterInput, textTransform: 'capitalize' }}
            value={status}
            onChange={(e) => setStatus(e.target.value as RunStatus | '')}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} style={{ textTransform: 'capitalize' }}>{s}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={unassigned}
            onChange={(e) => setUnassigned(e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          <span style={{ fontSize: 'var(--rw-text-sm)' }}>Unassigned only</span>
        </label>

        <button className="rw-button rw-button--ghost" disabled={!filtered} onClick={clearFilters}>
          Clear
        </button>
      </div>

      {error ? (
        <EmptyState title="Couldn't load runs" hint={error} />
      ) : !runs ? (
        <Loading />
      ) : runs.length === 0 ? (
        <EmptyState
          title={unassigned ? 'Nothing in the unassigned pool' : 'No runs match'}
          hint={filtered ? 'Adjust the filters to widen the search.' : 'Assign a route to create a run.'}
        />
      ) : (
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {runs.map((r) => (
              <button
                key={r.id}
                className="rw-row"
                onClick={() => router.push(`/supervisor/runs/${r.id}`)}
              >
                <div className="rw-row__top">
                  <strong style={{ minWidth: 0 }}>{r.routeName}</strong>
                  <span className="rw-badge">{r.status}</span>
                </div>
                <div style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>
                  {r.clientName}
                </div>
                <div className="rw-row__meta tabular">
                  <span>{r.runDate}</span>
                  <span>cycle {r.cycleId}</span>
                  <span>
                    {r.completedCount}/{r.stopCount} done
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {r.readerId ? (
                      r.readerName ?? r.readerId.slice(0, 8)
                    ) : (
                      <span className="rw-badge" style={{ color: 'var(--rw-warning)' }}>Unassigned</span>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const filterLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const filterCaption: React.CSSProperties = {
  fontSize: 'var(--rw-text-xs)',
  color: 'var(--rw-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};
const filterInput: React.CSSProperties = { width: 'auto', minWidth: 140, padding: '0.4rem 0.6rem' };
