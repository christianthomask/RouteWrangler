'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  /*
   * Filters live in the URL. They used to be component state only, so a filtered
   * queue could not be shared or bookmarked, and refresh or Back silently
   * dropped it — on a screen whose whole job is narrowing a list.
   */
  const pathname = usePathname();
  const params = useSearchParams();
  const filters: ExceptionFilters = {
    ...(params.get('status') && params.get('status') !== 'all'
      ? { status: params.get('status') as ExceptionFilters['status'] }
      : {}),
    ...(params.get('severity')
      ? { severity: params.get('severity') as ExceptionFilters['severity'] }
      : {}),
    ...(params.get('type') ? { type: params.get('type') as ExceptionFilters['type'] } : {}),
  };
  // Default view is the open queue; an explicit `status=` (including "all",
  // which drops the key) is respected.
  if (!params.has('status') && !params.has('severity') && !params.has('type')) {
    filters.status = 'open';
  }
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
    // Keyed on the serialised query, not the object — `filters` is rebuilt on
    // every render and would otherwise refetch in a loop.
  }, [params.toString()]);

  function set<K extends keyof ExceptionFilters>(key: K, value: ExceptionFilters[K] | '') {
    const next = new URLSearchParams(params.toString());
    if (value === '') next.delete(key);
    else next.set(key, String(value));
    // `status` is explicitly recorded even when cleared, so "all statuses" is
    // distinguishable from "no filters yet" — which defaults to the open queue.
    if (key === 'status' && value === '') next.set('status', 'all');
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
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
        <button
          className="rw-button rw-button--ghost"
          onClick={() => router.replace(`${pathname}?status=all`, { scroll: false })}
        >
          Clear
        </button>
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
                  {/* A skip has no reading — the reason is what there is to show. */}
                  {e.value == null ? (
                    <span>{e.skipReasonCode ? e.skipReasonCode.replace(/_/g, ' ') : 'skipped'}</span>
                  ) : (
                    <>
                      <span>value {num(e.value)}</span>
                      <span>consumption {num(e.consumption)}</span>
                    </>
                  )}
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
