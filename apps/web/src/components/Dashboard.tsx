'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MeResponse, Role } from '@routewrangler/contracts';
import { Brand } from './Brand';
import { fetchMe } from '@/lib/api';
import { signOut } from '@/lib/cognito';

/**
 * Authenticated shell for a role-gated route group. Fetches the /me hello and
 * displays the role (the Sprint 0 demo moment). Role-gating here is convenience,
 * not security — the API enforces roles server-side on every endpoint
 * (BUILD_SPEC §6). A mismatched role is redirected to its own home.
 */
const HOME_BY_ROLE: Record<Role, string> = {
  reader: '/field',
  supervisor: '/supervisor',
  admin: '/admin',
};

export function Dashboard({
  requiredRole,
  title,
  children,
}: {
  requiredRole: Role;
  title: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((res) => {
        if (!active) return;
        if (res.role !== requiredRole) {
          router.replace(HOME_BY_ROLE[res.role]);
          return;
        }
        setMe(res);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load session');
      });
    return () => {
      active = false;
    };
  }, [requiredRole, router]);

  function onSignOut() {
    signOut();
    router.push('/login');
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.9rem 1.25rem',
          borderBottom: '1px solid var(--rw-border)',
          background: 'var(--rw-surface)',
        }}
      >
        <Brand size={24} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          {me && (
            <span style={{ fontSize: '0.85rem', color: 'var(--rw-text-muted)' }}>
              {me.displayName} <span className="rw-badge">{me.role}</span>
            </span>
          )}
          <button
            onClick={onSignOut}
            style={{
              background: 'transparent',
              color: 'var(--rw-text-muted)',
              border: '1px solid var(--rw-border)',
              borderRadius: 8,
              padding: '0.35rem 0.7rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.4rem' }}>{title}</h1>

        {error && (
          <div className="rw-card" style={{ marginTop: '1rem' }}>
            <p style={{ color: 'var(--rw-danger)', margin: 0 }}>{error}</p>
            <p style={{ color: 'var(--rw-text-muted)', fontSize: '0.85rem' }}>
              You may need to sign in again.
            </p>
          </div>
        )}

        {!error && !me && (
          <p style={{ color: 'var(--rw-text-muted)', marginTop: '1rem' }}>Loading…</p>
        )}

        {me && (
          <div className="rw-card" style={{ marginTop: '1rem' }}>
            <p style={{ margin: 0 }}>
              Authenticated as <strong>{me.displayName}</strong> — role{' '}
              <span className="rw-badge">{me.role}</span>
            </p>
            <p style={{ color: 'var(--rw-text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
              It&apos;s deployed, it&apos;s real auth, it has a name.
            </p>
          </div>
        )}

        {me && children}
      </main>
    </div>
  );
}
