'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignIn, useAuth } from '@clerk/nextjs';
import { fetchMe, ApiError } from '@/lib/api';
import { setToken } from '@/lib/session';
import { HOME_BY_ROLE } from '@/design/tokens';

/**
 * Clerk sign-in for deployed environments (rendered only under <ClerkProvider>,
 * so its hooks are always safe). Once Clerk reports a session, we mint the API
 * token, resolve the user's role via /me, and route them home. A signed-in
 * Clerk user with no local `users` row (not yet added to the organization) gets
 * a clear "pending access" message rather than a redirect loop.
 */
export function ClerkLogin() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [status, setStatus] = useState<'idle' | 'routing' | 'pending' | 'error'>('idle');

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      setStatus('routing');
      try {
        const token = await getToken({ template: 'api' });
        if (token) setToken(token);
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
  }, [isLoaded, isSignedIn, getToken, router]);

  if (isLoaded && isSignedIn) {
    return (
      <p
        style={{
          fontSize: 'var(--rw-text-sm)',
          color: status === 'pending' || status === 'error' ? 'var(--rw-danger)' : 'var(--rw-text-secondary)',
          background: 'var(--rw-surface-2)',
          border: '1px solid var(--rw-border)',
          borderRadius: 'var(--rw-radius)',
          padding: '0.6rem 0.75rem',
          margin: 'var(--rw-space-2) 0 0',
        }}
      >
        {status === 'pending'
          ? 'Your account isn’t provisioned yet. Ask an admin to add you to the organization, then sign in again.'
          : status === 'error'
            ? 'Signed in, but the API is unreachable. Try again shortly.'
            : 'Signing you in…'}
      </p>
    );
  }

  // Hash routing keeps the whole flow on /login — no catch-all routes needed.
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <SignIn routing="hash" />
    </div>
  );
}
