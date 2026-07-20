'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ExceptionFilters,
  ExceptionListItem,
  TaxonomyResponse,
} from '@routewrangler/contracts';
import { fetchExceptions, fetchTaxonomy } from '@/lib/api';
import { SeverityChip, StatusBadge, EmptyState, Loading, relativeTime, num } from '@/components/ui';

const STATUSES = ['open', 'reread_ordered', 'reread_received', 'resolved', 'overridden', 'escalated'] as const;

export default function ExceptionsPage() {
  const router = useRouter();
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [items, setItems] = useState<ExceptionListItem[] | null>(null);
  const [filters, setFilters] = useState<ExceptionFilters>({ status: 'open' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTaxonomy().then(setTaxonomy).catch(() => {});
  }, []);

  useEffect(() => {
    setItems(null);
    fetchExceptions(filters)
      .then((r) => setItems(r.exceptions))
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [filters]);

  function set<K extends keyof ExceptionFilters>(key: K, value: ExceptionFilters[K] | '') {
    setFilters((f) => {
      const next = { ...f };
      if (value === '') delete next[key];
      else next[key] = value as ExceptionFilters[K];
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Exception queue</h1>

      <div style={{ display: 'flex', gap: 'var(--rw-space-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Filter label="Status" value={filters.status ?? ''} onChange={(v) => set('status', v as never)}
          options={STATUSES.map((s) => [s, s.replace(/_/g, ' ')])} />
        <Filter label="Severity" value={filters.severity ?? ''} onChange={(v) => set('severity', v as never)}
          options={(taxonomy?.severities ?? []).map((s) => [s.code, s.label])} />
        <Filter label="Type" value={filters.type ?? ''} onChange={(v) => set('type', v as never)}
          options={(taxonomy?.exceptionTypes ?? []).map((t) => [t.code, t.label])} />
        <button className="rw-button rw-button--ghost" onClick={() => setFilters({})}>Clear</button>
      </div>

      {error ? (
        <EmptyState title="Couldn't load exceptions" hint={error} />
      ) : !items ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState title="No exceptions match" hint="Adjust the filters, or enjoy the clean queue." />
      ) : (
        <div className="rw-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--rw-text-sm)' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--rw-text-muted)' }}>
                <th style={th}>Severity</th>
                <th style={th}>Type</th>
                <th style={th}>Meter</th>
                <th style={{ ...th, textAlign: 'right' }}>Value</th>
                <th style={{ ...th, textAlign: 'right' }}>Consumption</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Age</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => router.push(`/supervisor/exceptions/${e.id}`)}
                  style={{ borderTop: '1px solid var(--rw-border)', cursor: 'pointer' }}
                >
                  <td style={td}><SeverityChip severity={e.severityCode} /></td>
                  <td style={td}>{e.typeLabel}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{e.meterSerial}</div>
                    <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-xs)' }}>
                      {e.clientName} · {e.serviceAddress}
                    </div>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} className="tabular">{num(e.value)}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="tabular">{num(e.consumption)}</td>
                  <td style={td}><StatusBadge status={e.status} /></td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--rw-text-muted)' }}>{relativeTime(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
      <select className="rw-input" style={{ width: 'auto', minWidth: 140, padding: '0.4rem 0.6rem', textTransform: 'capitalize' }}
        value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v} style={{ textTransform: 'capitalize' }}>{l}</option>
        ))}
      </select>
    </label>
  );
}

const th: React.CSSProperties = { padding: '0.6rem 0.9rem', fontWeight: 600, fontSize: 'var(--rw-text-xs)', textTransform: 'uppercase', letterSpacing: '0.03em' };
const td: React.CSSProperties = { padding: '0.6rem 0.9rem' };
