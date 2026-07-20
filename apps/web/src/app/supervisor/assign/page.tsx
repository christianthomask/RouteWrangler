'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignableRoute, ClientSummary, RosterReader } from '@routewrangler/contracts';
import { assignRun, fetchClients, fetchRoster, fetchRoutes } from '@/lib/api';
import { Loading } from '@/components/ui';

export default function AssignPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [readers, setReaders] = useState<RosterReader[]>([]);
  const [routes, setRoutes] = useState<AssignableRoute[]>([]);
  const [clientId, setClientId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [readerId, setReaderId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchClients().then((r) => setClients(r.clients)).catch((e) => setError(String(e)));
    fetchRoster().then((r) => setReaders(r.readers)).catch(() => {});
  }, []);

  useEffect(() => {
    setRouteId('');
    if (!clientId) return setRoutes([]);
    fetchRoutes(clientId).then((r) => setRoutes(r.routes)).catch(() => setRoutes([]));
  }, [clientId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const run = await assignRun({ routeId, readerId });
      router.push(`/supervisor/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'assignment failed');
      setBusy(false);
    }
  }

  if (!clients) return <Loading />;
  const canSubmit = clientId && routeId && readerId && !busy;

  return (
    <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Assign a route</h1>

      <form className="rw-card" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)' }}>
        <label>
          <span className="rw-label">Client</span>
          <select className="rw-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}, {c.state}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="rw-label">Route</span>
          <select className="rw-input" value={routeId} onChange={(e) => setRouteId(e.target.value)} disabled={!clientId}>
            <option value="">{clientId ? 'Select a route…' : 'Pick a client first'}</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.stopCount} stops{r.assignedThisCycle ? ' · already assigned this cycle' : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="rw-label">Reader</span>
          <select className="rw-input" value={readerId} onChange={(e) => setReaderId(e.target.value)}>
            <option value="">Select a reader…</option>
            {readers.map((r) => (
              <option key={r.readerId} value={r.readerId}>{r.name}</option>
            ))}
          </select>
        </label>

        {error && <p style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)', margin: 0 }}>{error}</p>}

        <button className="rw-button" type="submit" disabled={!canSubmit}>
          {busy ? 'Assigning…' : 'Assign & materialize run'}
        </button>
        <p style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', margin: 0 }}>
          Creates a dated run for the current cycle with every stop pending.
        </p>
      </form>
    </div>
  );
}
