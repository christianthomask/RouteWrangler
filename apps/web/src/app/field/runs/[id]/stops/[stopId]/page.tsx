'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  FieldMeterReadsResponse,
  MeResponse,
  RunDetail,
  RunStopView,
  TaxonomyResponse,
} from '@routewrangler/contracts';
import {
  DEFAULT_VALIDATION_CONFIG,
  EXCEPTION_META,
  runValidation,
  type ExceptionCode,
} from '@routewrangler/contracts';
import { fetchFieldMeterReads, fetchMe, fetchRun, fetchTaxonomy } from '@/lib/api';
import { useFieldQueue } from '@/lib/field/useFieldQueue';
import { RouteMapView } from '@/components/field/RouteMapView';
import type { MapStop } from '@/components/field/RouteMap';
import { Loading, EmptyState } from '@/components/ui';

type Gps = {
  state: 'acquiring' | 'ok' | 'denied' | 'unavailable';
  lat: number | null;
  lng: number | null;
};

const toTone = (s: RunStopView): MapStop['tone'] =>
  s.status === 'read' ? 'done' : s.status === 'skipped' ? 'skipped' : 'pending';

export default function CapturePage() {
  const { id, stopId } = useParams<{ id: string; stopId: string }>();
  const router = useRouter();
  const { enqueueRead, enqueueSkip } = useFieldQueue();

  const [run, setRun] = useState<RunDetail | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [meter, setMeter] = useState<FieldMeterReadsResponse | null>(null);
  const [historyOffline, setHistoryOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [gps, setGps] = useState<Gps>({ state: 'acquiring', lat: null, lng: null });
  const [photo, setPhoto] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * A stop that has already been read shows its captured value rather than an
   * empty form. Re-arming the form made a completed stop look untouched, and a
   * second submit is a *new* read event (ADR-008 keys idempotency on a
   * client-generated id, so it is not a duplicate) — which differences against
   * the first, lands at consumption 0, and reads as clean even when the first
   * read was flagged. Correcting a read is still possible, but has to be
   * deliberate.
   */
  const [recapture, setRecapture] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stop = useMemo(() => run?.stops.find((x) => x.id === stopId) ?? null, [run, stopId]);

  useEffect(() => {
    setRecapture(false);
  }, [stopId]);

  // Ordered stops → previous/next by sequence for step-through navigation.
  const ordered = useMemo(
    () => [...(run?.stops ?? [])].sort((a, b) => a.sequence - b.sequence),
    [run],
  );
  const idx = ordered.findIndex((s) => s.id === stopId);
  const prevStop = idx > 0 ? ordered[idx - 1] : null;
  const nextStop = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;

  useEffect(() => {
    // Guard against out-of-order resolution when stepping stops fast (M10): a
    // superseded fetch must not clobber the current stop's state.
    let ignore = false;
    fetchRun(id)
      .then((r) => {
        if (ignore) return;
        setRun(r);
        if (!r.stops.some((x) => x.id === stopId)) setError('stop not found');
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : 'failed');
      });
    fetchMe()
      .then((m) => !ignore && setMe(m))
      .catch(() => {});
    fetchTaxonomy()
      .then((t) => !ignore && setTaxonomy(t))
      .catch(() => {});

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          !ignore && setGps({ state: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => !ignore && setGps({ state: 'denied', lat: null, lng: null }),
        { timeout: 8000 },
      );
    } else {
      setGps({ state: 'unavailable', lat: null, lng: null });
    }
    return () => {
      ignore = true;
    };
  }, [id, stopId]);

  // Meter context (access notes + past reads) — network-dependent, non-blocking.
  useEffect(() => {
    if (!stop) return;
    // Same out-of-order guard as above — a slow read for a prior stop must not
    // land on the stop we've since navigated to (M10).
    let ignore = false;
    setMeter(null);
    setHistoryOffline(false);
    fetchFieldMeterReads(stop.meterId)
      .then((m) => !ignore && setMeter(m))
      .catch(() => !ignore && setHistoryOffline(true));
    return () => {
      ignore = true;
    };
  }, [stop]);

  /*
   * The reader's own workflow: a normal read needs no photo, a deviating read
   * must be photographed. Running the *server's* validation engine here — the
   * same pure rules ingestion applies (@routewrangler/contracts) — means the app
   * and the server can never disagree about which reads that covers.
   *
   * A reader standing at the meter can re-check a transposed digit in seconds.
   * The same mistake caught later costs an exception, a supervisor's time and a
   * second visit.
   */
  const anomalyCodes = ((): ExceptionCode[] => {
    if (!stop || !meter || value === '') return [];
    const n = Number(value);
    if (!Number.isFinite(n)) return [];
    const { exceptions } = runValidation({
      value: n,
      lat: gps.lat,
      lng: gps.lng,
      registerDials: stop.registerDials,
      // The engine wants oldest-first; the field history arrives most-recent-first.
      history: [...meter.reads]
        .reverse()
        .map((r) => ({ value: r.value, consumption: r.consumption })),
      config: DEFAULT_VALIDATION_CONFIG,
    });
    // Only the *reading* is evidenced by a photo of the meter. A missing GPS fix
    // or a duplicate stop is a different kind of problem and a photo says nothing
    // about either, so neither should force one.
    return exceptions.filter((c) => c !== 'location_absent' && c !== 'duplicate_mismatch');
  })();

  const photoRequired = anomalyCodes.length > 0;
  const photoMissing = photoRequired && !photo;

  if (error) return <EmptyState title="Couldn't open this stop" hint={error} />;
  if (!stop || !me) return <Loading />;

  async function submitRead() {
    if (!stop || !me || value === '') return;
    setBusy(true);
    setSubmitError(null);
    try {
      // The IndexedDB write can fail (e.g. quota exceeded). Surface it and reset
      // the button so the reader can retry rather than losing the capture to a
      // stuck "Saving…" state (M9). We only navigate away once it's persisted.
      await enqueueRead({
        meterId: stop.meterId,
        runStopId: stop.id,
        readerId: me.id,
        value: Number(value),
        capturedAt: new Date().toISOString(),
        lat: gps.lat,
        lng: gps.lng,
        note: note.trim() || null,
        photoDataUrl: photo,
      });
      router.push(`/field/runs/${id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Couldn't save on this device — try again.");
      setBusy(false);
    }
  }

  async function submitSkip(code: string) {
    if (!stop) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await enqueueSkip({ runId: id, stopId: stop.id, skipReasonCode: code });
      router.push(`/field/runs/${id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Couldn't save on this device — try again.");
      setBusy(false);
    }
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

  const mapStops: MapStop[] = ordered.map((s) => ({
    id: s.id,
    sequence: s.sequence,
    lat: s.lat,
    lng: s.lng,
    tone: toTone(s),
  }));
  const hasCoords = stop.lat != null && stop.lng != null;
  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <div>
        <button
          onClick={() => router.push(`/field/runs/${id}`)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--rw-text-muted)',
            fontSize: 'var(--rw-text-sm)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ← Run
        </button>
        <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: '6px 0 0' }}>{stop.meterSerial}</h1>
        <p
          style={{
            margin: '2px 0 0',
            color: 'var(--rw-text-muted)',
            fontSize: 'var(--rw-text-sm)',
          }}
        >
          {stop.serviceAddress}
        </p>
        <p
          style={{
            margin: '2px 0 0',
            color: 'var(--rw-text-muted)',
            fontSize: 'var(--rw-text-xs)',
          }}
        >
          Stop {stop.sequence + 1} of {ordered.length} · last read {stop.lastValue ?? '—'} ·{' '}
          {stop.registerDials}-dial
        </p>
      </div>

      {/* ── navigation: prev/next stepping + current→next map + directions ── */}
      <div
        className="rw-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)' }}
      >
        <RouteMapView
          stops={mapStops}
          currentId={stop.id}
          nextId={nextStop?.id}
          focus="current"
          height={170}
        />
        <div style={{ display: 'flex', gap: 'var(--rw-space-2)' }}>
          <button
            className="rw-button rw-button--ghost"
            style={{ flex: 1 }}
            disabled={!prevStop}
            onClick={() => prevStop && router.push(`/field/runs/${id}/stops/${prevStop.id}`)}
          >
            ← Prev
          </button>
          <button
            className="rw-button rw-button--ghost"
            style={{ flex: 1 }}
            disabled={!nextStop}
            onClick={() => nextStop && router.push(`/field/runs/${id}/stops/${nextStop.id}`)}
          >
            Next →
          </button>
        </div>
        {directionsUrl && (
          <a
            className="rw-button rw-button--ghost"
            style={{ width: '100%', textDecoration: 'none', textAlign: 'center' }}
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
          >
            Directions to this stop ↗
          </a>
        )}
        {nextStop && (
          <p style={{ margin: 0, fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
            Next: #{nextStop.sequence + 1} · {nextStop.meterSerial} — {nextStop.serviceAddress}
          </p>
        )}
      </div>

      {/* ── access notes (standing meter guidance) ── */}
      {meter?.accessNotes && (
        <div
          className="rw-card"
          style={{
            borderLeft: '3px solid var(--rw-brand)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <span className="rw-label" style={{ margin: 0 }}>
            Access notes
          </span>
          <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)' }}>{meter.accessNotes}</p>
        </div>
      )}

      {skipping ? (
        <div
          className="rw-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)' }}
        >
          <h2
            style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)', margin: 0 }}
          >
            Skip reason
          </h2>
          {(taxonomy?.skipReasons ?? []).map((r) => (
            <button
              key={r.code}
              className="rw-button rw-button--ghost"
              style={{ width: '100%' }}
              disabled={busy}
              onClick={() => submitSkip(r.code)}
            >
              {r.label}
            </button>
          ))}
          <button
            className="rw-button rw-button--ghost"
            style={{ width: '100%', color: 'var(--rw-text-muted)' }}
            onClick={() => setSkipping(false)}
          >
            Cancel
          </button>
        </div>
      ) : stop.status !== 'pending' && !recapture ? (
        <div
          className="rw-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-3)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rw-space-2)' }}>
            <span
              style={{
                color: stop.status === 'read' ? 'var(--rw-success)' : 'var(--rw-warning)',
                fontWeight: 'var(--rw-weight-semibold)',
              }}
            >
              {stop.status === 'read' ? 'Read captured' : 'Stop skipped'}
            </span>
          </div>
          {stop.status === 'read' ? (
            <p className="tabular" style={{ fontSize: 'var(--rw-text-2xl)', fontWeight: 600, margin: 0 }}>
              {stop.lastValue ?? '—'}
            </p>
          ) : (
            // The reader's own reason, so they can judge whether it still holds
            // — "Stop skipped" alone left them guessing.
            <p style={{ fontSize: 'var(--rw-text-base)', margin: 0 }}>
              {(taxonomy?.skipReasons ?? []).find((r) => r.code === stop.skipReasonCode)?.label ??
                stop.skipReasonCode ??
                'Reason not recorded'}
            </p>
          )}
          <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
            {stop.status === 'read'
              ? 'You’ve already done this stop. Only capture again if the reading above is wrong — it records a new read and becomes the reading of record.'
              : 'You skipped this stop. If you can reach the meter now, capture the reading and it will complete the stop.'}
          </p>
          <button
            className="rw-button rw-button--ghost"
            style={{ width: '100%' }}
            onClick={() => setRecapture(true)}
          >
            {stop.status === 'read' ? 'Re-capture reading' : 'Capture reading'}
          </button>
        </div>
      ) : (
        <div
          className="rw-card"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}
        >
          {recapture && (
            <p
              style={{
                fontSize: 'var(--rw-text-sm)',
                color: 'var(--rw-warning)',
                background: 'var(--rw-surface-2)',
                border: '1px solid var(--rw-border)',
                borderRadius: 'var(--rw-radius)',
                padding: '0.6rem 0.75rem',
                margin: 0,
              }}
            >
              {stop.status === 'skipped'
                ? 'Capturing a reading here will complete this skipped stop.'
                : 'Re-capturing — this reading replaces the one on record for this stop.'}
            </p>
          )}
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

          <label>
            <span className="rw-label">Note (optional)</span>
            <textarea
              className="rw-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth recording — leak, obstruction, hard-to-read dial…"
              rows={2}
              maxLength={1000}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </label>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--rw-text-sm)',
              color: gpsLabel.c,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: gpsLabel.c,
                flex: 'none',
              }}
            />
            {gpsLabel.t}
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhoto}
              style={{ display: 'none' }}
            />
            <button
              className="rw-button rw-button--ghost"
              style={{ width: '100%' }}
              onClick={() => fileRef.current?.click()}
            >
              {photo ? 'Photo attached ✓ — retake' : 'Attach photo (optional)'}
            </button>
          </div>

          {photoRequired && (
            <p
              style={{
                margin: 0,
                fontSize: 'var(--rw-text-sm)',
                color: photoMissing ? 'var(--rw-warning)' : 'var(--rw-text-secondary)',
                background: 'var(--rw-surface-2)',
                border: '1px solid var(--rw-border)',
                borderRadius: 'var(--rw-radius)',
                padding: '0.6rem 0.75rem',
              }}
            >
              {photoMissing ? 'Photo required — ' : 'Photo attached ✓ — '}
              this reading is outside the normal range for this meter (
              {anomalyCodes.map((c) => EXCEPTION_META[c].label.toLowerCase()).join(', ')}). Check the
              dials, then photograph them.
            </p>
          )}
          <button
            className="rw-button"
            disabled={busy || value === '' || photoMissing}
            onClick={submitRead}
          >
            {busy ? 'Saving…' : photoMissing ? 'Attach a photo to continue' : 'Capture read'}
          </button>
          <button
            className="rw-button rw-button--ghost"
            style={{ width: '100%', color: 'var(--rw-warning)' }}
            onClick={() => setSkipping(true)}
          >
            Skip this stop
          </button>
          <p
            style={{
              fontSize: 'var(--rw-text-xs)',
              color: 'var(--rw-text-muted)',
              margin: 0,
              textAlign: 'center',
            }}
          >
            Saved to your device immediately; syncs when you&apos;re online.
          </p>
        </div>
      )}

      {submitError && (
        <p
          role="alert"
          style={{
            margin: 0,
            color: 'var(--rw-danger)',
            fontSize: 'var(--rw-text-sm)',
            background: 'var(--rw-surface-2)',
            border: '1px solid var(--rw-border)',
            borderRadius: 'var(--rw-radius)',
            padding: '0.6rem 0.75rem',
          }}
        >
          {submitError}
        </p>
      )}

      {/* ── past reads + their notes ── */}
      <div className="rw-card" style={{ padding: 0 }}>
        <div
          style={{
            padding: 'var(--rw-space-3) var(--rw-space-4)',
            borderBottom: '1px solid var(--rw-border)',
          }}
        >
          <span className="rw-label" style={{ margin: 0 }}>
            Past reads
          </span>
        </div>
        {!meter && !historyOffline ? (
          <p
            style={{
              padding: 'var(--rw-space-4)',
              margin: 0,
              color: 'var(--rw-text-muted)',
              fontSize: 'var(--rw-text-sm)',
            }}
          >
            Loading…
          </p>
        ) : historyOffline ? (
          <p
            style={{
              padding: 'var(--rw-space-4)',
              margin: 0,
              color: 'var(--rw-text-muted)',
              fontSize: 'var(--rw-text-sm)',
            }}
          >
            History unavailable offline.
          </p>
        ) : meter && meter.reads.length === 0 ? (
          <p
            style={{
              padding: 'var(--rw-space-4)',
              margin: 0,
              color: 'var(--rw-text-muted)',
              fontSize: 'var(--rw-text-sm)',
            }}
          >
            No reads on record yet.
          </p>
        ) : (
          <div className="rw-rows">
            {meter?.reads.map((r) => (
              <div
                key={r.id}
                className="rw-row"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  <strong className="tabular">{r.value}</strong>
                  <span style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                    {new Date(r.capturedAt).toLocaleDateString()}
                    {r.consumption != null && ` · ${r.consumption < 0 ? '' : '+'}${r.consumption}`}
                  </span>
                </div>
                {r.note && (
                  <div style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>
                    “{r.note}”
                  </div>
                )}
                <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                  {r.readerName}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
