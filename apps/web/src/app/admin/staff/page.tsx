'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES, type Role, type StaffListResponse, type StaffMember } from '@routewrangler/contracts';
import { EmptyState, Loading } from '@/components/ui';
import { ROLE_LABEL } from '@/design/tokens';
import { createStaff, fetchStaff, setStaffActive, setStaffRole } from '@/lib/api';

export default function StaffPage() {
  const [data, setData] = useState<StaffListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed by staff id so one row's spinner doesn't disable the whole table.
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  /**
   * Deliberately does not clear `error` on success — it is called again after a
   * failed mutation to resync the rows, and clearing here would erase the very
   * message explaining why that mutation was rejected. Callers clear before acting.
   */
  const load = useCallback(async () => {
    try {
      setData(await fetchStaff());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Mutations re-fetch rather than patching local state: the server applies
   * guards we do not model client-side (the last-admin rule), so its response is
   * the only trustworthy view of what actually changed.
   */
  async function mutate(id: string, fn: () => Promise<StaffMember>) {
    setError(null);
    setRowBusy(id);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      // Re-fetch on failure too: a rejected role change leaves the <select>
      // showing the value the admin picked, which reads as if it had been saved.
      await load();
      setRowBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ fontSize: 'var(--rw-text-2xl)', margin: 0 }}>Staff</h1>
        {data && (
          <span className="rw-badge" title="Where staff accounts are created">
            {data.provider === 'oidc' ? 'Neon Auth' : 'Local'}
          </span>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)', margin: 0 }}>{error}</p>
      )}

      {data && <CreateStaffForm provider={data.provider} onCreated={load} onError={setError} />}

      {data && data.pendingInvitations.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)' }}>
          <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: 0 }}>Pending invitations</h2>
          <div className="rw-card" style={{ padding: 0 }}>
            <div className="rw-rows">
              {data.pendingInvitations.map((inv) => (
                <div key={inv.id} className="rw-row" style={{ cursor: 'default' }}>
                  <div className="rw-row__top">
                    <strong>{inv.email}</strong>
                    <span className="rw-badge">{inv.role}</span>
                  </div>
                  <div className="rw-row__meta">
                    <span>Invited {new Date(inv.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {error && !data ? (
        <EmptyState title="Couldn't load staff" hint={error} />
      ) : !data ? (
        <Loading />
      ) : data.staff.length === 0 ? (
        <EmptyState title="No staff yet" hint="Add a supervisor or a reader above." />
      ) : (
        <div className="rw-card" style={{ padding: 0 }}>
          <div className="rw-rows">
            {data.staff.map((m) => (
              <div
                key={m.id}
                className="rw-row"
                style={{ cursor: 'default', opacity: m.active ? 1 : 0.55 }}
              >
                <div className="rw-row__top">
                  <strong>{m.displayName}</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rw-space-2)' }}>
                    <select
                      className="rw-input"
                      aria-label={`Role for ${m.displayName}`}
                      value={m.role}
                      disabled={rowBusy !== null || !m.active}
                      style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: 'var(--rw-text-sm)' }}
                      onChange={(e) => mutate(m.id, () => setStaffRole(m.id, e.target.value as Role))}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="rw-button rw-button--ghost"
                      disabled={rowBusy !== null}
                      style={{ width: 'auto', padding: '0.3rem 0.6rem', fontSize: 'var(--rw-text-sm)' }}
                      onClick={() => mutate(m.id, () => setStaffActive(m.id, !m.active))}
                    >
                      {rowBusy === m.id ? '…' : m.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </div>
                <div className="rw-row__meta">
                  {/* No sub yet means invited-but-never-signed-in, which is the
                      state an admin most needs to be able to see at a glance. */}
                  <span>{m.authSub ?? `${m.email} — invited, not signed in yet`}</span>
                  {!m.active && <span style={{ color: 'var(--rw-danger)' }}>Access revoked</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateStaffForm({
  provider,
  onCreated,
  onError,
}: {
  provider: StaffListResponse['provider'];
  onCreated: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('reader');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // With a real IdP the address is the only thing that will match this person to
  // their row when they first sign in, so it is required. The local adapter
  // mints the account outright and has nothing to match later.
  const needsEmail = provider === 'oidc';
  const canSubmit = displayName.trim() !== '' && (!needsEmail || email.trim() !== '') && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await createStaff({
        displayName: displayName.trim(),
        role,
        ...(needsEmail ? { email: email.trim() } : {}),
      });
      setNotice(
        res.invitation
          ? `${res.invitation.displayName} can now sign in with Google as ${res.invitation.email}.`
          : `Created ${res.member?.displayName} — sign-in id ${res.member?.authSub}`,
      );
      setDisplayName('');
      setEmail('');
      setRole('reader');
      await onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create staff');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rw-card"
      onSubmit={submit}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-4)', maxWidth: 480 }}
    >
      <h2 style={{ fontSize: 'var(--rw-text-lg)', margin: 0 }}>Add staff</h2>

      <label>
        <span className="rw-label">Name</span>
        <input
          className="rw-input"
          value={displayName}
          placeholder="Dana Okafor"
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>

      {needsEmail && (
        <label>
          <span className="rw-label">Email</span>
          <input
            className="rw-input"
            type="email"
            value={email}
            placeholder="dana@example.gov"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      )}

      <label>
        <span className="rw-label">Role</span>
        <select className="rw-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>

      {notice && (
        <p style={{ color: 'var(--rw-success)', fontSize: 'var(--rw-text-sm)', margin: 0 }}>{notice}</p>
      )}

      <button className="rw-button" type="submit" disabled={!canSubmit}>
        {busy ? 'Adding…' : needsEmail ? 'Send invitation' : 'Add staff'}
      </button>

      <p style={{ fontSize: 'var(--rw-text-xs)', color: 'var(--rw-text-muted)', margin: 0 }}>
        {needsEmail
          ? 'Creates the account now with no sign-in attached. Tell them to sign in with Google using this exact address.'
          : 'Creates a local account usable immediately from the sign-in page.'}
      </p>
    </form>
  );
}
