'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Dashboard } from '@routewrangler/contracts';
import { fetchDashboard } from '@/lib/api';
import { SeverityChip, StatTile, EmptyState, Loading, num } from '@/components/ui';
import type { SeverityCode } from '@/design/tokens';

const SEV_ORDER: SeverityCode[] = ['critical', 'high', 'medium', 'low'];

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (error) return <EmptyState title="Couldn't load the dashboard" hint={error} />;
  if (!data) return <Loading />;

  const sevMap = new Map(data.exceptionsBySeverity.map((s) => [s.severity, s.open]));
  const runsToday = data.runs.length;
  const avgCompletion = runsToday
    ? Math.round(data.runs.reduce((a, r) => a + r.completionPct, 0) / runsToday)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-6)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Today</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 'var(--rw-space-4)' }}>
        <StatTile
          label="Open exceptions"
          value={num(data.openExceptions)}
          accent={data.openExceptions ? 'var(--rw-sev-critical)' : undefined}
          sub={
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {SEV_ORDER.filter((s) => sevMap.get(s)).map((s) => (
                <span key={s} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <SeverityChip severity={s} />
                  <span className="tabular">{sevMap.get(s)}</span>
                </span>
              ))}
            </span>
          }
        />
        <StatTile label="Runs today" value={num(runsToday)} sub={`${avgCompletion}% avg completion`} />
        <StatTile label="Aging runs" value={num(data.agingRuns.length)} sub="open, before today" />
        <StatTile label="Readers active" value={num(data.readers.length)} />
      </div>

      <section>
        <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: '0 0 var(--rw-space-3)' }}>Runs</h2>
        {runsToday === 0 ? (
          <EmptyState title="No runs scheduled today" hint="Assign a route to a reader to start a run." />
        ) : (
          <div className="rw-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--rw-text-sm)' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--rw-text-muted)' }}>
                  <th style={th}>Route</th>
                  <th style={th}>Client</th>
                  <th style={th}>Reader</th>
                  <th style={th}>Progress</th>
                  <th style={{ ...th, textAlign: 'right' }}>Stops</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.runId} style={{ borderTop: '1px solid var(--rw-border)' }}>
                    <td style={td}>{r.routeName}</td>
                    <td style={td}>{r.clientName}</td>
                    <td style={td}>{r.readerName ?? '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, maxWidth: 140, height: 6, background: 'var(--rw-surface-3)', borderRadius: 999 }}>
                          <div style={{ width: `${r.completionPct}%`, height: '100%', background: 'var(--rw-brand)', borderRadius: 999 }} />
                        </div>
                        <span className="tabular" style={{ color: 'var(--rw-text-muted)' }}>{r.completionPct}%</span>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }} className="tabular">
                      {r.readStops}/{r.totalStops}
                      {r.pendingStops ? <span style={{ color: 'var(--rw-text-muted)' }}> · {r.pendingStops} pending</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: '0 0 var(--rw-space-3)' }}>Readers</h2>
        <div className="rw-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--rw-text-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--rw-text-muted)' }}>
                <th style={th}>Reader</th>
                <th style={{ ...th, textAlign: 'right' }}>Reads</th>
                <th style={{ ...th, textAlign: 'right' }}>Exceptions</th>
                <th style={{ ...th, textAlign: 'right' }}>Exception rate</th>
              </tr>
            </thead>
            <tbody>
              {data.readers.map((r) => (
                <tr key={r.readerId} style={{ borderTop: '1px solid var(--rw-border)' }}>
                  <td style={td}>{r.readerName}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="tabular">{num(r.reads)}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="tabular">{num(r.exceptions)}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="tabular">{Math.round(r.exceptionRate * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
        Triage flagged reads in the <Link href="/supervisor/exceptions">exception queue →</Link>
      </p>
    </div>
  );
}

const th: React.CSSProperties = { padding: '0.6rem 0.9rem', fontWeight: 600, fontSize: 'var(--rw-text-xs)', textTransform: 'uppercase', letterSpacing: '0.03em' };
const td: React.CSSProperties = { padding: '0.6rem 0.9rem' };
