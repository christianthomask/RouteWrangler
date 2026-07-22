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

// `escalated` stays filterable even though the action is no longer offered:
// removing it would make any historical escalated rows unreachable in the UI.
const STATUSES = ['open', 'reread_ordered', 'reread_received', 'resolved', 'overridden', 'escalated'] as const;

export default function ExceptionsPage() {
  const router = useRouter();
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [items, setItems] = useState<ExceptionListItem[] | null>(null);
  const [filters, setFilters] = useState<ExceptionFilters>({ status: 'open' });
  const [error, setError] = useState<string | null>(null);
  /** Groups the supervisor has chosen to open. Reset whenever the filters change. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchTaxonomy().then(setTaxonomy).catch(() => {});
  }, []);

  useEffect(() => {
    setItems(null);
    // A new result set makes the old group keys meaningless.
    setExpanded(new Set());
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
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {groupRuns(items).map((g) =>
              g.collapsed && !expanded.has(g.key) ? (
                <button
                  key={g.key}
                  className="rw-row"
                  onClick={() => setExpanded((prev) => new Set(prev).add(g.key))}
                >
                  <div className="rw-row__top">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <SeverityChip severity={g.items[0]!.severityCode} />
                      <strong style={{ whiteSpace: 'nowrap' }}>{g.items[0]!.typeLabel}</strong>
                    </span>
                    <StatusBadge status={g.items[0]!.status} />
                  </div>
                  <div style={{ fontSize: 'var(--rw-text-sm)' }}>
                    <span style={{ fontWeight: 500 }}>{g.items.length} meters</span>
                    <span style={{ color: 'var(--rw-text-muted)' }}> · {g.items[0]!.clientName}</span>
                  </div>
                  <div className="rw-row__meta tabular">
                    <span style={{ color: 'var(--rw-brand)' }}>Show all {g.items.length}</span>
                    <span style={{ marginLeft: 'auto' }}>{relativeTime(g.items[0]!.createdAt)}</span>
                  </div>
                </button>
              ) : (
                g.items.map((e) => (
              <button key={e.id} className="rw-row" onClick={() => router.push(`/supervisor/exceptions/${e.id}`)}>
                <div className="rw-row__top">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <SeverityChip severity={e.severityCode} />
                    <strong style={{ whiteSpace: 'nowrap' }}>{e.typeLabel}</strong>
                  </span>
                  <StatusBadge status={e.status} />
                </div>
                <div style={{ fontSize: 'var(--rw-text-sm)' }}>
                  <span style={{ fontWeight: 500 }}>{e.meterSerial}</span>
                  <span style={{ color: 'var(--rw-text-muted)' }}> · {e.clientName} · {e.serviceAddress}</span>
                </div>
                <div className="rw-row__meta tabular">
                  <span>value {num(e.value)}</span>
                  <span>consumption {num(e.consumption)}</span>
                  <span style={{ marginLeft: 'auto' }}>{relativeTime(e.createdAt)}</span>
                </div>
              </button>
                ))
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Collapses a run of low-severity findings of the same kind into one row.
 *
 * A device with GPS denied raises one `location_absent` per stop, so a single
 * route can bury the two critical leaks it also produced under a dozen
 * identical rows. Grouping is by type + client + status, and only kicks in past
 * a threshold, so an ordinary queue is untouched — and only for low severity,
 * because a run of criticals is exactly what must never be folded away.
 */
const COLLAPSE_AT = 4;

function groupRuns(items: ExceptionListItem[]) {
  const out: { key: string; items: ExceptionListItem[]; collapsed: boolean }[] = [];
  for (const e of items) {
    const key = `${e.typeCode}|${e.clientId}|${e.status}`;
    const last = out[out.length - 1];
    // Contiguous only: the server's severity-first ordering is meaningful, and
    // gathering scattered rows together would silently reorder the queue.
    if (last && last.key === key) last.items.push(e);
    else out.push({ key, items: [e], collapsed: false });
  }
  for (const g of out) {
    g.collapsed = g.items.length >= COLLAPSE_AT && g.items[0]!.severityCode === 'low';
  }
  return out;
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
