'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@routewrangler/contracts';
import { Brand } from '@/components/Brand';
import { authConfigured } from '@/lib/config';
import { signIn } from '@/lib/cognito';
import { fetchMe } from '@/lib/api';

const HOME_BY_ROLE: Record<Role, string> = {
  reader: '/field',
  supervisor: '/supervisor',
  admin: '/admin',
};

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
        padding: '1.5rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
          <Brand size={34} />
        </div>
        <form className="rw-card" onSubmit={onSubmit}>
          <h1 style={{ fontSize: '1.1rem', margin: '0 0 1.25rem' }}>Sign in</h1>

          {!authConfigured && (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--rw-text-muted)',
                background: 'var(--rw-surface-2)',
                border: '1px solid var(--rw-border)',
                borderRadius: 8,
                padding: '0.6rem 0.75rem',
                marginBottom: '1rem',
              }}
            >
              Auth pending: the Cognito dev pool has not been provisioned yet (see
              docs/runbook.md). Sign-in activates once it is.
            </p>
          )}

          <div style={{ marginBottom: '0.9rem' }}>
            <label className="rw-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="rw-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
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
            <p style={{ color: 'var(--rw-danger)', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
              {error}
            </p>
          )}

          <button className="rw-button" type="submit" disabled={busy || !authConfigured}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
