'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { authConfigured } from '@/lib/config';
import { signIn } from '@/lib/cognito';
import { fetchMe } from '@/lib/api';
import { HOME_BY_ROLE } from '@/design/tokens';
import { PRODUCT_DESCRIPTOR } from '@/design/brand';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(username, password);
      const me = await fetchMe();
      router.push(HOME_BY_ROLE[me.role]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
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
      <div style={{ width: '100%', maxWidth: 380 }}>
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
          <p
            style={{
              margin: 0,
              fontSize: 'var(--rw-text-sm)',
              color: 'var(--rw-text-muted)',
              maxWidth: 300,
            }}
          >
            {PRODUCT_DESCRIPTOR}
          </p>
        </div>

        <form className="rw-card" onSubmit={onSubmit} style={{ boxShadow: 'var(--rw-shadow-2)' }}>
          <h1
            style={{
              fontSize: 'var(--rw-text-lg)',
              fontWeight: 'var(--rw-weight-semibold)',
              margin: '0 0 var(--rw-space-5)',
            }}
          >
            Sign in
          </h1>

          {!authConfigured && (
            <p
              style={{
                fontSize: 'var(--rw-text-sm)',
                color: 'var(--rw-text-secondary)',
                background: 'var(--rw-surface-2)',
                border: '1px solid var(--rw-border)',
                borderRadius: 'var(--rw-radius)',
                padding: '0.6rem 0.75rem',
                margin: '0 0 var(--rw-space-4)',
              }}
            >
              Identity provider pending setup — sign-in activates once it is
              configured (see docs/runbook.md).
            </p>
          )}

          <div style={{ marginBottom: 'var(--rw-space-4)' }}>
            <label className="rw-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="rw-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="you@city.gov"
            />
          </div>

          <div style={{ marginBottom: 'var(--rw-space-5)' }}>
            <label className="rw-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="rw-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p
              style={{
                color: 'var(--rw-danger)',
                fontSize: 'var(--rw-text-sm)',
                margin: '0 0 var(--rw-space-4)',
              }}
            >
              {error}
            </p>
          )}

          <button className="rw-button" type="submit" disabled={busy || !authConfigured}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

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
