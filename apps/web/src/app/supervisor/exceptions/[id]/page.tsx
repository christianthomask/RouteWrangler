'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ExceptionDetail, ReadEventView } from '@routewrangler/contracts';
import {
  fetchExceptionDetail,
  orderReread,
  overrideException,
  resolveException,
} from '@/lib/api';
import { SeverityChip, StatusBadge, Loading, EmptyState, num } from '@/components/ui';
import { ConsumptionChart } from '@/components/charts/ConsumptionChart';
import { GpsCompare } from '@/components/GpsCompare';

export default function ExceptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<ExceptionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchExceptionDetail(id)
      .then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [id]);

  if (error) return <EmptyState title="Couldn't load this exception" hint={error} />;
  if (!d) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <div>
        <Link href="/supervisor/exceptions" style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>
          ← Exception queue
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SeverityChip severity={d.severityCode} />
            <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>{d.typeLabel}</h1>
            <StatusBadge status={d.status} />
          </div>
          <div style={{ textAlign: 'right', fontSize: 'var(--rw-text-sm)' }}>
            <div style={{ fontWeight: 600 }}>{d.meter.serial}</div>
            <div style={{ color: 'var(--rw-text-muted)' }}>{d.client.name} · {d.meter.serviceAddress}</div>
          </div>
        </div>
      </div>

      <div className="rw-split">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
          {/* A skip has no reading, so the chart and read cards have nothing to
              show — the reason and its photograph are the evidence instead. */}
          {d.skip ? (
            <section className="rw-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-3)' }}>
              <h2 style={cardTitle}>Why this stop was skipped</h2>
              <p style={{ fontSize: 'var(--rw-text-xl)', fontWeight: 600, margin: 0 }}>
                {d.skip.reasonLabel ?? d.skip.reasonCode ?? 'Reason not recorded'}
              </p>
              <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', margin: 0 }}>
                Skipped by {d.skip.readerName ?? 'an unknown reader'} ·{' '}
                {new Date(d.skip.skippedAt).toLocaleString()}
              </p>
              <Link
                href={`/supervisor/runs/${d.skip.runId}`}
                style={{ fontSize: 'var(--rw-text-sm)' }}
              >
                Open the run →
              </Link>
            </section>
          ) : (
            <>
              <section className="rw-card">
                <h2 style={cardTitle}>Consumption — last 12 months</h2>
                <ConsumptionChart points={d.consumptionSeries} flaggedSeverity={d.severityCode} />
                <ReadingInContext detail={d} />
              </section>

              <section className="rw-card">
                <h2 style={cardTitle}>{d.rereads.length ? 'Reads — original vs reread' : 'Flagged read'}</h2>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${1 + d.rereads.length}, minmax(0,1fr))`, gap: 'var(--rw-space-3)' }}>
                  {d.flaggedRead && (
                    <ReadCard label="Original" read={d.flaggedRead} certified={d.certifiedReadEventId === d.flaggedRead.id} />
                  )}
                  {d.rereads.map((r, i) => (
                    <ReadCard key={r.id} label={`Reread ${i + 1}`} read={r} certified={d.certifiedReadEventId === r.id} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
          {d.flaggedRead && (
            <section className="rw-card">
              <h2 style={cardTitle}>Location</h2>
              <GpsCompare meterLat={d.meter.lat} meterLng={d.meter.lng} captureLat={d.flaggedRead.lat} captureLng={d.flaggedRead.lng} />
            </section>
          )}

          <section className="rw-card">
            <h2 style={cardTitle}>{d.skip ? 'Photo of the reason' : 'Photo'}</h2>
            <PhotoBlock url={d.skip ? d.skip.photoUrl : (d.flaggedRead?.photoUrl ?? null)} />
          </section>

          {d.meter.accessNotes && (
            <section className="rw-card" style={{ background: 'var(--rw-sev-medium-bg)' }}>
              <h2 style={cardTitle}>Access notes</h2>
              <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)' }}>{d.meter.accessNotes}</p>
            </section>
          )}

          <ActionBar detail={d} onDone={setD} />
        </div>
      </div>
    </div>
  );
}

function ReadCard({ label, read, certified }: { label: string; read: ReadEventView; certified: boolean }) {
  return (
    <div style={{ border: `1px solid ${certified ? 'var(--rw-success)' : 'var(--rw-border)'}`, borderRadius: 'var(--rw-radius)', padding: 'var(--rw-space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
        {certified && <span className="rw-badge" style={{ color: 'var(--rw-success)' }}>Billable</span>}
      </div>
      <div className="tabular" style={{ fontSize: 'var(--rw-text-2xl)', fontWeight: 600, marginTop: 4 }}>{num(read.value)}</div>
      <div style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>consumption {num(read.consumption)}</div>
      <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', marginTop: 6 }}>
        {new Date(read.capturedAt).toLocaleString()} · {read.sourceType}
      </div>
      {read.annotations?.rollover ? <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-brand)' }}>rollover annotated</div> : null}
    </div>
  );
}

function PhotoBlock({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div style={{ color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)', textAlign: 'center', padding: 'var(--rw-space-6)', border: '1px dashed var(--rw-border)', borderRadius: 'var(--rw-radius)' }}>
        No photo attached
      </div>
    );
  }
  return <img src={url} alt="Meter read" style={{ width: '100%', borderRadius: 'var(--rw-radius)', border: '1px solid var(--rw-border)' }} />;
}

function ActionBar({ detail, onDone }: { detail: ExceptionDetail; onDone: (d: ExceptionDetail) => void }) {
  const [note, setNote] = useState('');
  // A skip has no reading, so there is nothing to certify as billable.
  const [certified, setCertified] = useState(detail.flaggedRead?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allow = detail.allowedActions;

  if (allow.length === 0) {
    return (
      <section className="rw-card">
        <h2 style={cardTitle}>Resolution</h2>
        <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)' }}>
          <StatusBadge status={detail.status} />
        </p>
        {detail.resolutionNote && <p style={{ fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-secondary)' }}>“{detail.resolutionNote}”</p>}
      </section>
    );
  }

  async function run(fn: () => Promise<ExceptionDetail>, needsNote: boolean) {
    if (needsNote && !note.trim()) {
      setErr('A note is required.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      onDone(await fn());
      setNote('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
    }
  }

  const hasRereads = detail.rereads.length > 0;

  return (
    <section className="rw-card">
      <h2 style={cardTitle}>Take action</h2>
      {hasRereads && (allow.includes('resolve') || allow.includes('override')) && (
        <label style={{ display: 'block', marginBottom: 'var(--rw-space-3)' }}>
          <span className="rw-label">Certify as billable</span>
          <select className="rw-input" value={certified} onChange={(e) => setCertified(e.target.value)}>
            {detail.flaggedRead && (
              <option value={detail.flaggedRead.id}>Original — {num(detail.flaggedRead.value)}</option>
            )}
            {detail.rereads.map((r, i) => (
              <option key={r.id} value={r.id}>Reread {i + 1} — {num(r.value)}</option>
            ))}
          </select>
        </label>
      )}
      <label style={{ display: 'block' }}>
        <span className="rw-label">Note {allow.some((a) => a !== 'reread') ? '(required to resolve or override)' : ''}</span>
        <textarea className="rw-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this decision…" />
      </label>
      {err && <p style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)', margin: '8px 0 0' }}>{err}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)', marginTop: 'var(--rw-space-3)' }}>
        {allow.includes('reread') ? (
          <button className="rw-button" disabled={busy} onClick={() => run(() => orderReread(detail.id, note || undefined), false)}>
            Order reread ({detail.rereadCount}/2)
          </button>
        ) : (
          /*
           * At the cap the button used to disappear outright, so a supervisor
           * returning to a case simply found the option gone with no reason.
           * Show it disabled and say why instead.
           */
          detail.rereadCount >= 2 && (
            <>
              <button className="rw-button" disabled>
                Reread limit reached (2/2)
              </button>
              {/* Inline, not a title tooltip — invisible on touch, and this is a
                  phone-first console (ADR-018). Matches the split button. */}
              <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>
                Two rereads have already been ordered. Resolve or accept this exception instead.
              </p>
            </>
          )
        )}
        {allow.includes('resolve') && (
          <button className="rw-button rw-button--ghost" style={{ width: '100%' }} disabled={busy}
            onClick={() => run(() => resolveException(detail.id, { note, ...(certified ? { certifiedReadEventId: certified } : {}) }), true)}>
            Resolve
          </button>
        )}
        {allow.includes('override') && (
          <button className="rw-button rw-button--ghost" style={{ width: '100%' }} disabled={busy}
            onClick={() => run(() => overrideException(detail.id, { note, ...(certified ? { certifiedReadEventId: certified } : {}) }), true)}>
            Accept / override
          </button>
        )}
        {/*
          * Escalate is deliberately not offered. There is no further tier beyond
          * the supervisor today, so the action had no destination — an escalated
          * item left the exception queue and joined nothing. The status, the
          * endpoint and escalateException() all remain, so restoring the button
          * is a one-line change once the escalation policy is settled.
          */}
      </div>
    </section>
  );
}

const cardTitle: React.CSSProperties = { fontSize: 'var(--rw-text-sm)', fontWeight: 600, margin: '0 0 var(--rw-space-3)', color: 'var(--rw-text-secondary)' };


/**
 * The numbers a supervisor needs to decide whether to believe a read, all
 * derived from the series already on the payload.
 *
 * The screen used to show the entered value and the consumption but never the
 * *previous* read — so checking the arithmetic meant subtracting by hand — and
 * named the severity without ever saying what normal looked like or by how much
 * this read missed it. "Critical" is a conclusion; this is the evidence.
 */
function ReadingInContext({ detail }: { detail: ExceptionDetail }) {
  if (!detail.flaggedRead) return null;
  const series = detail.consumptionSeries;
  const flaggedAt = series.findIndex((p) => p.flagged);
  const previous = flaggedAt > 0 ? series[flaggedAt - 1] : undefined;

  const priorConsumption = series
    .filter((p, i) => !p.flagged && i < (flaggedAt === -1 ? series.length : flaggedAt))
    .map((p) => p.consumption)
    .filter((c): c is number => c != null);

  const baseline = priorConsumption.length
    ? priorConsumption.reduce((a, b) => a + b, 0) / priorConsumption.length
    : null;

  const flagged = detail.flaggedRead;
  // Only meaningful against a positive baseline; a decrease is a different story
  // that the type code (negative consumption / rollover) already tells.
  const multiple =
    baseline && baseline > 0 && flagged.consumption != null && flagged.consumption > 0
      ? flagged.consumption / baseline
      : null;

  const items: Array<{ label: string; value: string }> = [
    { label: 'Previous read', value: previous ? num(previous.value) : '—' },
    { label: 'This read', value: num(flagged.value) },
    { label: 'Consumption', value: flagged.consumption == null ? '—' : num(flagged.consumption) },
    {
      label: `Typical (${priorConsumption.length} mo)`,
      value: baseline == null ? '—' : num(Math.round(baseline)),
    },
  ];

  return (
    <div style={{ marginTop: 'var(--rw-space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-3)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
          gap: 'var(--rw-space-3)',
        }}
      >
        {items.map((it) => (
          <div key={it.label}>
            <div className="rw-label">{it.label}</div>
            <div className="tabular" style={{ fontSize: 'var(--rw-text-lg)', fontWeight: 'var(--rw-weight-semibold)' }}>
              {it.value}
            </div>
          </div>
        ))}
      </div>

      {multiple != null && multiple >= 2 && (
        <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)', color: 'var(--rw-danger)' }}>
          {multiple >= 10 ? Math.round(multiple) : Math.round(multiple * 10) / 10}× the typical
          monthly consumption for this meter.
        </p>
      )}

      <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)' }}>
        Read by {flagged.readerName ?? 'an unknown reader'}
        {flagged.lat == null || flagged.lng == null ? ' · no GPS captured' : ''}
      </p>
    </div>
  );
}
