'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMe, ApiError } from '@/lib/api';
import { setToken } from '@/lib/session';
import { requireAuthClient } from '@/lib/neon-auth';
import { HOME_BY_ROLE } from '@/design/tokens';

/**
 * Neon Auth sign-in for deployed environments (ADR-027).
 *
 * Google is the only offered method, and deliberately so: every person who signs
 * in here was invited by an admin who already knows their work address, so a
 * password to forget and reset would add a support burden and an attack surface
 * for nothing. It also means the email on the token is one Google verified,
 * which is what makes it safe to match against a pending invitation.
 *
 * Once Neon reports a session we store the API token, resolve the role via /me,
 * and route home. Someone who signs in with an address nobody invited gets a
 * clear "pending access" message rather than a redirect loop.
 */
type Status = 'idle' | 'signing-in' | 'routing' | 'pending' | 'error';

const NOTE_STYLE: React.CSSProperties = {
  fontSize: 'var(--rw-text-sm)',
  background: 'var(--rw-surface-2)',
  border: '1px solid var(--rw-border)',
  borderRadius: 'var(--rw-radius)',
  padding: '0.6rem 0.75rem',
  margin: 'var(--rw-space-2) 0 0',
};

export function NeonLogin() {
  const router = useRouter();
  const auth = requireAuthClient();
  const { data: session, isPending } = auth.useSession();
  const signedIn = Boolean(session);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (isPending || !signedIn) return;
    let cancelled = false;
    (async () => {
      setStatus('routing');
      try {
        // Mint the API token here rather than waiting for the bridge's first
        // tick, so the /me call below is already authenticated.
        const res = await auth.token();
        if (res.data?.token) setToken(res.data.token);
        const me = await fetchMe();
        if (!cancelled) router.replace(HOME_BY_ROLE[me.role]);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setStatus('pending');
        } else {
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, isPending, signedIn, router]);

  async function signInWithGoogle() {
    setStatus('signing-in');
    try {
      await auth.signIn.social({ provider: 'google', callbackURL: '/login' });
    } catch {
      setStatus('error');
    }
  }

  if (isPending) {
    return (
      <p style={{ ...NOTE_STYLE, color: 'var(--rw-text-secondary)' }}>Checking your session…</p>
    );
  }

  if (signedIn) {
    const failed = status === 'pending' || status === 'error';
    return (
      <div>
        <p style={{ ...NOTE_STYLE, color: failed ? 'var(--rw-danger)' : 'var(--rw-text-secondary)' }}>
          {status === 'pending'
            ? 'Your account isn’t provisioned yet. Ask an admin to invite this address, then sign in again.'
            : status === 'error'
              ? 'Signed in, but the API is unreachable. Try again shortly.'
              : 'Signing you in…'}
        </p>
        {failed && (
          <button
            type="button"
            className="rw-button rw-button--ghost"
            style={{ width: '100%', marginTop: 'var(--rw-space-3)' }}
            onClick={() => void auth.signOut()}
          >
            Sign in as someone else
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: 'var(--rw-text-sm)',
          color: 'var(--rw-text-muted)',
          margin: '0 0 var(--rw-space-4)',
        }}
      >
        Sign in with the Google account your administrator invited.
      </p>
      <button
        type="button"
        className="rw-button rw-button--primary"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={status === 'signing-in'}
        onClick={() => void signInWithGoogle()}
      >
        {status === 'signing-in' ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {status === 'error' && (
        <p style={{ ...NOTE_STYLE, color: 'var(--rw-danger)' }}>
          Could not reach the identity provider. Try again shortly.
        </p>
      )}
    </div>
  );
}
