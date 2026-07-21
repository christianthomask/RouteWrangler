'use client';

import { useEffect } from 'react';
import { useAuth, useClerk } from '@clerk/nextjs';
import { setToken, clearToken, registerClerkSignOut } from '@/lib/session';

/**
 * The seam between Clerk and the app's token-based API session (session.ts).
 *
 * Clerk template tokens are short-lived (~60s), but `authHeaders()` reads a
 * stored token synchronously so the offline PWA queue and every API call stay
 * simple (they never await auth). This bridge keeps that stored token fresh:
 * it mints a JWT from the `api` template (audience-bound, so the API rejects
 * any token not minted for it) and refreshes it ahead of expiry and on focus.
 *
 * It also registers Clerk's `signOut` so the app's single `signOut()` ends the
 * IdP session too. Rendered only inside <ClerkProvider> (see layout.tsx).
 */
const JWT_TEMPLATE = 'api';
const REFRESH_MS = 45_000; // ahead of the ~60s token lifetime

export function ClerkTokenBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();

  useEffect(() => {
    registerClerkSignOut(() => clerk.signOut({ redirectUrl: '/login' }));
    return () => registerClerkSignOut(null);
  }, [clerk]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    async function sync() {
      if (!isSignedIn) {
        // Clear only the stored token; don't call session.signOut() here or
        // we'd recursively trigger Clerk signOut.
        clearToken();
        return;
      }
      try {
        const token = await getToken({ template: JWT_TEMPLATE });
        if (!cancelled && token) setToken(token);
      } catch {
        // Keep the last token; a stale one just 401s and the shells redirect
        // to /login (see Shell/FieldShell).
      }
    }

    void sync();
    const id = window.setInterval(sync, REFRESH_MS);
    const onFocus = () => void sync();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [isLoaded, isSignedIn, getToken]);

  return null;
}
