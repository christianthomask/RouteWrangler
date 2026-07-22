'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { RosterReader, RunDetail } from '@routewrangler/contracts';
import { fetchRun, fetchRoster, reassignRun, splitRun } from '@/lib/api';
import { EmptyState, Loading } from '@/components/ui';

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--rw-text-muted)',
  read: 'var(--rw-success)',
  skipped: 'var(--rw-warning)',
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [readers, setReaders] = useState<RosterReader[]>([]);
  /**
   * Two separate error states, matching the exception detail page.
   * `error` means the run could not be loaded and there is nothing to show;
   * `actionError` means a reassign/release/split was rejected while the run is
   * still perfectly good. Collapsing them replaced the whole screen — stop list,
   * selection and both action panels — on any failed action, which left no way
   * back except navigating away and starting over.
   */
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignTo, setReassignTo] = useState('');
  const [splitTo, setSplitTo] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    fetchRun(id).then(setRun).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }
  useEffect(() => {
    load();
    fetchRoster().then((r) => setReaders(r.readers)).catch(() => {});
  }, [id]);

  const readerName = useMemo(
    () => (rid: string) => readers.find((r) => r.readerId === rid)?.name ?? rid.slice(0, 8),
    [readers],
  );

  /** Server-resolved name wins; fall back to the roster, then to "Unassigned". */
  function assigneeLabel(r: RunDetail): string {
    if (!r.readerId) return 'Unassigned';
    return r.readerName ?? readerName(r.readerId);
  }

  if (error) return <EmptyState title="Couldn't load this run" hint={error} />;
  if (!run) return <Loading />;

  const started = run.stops.some((s) => s.status !== 'pending');
  const pending = run.stops.filter((s) => s.status === 'pending');

  /*
   * The server enforces the split invariant (ADR-005), but it is knowable here:
   * we already hold every stop's sequence. Checking it client-side turns a 400
   * into a disabled button and an inline reason, instead of letting the
   * supervisor build an invalid selection and only learn on submit.
   */
  const selectedSeqs = run.stops
    .filter((s) => selected.has(s.id))
    .map((s) => s.sequence)
    .sort((a, b) => a - b);
  const contiguous =
    selectedSeqs.length === 0 ||
    selectedSeqs[selectedSeqs.length - 1]! - selectedSeqs[0]! === selectedSeqs.length - 1;

  function toggle(stopId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  }

  async function doReassign() {
    if (!reassignTo) return;
    setBusy(true);
    setActionError(null);
    try {
      const wasAssigned = Boolean(run?.readerId);
      setRun(await reassignRun(id, reassignTo));
      setMsg(`${wasAssigned ? 'Reassigned' : 'Assigned'} to ${readerName(reassignTo)}.`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'reassign failed');
      // Refetch on failure: the rejection is usually *because* the run moved
      // underneath this page, so the stale view is the least useful thing to
      // leave on screen.
      load();
    } finally {
      setBusy(false);
    }
  }

  async function doRelease() {
    setBusy(true);
    setActionError(null);
    try {
      setRun(await reassignRun(id, null));
      setReassignTo('');
      setMsg('Run released — it is now unassigned.');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'release failed');
      load();
    } finally {
      setBusy(false);
    }
  }

  async function doSplit() {
    if (!splitTo || selected.size === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await splitRun(id, { toReaderId: splitTo, stopIds: [...selected] });
      setRun(updated);
      setMsg(`Split ${selected.size} stop${selected.size === 1 ? '' : 's'} to ${readerName(splitTo)}.`);
      setSelected(new Set());
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'split failed — stops must be a contiguous pending range',
      );
      load();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <div>
        <Link href="/supervisor/runs" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>← All runs</Link>
        <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: '8px 0 0' }}>{run.routeName}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
          {run.clientName} · {run.runDate} · cycle {run.cycleId} · <span className="rw-badge">{run.status}</span>
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--rw-text-sm)' }}>
          Reader{' '}
          {run.readerId ? (
            <strong>{assigneeLabel(run)}</strong>
          ) : (
            <span className="rw-badge" style={{ color: 'var(--rw-warning)' }}>Unassigned</span>
          )}
          <span style={{ color: 'var(--rw-text-muted)' }}> · {run.completedCount}/{run.stopCount} done</span>
        </p>
      </div>

      {msg && (
        <div className="rw-card" style={{ background: 'var(--rw-success-bg)', borderColor: 'var(--rw-success)' }}>
          <span style={{ color: 'var(--rw-success)', fontWeight: 600, fontSize: 'var(--rw-text-sm)' }}>{msg}</span>
        </div>
      )}
      {actionError && (
        <div className="rw-card" style={{ borderColor: 'var(--rw-danger)' }}>
          <span style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)' }}>{actionError}</span>
        </div>
      )}

      <div className="rw-split">
        <section className="rw-card" style={{ padding: 0 }}>
          <h2 style={{ ...cardTitle, padding: 'var(--rw-space-4) var(--rw-space-4) 0' }}>
            Stops ({run.stops.length}) · select pending to split
          </h2>
          <div className="rw-rows" style={{ marginTop: 8 }}>
            {run.stops.map((s) => {
              const canSelect = s.status === 'pending';
              return (
                <label key={s.id} className="rw-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, cursor: canSelect ? 'pointer' : 'default' }}>
                  <input type="checkbox" disabled={!canSelect} checked={selected.has(s.id)} onChange={() => toggle(s.id)} style={{ width: 18, height: 18, flex: 'none' }} />
                  <span className="tabular" style={{ color: 'var(--rw-text-muted)', width: 28 }}>{s.sequence + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{s.meterSerial}</span>
                  <span style={{ color: STATUS_COLOR[s.status], fontSize: 'var(--rw-text-xs)', fontWeight: 600, textTransform: 'uppercase' }}>{s.status}</span>
                </label>
              );
            })}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
          <section className="rw-card">
            <h2 style={cardTitle}>Split to another reader</h2>
            <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', marginTop: 0 }}>
              {selected.size} pending stop{selected.size === 1 ? '' : 's'} selected. Only a contiguous range of pending stops can move; read/skipped never move.
            </p>
            <label><span className="rw-label">New reader</span>
              <select className="rw-input" value={splitTo} onChange={(e) => setSplitTo(e.target.value)}>
                <option value="">Select…</option>
                {readers.filter((r) => r.readerId !== run.readerId).map((r) => (
                  <option key={r.readerId} value={r.readerId}>{r.name}</option>
                ))}
              </select>
            </label>
            {!contiguous && (
              <p style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)', margin: '0 0 var(--rw-space-2)' }}>
                Stops {selectedSeqs[0]! + 1}–{selectedSeqs[selectedSeqs.length - 1]! + 1} aren&apos;t a
                contiguous range. Select an unbroken run of pending stops.
              </p>
            )}
            <button
              className="rw-button"
              style={{ marginTop: 'var(--rw-space-3)' }}
              disabled={busy || !splitTo || selected.size === 0 || !contiguous}
              onClick={doSplit}
            >
              Split {selected.size || ''} to reader
            </button>
          </section>

          <section className="rw-card">
            <h2 style={cardTitle}>{run.readerId ? 'Reassign whole run' : 'Assign this run'}</h2>
            {started ? (
              <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
                Run has started — use a split for mid-run changes.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: '0 0 var(--rw-space-3)' }}>
                  Currently {run.readerId ? `assigned to ${assigneeLabel(run)}` : 'unassigned'}.
                </p>
                <label><span className="rw-label">Reader</span>
                  <select className="rw-input" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                    <option value="">Select…</option>
                    {readers.filter((r) => r.readerId !== run.readerId).map((r) => (
                      <option key={r.readerId} value={r.readerId}>{r.name}</option>
                    ))}
                  </select>
                </label>
                <button className="rw-button rw-button--ghost" style={{ width: '100%', marginTop: 'var(--rw-space-3)' }} disabled={busy || !reassignTo} onClick={doReassign}>
                  {run.readerId ? 'Reassign run' : 'Assign run'}
                </button>
                {run.readerId && (
                  <button
                    className="rw-button rw-button--ghost"
                    style={{ width: '100%', marginTop: 'var(--rw-space-2)', color: 'var(--rw-danger)' }}
                    disabled={busy}
                    onClick={doRelease}
                  >
                    Release / unassign
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>
      <p style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', margin: 0 }}>
        {pending.length} stop{pending.length === 1 ? '' : 's'} still pending.
      </p>
    </div>
  );
}

const cardTitle: React.CSSProperties = { fontSize: 'var(--rw-text-sm)', fontWeight: 600, margin: '0 0 var(--rw-space-3)', color: 'var(--rw-text-secondary)' };
