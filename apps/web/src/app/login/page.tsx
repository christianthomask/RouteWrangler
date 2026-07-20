'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { authDevBypass, clerkConfigured, DEV_USERS, type DevUser } from '@/lib/config';
import { signInDev } from '@/lib/session';
import { fetchMe } from '@/lib/api';
import { HOME_BY_ROLE } from '@/design/tokens';
import { PRODUCT_DESCRIPTOR } from '@/design/brand';

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function continueAs(user: DevUser) {
    setError(null);
    setBusy(user.sub);
    try {
      signInDev(user.sub);
      const me = await fetchMe();
      router.push(HOME_BY_ROLE[me.role]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setBusy(null);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--rw-space-6)',
        background:
          'radial-gradient(1200px 500px at 50% -10%, var(--rw-brand-soft), transparent 60%), var(--rw-bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--rw-space-2)',
            marginBottom: 'var(--rw-space-6)',
            textAlign: 'center',
          }}
        >
          <Brand size={36} />
          <p style={{ margin: 0, fontSize: 'var(--rw-text-sm)', color: 'var(--rw-text-muted)', maxWidth: 300 }}>
            {PRODUCT_DESCRIPTOR}
          </p>
        </div>

        <div className="rw-card" style={{ boxShadow: 'var(--rw-shadow-2)' }}>
          <h1
            style={{
              fontSize: 'var(--rw-text-lg)',
              fontWeight: 'var(--rw-weight-semibold)',
              margin: '0 0 var(--rw-space-2)',
            }}
          >
            Sign in
          </h1>

          {authDevBypass ? (
            <>
              <p
                style={{
                  fontSize: 'var(--rw-text-sm)',
                  color: 'var(--rw-text-muted)',
                  margin: '0 0 var(--rw-space-4)',
                }}
              >
                Local development — continue as a seeded user. (Clerk sign-in
                replaces this in deployed environments.)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rw-space-2)' }}>
                {DEV_USERS.map((u) => (
                  <button
                    key={u.sub}
                    className="rw-button rw-button--ghost"
                    style={{ width: '100%', justifyContent: 'space-between', padding: '0.7rem 0.9rem' }}
                    disabled={busy !== null}
                    onClick={() => continueAs(u)}
                  >
                    <span style={{ fontWeight: 'var(--rw-weight-semibold)', color: 'var(--rw-text)' }}>
                      {busy === u.sub ? 'Signing in…' : u.displayName}
                    </span>
                    <span className="rw-badge">{u.role}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p
              style={{
                fontSize: 'var(--rw-text-sm)',
                color: 'var(--rw-text-secondary)',
                background: 'var(--rw-surface-2)',
                border: '1px solid var(--rw-border)',
                borderRadius: 'var(--rw-radius)',
                padding: '0.6rem 0.75rem',
                margin: 'var(--rw-space-2) 0 0',
              }}
            >
              {clerkConfigured
                ? 'Redirecting to sign-in…'
                : 'Identity provider pending setup (see docs/runbook.md).'}
            </p>
          )}

          {error && (
            <p style={{ color: 'var(--rw-danger)', fontSize: 'var(--rw-text-sm)', marginTop: 'var(--rw-space-4)' }}>
              {error}
            </p>
          )}
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: 'var(--rw-text-xs)',
            color: 'var(--rw-text-muted)',
            marginTop: 'var(--rw-space-5)',
          }}
        >
          Authorized city and contractor staff only.
        </p>
      </div>
    </main>
  );
}
