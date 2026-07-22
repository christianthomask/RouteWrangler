'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Dashboard } from '@routewrangler/contracts';
import { fetchDashboard } from '@/lib/api';
import { SeverityChip, StatTile, EmptyState, Loading, formatRate, num } from '@/components/ui';
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
          <div className="rw-card" style={{ padding: 0 }}>
            <div className="rw-rows">
              {data.runs.map((r) => (
                <Link key={r.runId} href={`/supervisor/runs/${r.runId}`} className="rw-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="rw-row__top">
                    <strong>{r.routeName}</strong>
                    <span className="tabular" style={{ color: 'var(--rw-text-muted)' }}>{r.completionPct}%</span>
                  </div>
                  <div className="rw-row__meta">
                    <span>{r.clientName}</span>
                    <span>{r.readerName ?? 'Unassigned'}</span>
                    <span style={{ marginLeft: 'auto' }} className="tabular">
                      {/* Skipped stops count toward completion, so omitting them
                          made a finished run read "100% · 4/7 read". */}
                      {r.readStops}/{r.totalStops} read
                      {r.skippedStops ? ` · ${r.skippedStops} skipped` : ''}
                      {r.pendingStops ? ` · ${r.pendingStops} pending` : ''}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--rw-surface-3)', borderRadius: 999, marginTop: 2 }}>
                    <div style={{ width: `${r.completionPct}%`, height: '100%', background: 'var(--rw-brand)', borderRadius: 999 }} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: '0 0 var(--rw-space-3)' }}>Readers</h2>
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {data.readers.map((r) => (
              <div key={r.readerId} className="rw-row" style={{ cursor: 'default' }}>
                <div className="rw-row__top">
                  <strong>{r.readerName}</strong>
                  <span className="tabular" style={{ color: 'var(--rw-text-muted)' }}>
                    {formatRate(r.exceptionRate)} of reads flagged
                  </span>
                </div>
                <div className="rw-row__meta tabular">
                  <span>{num(r.reads)} reads</span>
                  <span>{num(r.exceptions)} exceptions</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
        Triage flagged reads in the <Link href="/supervisor/exceptions">exception queue →</Link>
      </p>
    </div>
  );
}
