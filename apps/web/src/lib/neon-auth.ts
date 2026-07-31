'use client';

import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthReactAdapter } from '@neondatabase/auth/react';
import { config, neonAuthConfigured } from './config';

/**
 * The Neon Auth client (ADR-027). One instance for the whole app, created at
 * module scope: the React adapter exposes hooks (`useSession`), and a client
 * rebuilt on render would give those hooks a new store to subscribe to every
 * time.
 *
 * Null when no auth URL is configured, which is the local dev-bypass build
 * (ADR-012). Nothing that touches this client is rendered in that case — see the
 * `neonAuthConfigured` guards in layout.tsx and login/page.tsx — so the hooks
 * below are only ever called on a real client, never conditionally.
 */
export const authClient = neonAuthConfigured
  ? createAuthClient(config.neonAuthUrl, { adapter: BetterAuthReactAdapter() })
  : null;

export type NeonAuthClient = NonNullable<typeof authClient>;

/**
 * The client, for components that are only mounted when it exists. Throwing
 * rather than returning null keeps the hook calls unconditional at the call
 * site; reaching the throw means a guard upstream was removed.
 */
export function requireAuthClient(): NeonAuthClient {
  if (!authClient) {
    throw new Error('Neon Auth is not configured (NEXT_PUBLIC_NEON_AUTH_URL is unset)');
  }
  return authClient;
}
