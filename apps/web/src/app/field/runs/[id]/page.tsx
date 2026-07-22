'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { RunDetail, RunStopView } from '@routewrangler/contracts';
import { useRouter } from 'next/navigation';
import { fetchRun } from '@/lib/api';
import { useFieldQueue } from '@/lib/field/useFieldQueue';
import type { QueuedAction } from '@/lib/field/types';
import { RouteMapView } from '@/components/field/RouteMapView';
import type { MapStop } from '@/components/field/RouteMap';
import { warmRouteTiles } from '@/lib/field/mapCache';
import { EmptyState, Loading } from '@/components/ui';

/** Per-stop display state, merging server truth with the local queue. */
function stopState(stop: RunStopView, action: QueuedAction | undefined): { label: string; color: string; done: boolean } {
  if (stop.status === 'read') return { label: 'Read', color: 'var(--rw-sync-synced)', done: true };
  if (stop.status === 'skipped') return { label: 'Skipped', color: 'var(--rw-warning)', done: true };
  if (action) {
    const map: Record<string, string> = {
      pending: 'Queued',
      syncing: 'Syncing',
      synced: 'Synced',
      failed: 'Failed',
    };
    const color =
      action.state === 'failed'
        ? 'var(--rw-sync-failed)'
        : action.state === 'synced'
          ? 'var(--rw-sync-synced)'
          : 'var(--rw-sync-pending)';
    return { label: map[action.state]!, color, done: action.state === 'synced' };
  }
  return { label: 'Pending', color: 'var(--rw-text-muted)', done: false };
}

export default function FieldRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { actions } = useFieldQueue();

  useEffect(() => {
    fetchRun(id)
      .then((r) => {
        setRun(r);
        // Warm this route's basemap tiles for offline use while we still have
        // signal (no-op until tiles are configured; best-effort otherwise).
        void warmRouteTiles(r.stops);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [id]);

  if (error) return <EmptyState title="Couldn't load this run" hint={error} />;
  if (!run) return <Loading />;

  const actionByStop = new Map<string, QueuedAction>();
  for (const a of actions) {
    const stopId = a.read?.runStopId ?? a.skip?.stopId;
    if (stopId) actionByStop.set(stopId, a);
  }

  const done = run.stops.filter((s) => stopState(s, actionByStop.get(s.id)).done).length;
  const pct = run.stops.length ? Math.round((done / run.stops.length) * 100) : 0;

  const ordered = [...run.stops].sort((a, b) => a.sequence - b.sequence);
  const currentStop = ordered.find((s) => !stopState(s, actionByStop.get(s.id)).done);
  const mapStops: MapStop[] = ordered.map((s) => {
    const st = stopState(s, actionByStop.get(s.id));
    const tone: MapStop['tone'] = s.status === 'skipped' ? 'skipped' : st.done ? 'done' : 'pending';
    return { id: s.id, sequence: s.sequence, lat: s.lat, lng: s.lng, tone };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <div>
        <Link href="/field" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>← Today</Link>
        <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: '6px 0 0' }}>{run.routeName}</h1>
        <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', marginTop: 2 }}>
          {run.clientName} · {run.runDate} · cycle {run.cycleId}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <div style={{ flex: 1, height: 8, background: 'var(--rw-surface-3)', borderRadius: 999 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--rw-brand)', borderRadius: 999 }} />
          </div>
          <span className="tabular" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>{done}/{run.stops.length}</span>
        </div>
      </div>

      {/*
        * Rejected captures, stated plainly. A read the server refuses is not on
        * record, but submitting navigated straight back here and showed only a
        * transient "1 failed" count — so a reader could finish a route believing
        * stops were done that hold no reading at all.
        */}
      {[...actionByStop.entries()]
        .filter(([, a]) => a.state === 'failed')
        .map(([stopId, a]) => {
          const stop = run.stops.find((x) => x.id === stopId);
          return (
            <button
              key={stopId}
              className="rw-card"
              onClick={() => router.push(`/field/runs/${id}/stops/${stopId}`)}
              style={{
                textAlign: 'left',
                width: '100%',
                border: '1px solid var(--rw-danger)',
                background: 'var(--rw-danger-bg)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <strong style={{ color: 'var(--rw-danger)' }}>
                {stop?.meterSerial ?? 'A stop'} — not recorded
              </strong>
              <span style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>
                {a.error ?? 'The server rejected this reading.'} Tap to capture it again.
              </span>
            </button>
          );
        })}

      <div className="rw-card">
        <RouteMapView
          stops={mapStops}
          currentId={currentStop?.id}
          focus="route"
          height={200}
          onSelect={(sid) => router.push(`/field/runs/${id}/stops/${sid}`)}
        />
      </div>

      <div className="rw-card" style={{ padding: 0 }}>
        <div className="rw-rows">
          {run.stops.map((s) => {
            const st = stopState(s, actionByStop.get(s.id));
            const tappable = !st.done && st.label !== 'Syncing';
            const inner = (
              <>
                <span className="tabular" style={{ color: 'var(--rw-text-muted)', width: 26, flex: 'none' }}>{s.sequence + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{s.meterSerial}</div>
                  <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.serviceAddress}
                  </div>
                  <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                    last read {s.lastValue ?? '—'}
                  </div>
                </span>
                <span style={{ color: st.color, fontSize: 'var(--rw-text-xs)', fontWeight: 600, textTransform: 'uppercase' }}>{st.label}</span>
              </>
            );
            return tappable ? (
              <Link key={s.id} href={`/field/runs/${id}/stops/${s.id}`} className="rw-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
                {inner}
              </Link>
            ) : (
              <div key={s.id} className="rw-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'default' }}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
