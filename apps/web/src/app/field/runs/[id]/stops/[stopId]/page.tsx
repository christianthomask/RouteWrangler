'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { MeResponse, RunStopView, TaxonomyResponse } from '@routewrangler/contracts';
import { fetchMe, fetchRun, fetchTaxonomy } from '@/lib/api';
import { useFieldQueue } from '@/lib/field/useFieldQueue';
import { Loading, EmptyState } from '@/components/ui';

type Gps = { state: 'acquiring' | 'ok' | 'denied' | 'unavailable'; lat: number | null; lng: number | null };

export default function CapturePage() {
  const { id, stopId } = useParams<{ id: string; stopId: string }>();
  const router = useRouter();
  const { enqueueRead, enqueueSkip } = useFieldQueue();

  const [stop, setStop] = useState<RunStopView | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [value, setValue] = useState('');
  const [gps, setGps] = useState<Gps>({ state: 'acquiring', lat: null, lng: null });
  const [photo, setPhoto] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchRun(id)
      .then((run) => {
        const s = run.stops.find((x) => x.id === stopId);
        if (!s) setError('stop not found');
        else setStop(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    fetchMe().then(setMe).catch(() => {});
    fetchTaxonomy().then(setTaxonomy).catch(() => {});

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGps({ state: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setGps({ state: 'denied', lat: null, lng: null }),
        { timeout: 8000 },
      );
    } else {
      setGps({ state: 'unavailable', lat: null, lng: null });
    }
  }, [id, stopId]);

  if (error) return <EmptyState title="Couldn't open this stop" hint={error} />;
  if (!stop || !me) return <Loading />;

  async function submitRead() {
    if (!stop || !me || value === '') return;
    setBusy(true);
    await enqueueRead({
      meterId: stop.meterId,
      runStopId: stop.id,
      readerId: me.id,
      value: Number(value),
      capturedAt: new Date().toISOString(),
      lat: gps.lat,
      lng: gps.lng,
      photoDataUrl: photo,
    });
    router.push(`/field/runs/${id}`);
  }

  async function submitSkip(code: string) {
    if (!stop) return;
    setBusy(true);
    await enqueueSkip({ runId: id, stopId: stop.id, skipReasonCode: code });
    router.push(`/field/runs/${id}`);
  }

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  const gpsLabel = {
    acquiring: { t: 'Acquiring GPS…', c: 'var(--rw-text-muted)' },
    ok: { t: 'GPS acquired', c: 'var(--rw-success)' },
    denied: { t: 'GPS denied — recorded as location-absent', c: 'var(--rw-sev-low)' },
    unavailable: { t: 'GPS unavailable — location-absent', c: 'var(--rw-sev-low)' },
  }[gps.state];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <div>
        <button onClick={() => router.push(`/field/runs/${id}`)} style={{ background: 'none', border: 'none', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', cursor: 'pointer', padding: 0 }}>
          ← Run
        </button>
        <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: '6px 0 0' }}>{stop.meterSerial}</h1>
        <p style={{ margin: '2px 0 0', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
          Last read {stop.lastValue ?? '—'} · {stop.registerDials}-dial register
        </p>
      </div>

      {skipping ? (
        <div className="rw-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)' }}>
          <h2 style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)', margin: 0 }}>Skip reason</h2>
          {(taxonomy?.skipReasons ?? []).map((r) => (
            <button key={r.code} className="rw-button rw-button--ghost" style={{ width: '100%' }} disabled={busy} onClick={() => submitSkip(r.code)}>
              {r.label}
            </button>
          ))}
          <button className="rw-button rw-button--ghost" style={{ width: '100%', color: 'var(--rw-text-muted)' }} onClick={() => setSkipping(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="rw-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
          <label>
            <span className="rw-label">Meter reading</span>
            <input
              className="rw-input"
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter the value shown on the meter"
              style={{ fontSize: 'var(--rw-text-2xl)', fontWeight: 600 }}
              autoFocus
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--rw-text-sm)', color: gpsLabel.c }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: gpsLabel.c, flex: 'none' }} />
            {gpsLabel.t}
          </div>

          <div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
            <button className="rw-button rw-button--ghost" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
              {photo ? 'Photo attached ✓ — retake' : 'Attach photo (optional)'}
            </button>
          </div>

          <button className="rw-button" disabled={busy || value === ''} onClick={submitRead}>
            {busy ? 'Saving…' : 'Capture read'}
          </button>
          <button className="rw-button rw-button--ghost" style={{ width: '100%', color: 'var(--rw-warning)' }} onClick={() => setSkipping(true)}>
            Skip this stop
          </button>
          <p style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', margin: 0, textAlign: 'center' }}>
            Saved to your device immediately; syncs when you&apos;re online.
          </p>
        </div>
      )}
    </div>
  );
}
