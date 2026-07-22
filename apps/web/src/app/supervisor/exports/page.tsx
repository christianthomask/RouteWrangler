'use client';

import { useEffect, useState } from 'react';
import type { ClientSummary, ExportListResponse, ExportPreview, ExportRunView } from '@routewrangler/contracts';
import {
  downloadExport,
  fetchClients,
  fetchExportCycles,
  fetchExportPreview,
  fetchExports,
  runExport,
} from '@/lib/api';
import { Loading } from '@/components/ui';

export default function ExportsPage() {
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [cycles, setCycles] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [history, setHistory] = useState<ExportRunView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchClients()
      .then(async (r) => {
        if (!active) return;
        setClients(r.clients);
        /*
         * Land on a client that actually has something to export. Defaulting to
         * the first alphabetically opened the page on "No cycles / No runs for
         * this client yet", which reads as a broken screen rather than an empty
         * client. Probing is bounded and only runs once, on mount.
         */
        for (const c of r.clients.slice(0, 8)) {
          try {
            const { cycles } = await fetchExportCycles(c.id);
            if (!active) return;
            if (cycles.length) {
              setClientId(c.id);
              return;
            }
          } catch {
            /* try the next client */
          }
        }
        if (active && r.clients[0]) setClientId(r.clients[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
    return () => {
      active = false;
    };
  }, []);

  // When the client changes, load its cycles + export history.
  useEffect(() => {
    if (!clientId) return;
    setPreview(null);
    fetchExportCycles(clientId).then((r) => {
      setCycles(r.cycles);
      setCycleId(r.cycles[0] ?? '');
    }).catch(() => setCycles([]));
    refreshHistory(clientId);
  }, [clientId]);

  // Preview whenever client+cycle is set.
  useEffect(() => {
    if (!clientId || !cycleId) return;
    setPreview(null);
    fetchExportPreview(clientId, cycleId)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [clientId, cycleId]);

  function refreshHistory(cid: string) {
    fetchExports(cid).then((r: ExportListResponse) => setHistory(r.exports)).catch(() => setHistory([]));
  }

  async function onGenerate() {
    if (!clientId || !cycleId) return;
    setBusy(true);
    setError(null);
    try {
      await runExport(clientId, cycleId);
      const [p] = await Promise.all([fetchExportPreview(clientId, cycleId)]);
      setPreview(p);
      refreshHistory(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export failed');
    } finally {
      setBusy(false);
    }
  }

  if (error && !clients) return <div className="rw-card"><p style={{ color: 'var(--rw-danger)', margin: 0 }}>{error}</p></div>;
  if (!clients) return <Loading />;

  const c = preview?.counts;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
      <div>
        <h1 style={{ fontSize: 'var(--rw-text-xl)', margin: 0 }}>Billing exports</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
          Hand the cycle&apos;s billable reads to a client&apos;s billing system. Held meters stay out until their exceptions clear.
        </p>
      </div>

      {/* selectors */}
      <div className="rw-card" style={{ display: 'flex', gap: 'var(--rw-space-3)', flexWrap: 'wrap' }}>
        <label style={{ flex: 1, minWidth: 160 }}>
          <span className="rw-label">Client</span>
          <select className="rw-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 140 }}>
          <span className="rw-label">Cycle</span>
          <select className="rw-input" value={cycleId} onChange={(e) => setCycleId(e.target.value)} disabled={cycles.length === 0}>
            {cycles.length === 0 ? <option value="">No cycles</option> : cycles.map((cy) => <option key={cy} value={cy}>{cy}</option>)}
          </select>
        </label>
      </div>

      {/* preview */}
      {!preview ? (
        cycleId ? <Loading /> : <div className="rw-card"><p style={{ margin: 0, color: 'var(--rw-text-muted)' }}>No runs for this client yet.</p></div>
      ) : (
        <>
          <div className="rw-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--rw-space-3)', flexWrap: 'wrap' }}>
              <Stat label="Billable" value={c!.billable} color="var(--rw-sync-synced)" />
              <Stat label="Held" value={c!.held} color="var(--rw-warning)" />
              <Stat label="Missing" value={c!.missing} color="var(--rw-text-muted)" />
              {/* Skipped is counted separately from held and missing, so without
                  it the tiles don't sum to the cycle's stops. */}
              <Stat label="Skipped" value={c!.skipped ?? 0} color="var(--rw-warning)" />
              <Stat label="Total stops" value={preview.totalStops} color="var(--rw-text-secondary)" />
            </div>
            <button className="rw-button" disabled={busy || c!.billable === 0} onClick={onGenerate} style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Generating…' : preview.lastExportId ? 'Re-generate export' : 'Generate export'}
            </button>
            {preview.lastExportAt && (
              <p style={{ margin: 0, fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                Current export ran {new Date(preview.lastExportAt).toLocaleString()}.
              </p>
            )}
            {error && <p style={{ margin: 0, color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)' }}>{error}</p>}
          </div>

          {preview.holds.length > 0 && (
            <div className="rw-card" style={{ padding: 0 }}>
              <div style={{ padding: 'var(--rw-space-3) var(--rw-space-4)', borderBottom: '1px solid var(--rw-border)' }}>
                <span className="rw-label" style={{ margin: 0 }}>Held back ({preview.holds.length})</span>
              </div>
              <div className="rw-rows">
                {preview.holds.map((h) => (
                  <div key={h.meterId} className="rw-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{h.meterSerial}</div>
                      <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>{h.serviceAddress}</div>
                    </span>
                    <span
                      className="rw-badge"
                      style={{ flex: 'none', color: h.reason === 'blocking_exception' ? 'var(--rw-warning)' : 'var(--rw-text-muted)' }}
                    >
                      {h.reason === 'blocking_exception' ? h.exceptionCode?.replace(/_/g, ' ') : 'not read'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* history */}
      <div className="rw-card" style={{ padding: 0 }}>
        <div style={{ padding: 'var(--rw-space-3) var(--rw-space-4)', borderBottom: '1px solid var(--rw-border)' }}>
          <span className="rw-label" style={{ margin: 0 }}>Export history</span>
        </div>
        {history.length === 0 ? (
          <p style={{ padding: 'var(--rw-space-4)', margin: 0, color: 'var(--rw-text-muted)', fontSize: 'var(--rw-text-sm)' }}>
            No exports run for this client yet.
          </p>
        ) : (
          <div className="rw-rows">
            {history.map((e) => (
              <div key={e.id} className="rw-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>
                    {e.cycleId}
                    {e.superseded && <span className="rw-badge" style={{ marginLeft: 8, color: 'var(--rw-text-muted)' }}>superseded</span>}
                  </div>
                  <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)' }}>
                    {new Date(e.ranAt).toLocaleString()} · {e.ranByName} · {e.counts.billable} billable
                  </div>
                </span>
                <button className="rw-button rw-button--ghost" style={{ flex: 'none' }} onClick={() => downloadExport(e.id, e.filename)}>
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div className="tabular" style={{ fontSize: 'var(--rw-text-2xl)', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}
