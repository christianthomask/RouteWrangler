'use client';

import { useEffect } from 'react';
import { setToken, clearToken, registerIdpSignOut } from '@/lib/session';
import { requireAuthClient } from '@/lib/neon-auth';

/**
 * The seam between Neon Auth and the app's token-based API session (session.ts).
 *
 * Neon Auth access tokens last 15 minutes, but `authHeaders()` reads the stored
 * token *synchronously* so that every API call — and in particular the offline
 * PWA queue, which drains without a React tree around it — never has to await
 * auth. This bridge is what keeps that stored token fresh.
 *
 * It also registers Neon's `signOut` so the app's single `signOut()` ends the
 * IdP session too; without that, the next refresh below would mint a new token
 * and quietly sign the user back in.
 */
// Comfortably inside the 15-minute lifetime, and short enough that a laptop
// waking from sleep gets a usable token before the user's first click. The focus
// listener covers the case where the interval was frozen while suspended.
const REFRESH_MS = 10 * 60_000;

export function NeonTokenBridge() {
  const auth = requireAuthClient();
  const { data: session, isPending } = auth.useSession();
  const signedIn = Boolean(session);

  useEffect(() => {
    registerIdpSignOut(async () => {
      await auth.signOut();
    });
    return () => registerIdpSignOut(null);
  }, [auth]);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;

    async function sync() {
      if (!signedIn) {
        // Clear only the stored token; calling session.signOut() here would
        // recurse back into the IdP sign-out we just registered.
        clearToken();
        return;
      }
      try {
        const res = await auth.token();
        const token = res.data?.token;
        if (!cancelled && token) setToken(token);
      } catch {
        // Keep the last token. A stale one just 401s, and the shells redirect to
        // /login (see Shell/FieldShell) — which is a better outcome than
        // dropping a valid token because one refresh hit a flaky network.
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
  }, [auth, isPending, signedIn]);

  return null;
}
