'use client';

import type { ExceptionStatus } from '@routewrangler/contracts';
import { SEVERITY_LABEL, type SeverityCode } from '@/design/tokens';

/** Severity chip — color + dot + word, never color alone (ADR-016). */
export function SeverityChip({ severity }: { severity: SeverityCode }) {
  return <span className={`rw-chip rw-chip--${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

const STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: 'Open',
  reread_ordered: 'Reread ordered',
  reread_received: 'Reread received',
  resolved: 'Resolved',
  overridden: 'Overridden',
  escalated: 'Escalated',
};
const STATUS_COLOR: Record<ExceptionStatus, string> = {
  open: 'var(--rw-text-secondary)',
  reread_ordered: 'var(--rw-sync-syncing)',
  reread_received: 'var(--rw-sync-syncing)',
  resolved: 'var(--rw-success)',
  overridden: 'var(--rw-success)',
  escalated: 'var(--rw-warning)',
};

export function StatusBadge({ status }: { status: ExceptionStatus }) {
  return (
    <span className="rw-badge" style={{ color: STATUS_COLOR[status] }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rw-card" style={{ padding: 'var(--rw-space-4)' }}>
      <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div
        className="tabular"
        style={{ fontSize: 'var(--rw-text-3xl)', fontWeight: 'var(--rw-weight-semibold)', color: accent ?? 'var(--rw-text)', lineHeight: 1.1, marginTop: 4 }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      className="rw-card"
      style={{ textAlign: 'center', padding: 'var(--rw-space-10)', color: 'var(--rw-text-muted)' }}
    >
      <div style={{ fontWeight: 'var(--rw-weight-semibold)', color: 'var(--rw-text-secondary)' }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--rw-text-sm)', marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p style={{ color: 'var(--rw-text-muted)', padding: 'var(--rw-space-4)' }}>{label}</p>;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function num(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString();
}
