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
  const [error, setError] = useState<string | null>(null);
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

  if (error) return <EmptyState title="Couldn't load this run" hint={error} />;
  if (!run) return <Loading />;

  const started = run.stops.some((s) => s.status !== 'pending');
  const pending = run.stops.filter((s) => s.status === 'pending');

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
    setError(null);
    try {
      setRun(await reassignRun(id, reassignTo));
      setMsg(`Reassigned to ${readerName(reassignTo)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reassign failed');
    } finally {
      setBusy(false);
    }
  }

  async function doSplit() {
    if (!splitTo || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await splitRun(id, { toReaderId: splitTo, stopIds: [...selected] });
      setRun(updated);
      setMsg(`Split ${selected.size} stop${selected.size === 1 ? '' : 's'} to ${readerName(splitTo)}.`);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'split failed — stops must be a contiguous pending range');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <div>
        <Link href="/supervisor" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>← Dashboard</Link>
        <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: '8px 0 0' }}>Run · {run.runDate}</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
          Reader {readerName(run.readerId)} · cycle {run.cycleId} · <span className="rw-badge">{run.status}</span>
        </p>
      </div>

      {msg && (
        <div className="rw-card" style={{ background: 'var(--rw-success-bg)', borderColor: 'var(--rw-success)' }}>
          <span style={{ color: 'var(--rw-success)', fontWeight: 600, fontSize: 'var(--rw-text-sm)' }}>{msg}</span>
        </div>
      )}
      {error && <div className="rw-card"><span style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)' }}>{error}</span></div>}

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
            <button className="rw-button" style={{ marginTop: 'var(--rw-space-3)' }} disabled={busy || !splitTo || selected.size === 0} onClick={doSplit}>
              Split {selected.size || ''} to reader
            </button>
          </section>

          <section className="rw-card">
            <h2 style={cardTitle}>Reassign whole run</h2>
            {started ? (
              <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
                Run has started — use a split for mid-run changes.
              </p>
            ) : (
              <>
                <label><span className="rw-label">Reader</span>
                  <select className="rw-input" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                    <option value="">Select…</option>
                    {readers.filter((r) => r.readerId !== run.readerId).map((r) => (
                      <option key={r.readerId} value={r.readerId}>{r.name}</option>
                    ))}
                  </select>
                </label>
                <button className="rw-button rw-button--ghost" style={{ width: '100%', marginTop: 'var(--rw-space-3)' }} disabled={busy || !reassignTo} onClick={doReassign}>
                  Reassign run
                </button>
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
