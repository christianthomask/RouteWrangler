'use client';

import { authDevBypass } from './config';

/**
 * Client session. Two modes: `dev` stores a seeded user's sub and sends it as
 * `x-dev-user-sub` (local, ADR-012); `token` stores a real IdP JWT (Clerk, when
 * wired). One accessor — `authHeaders()` — so callers never branch on mode.
 */
const DEV_SUB_KEY = 'rw.devSub';
const TOKEN_KEY = 'rw.idToken';

export function signInDev(sub: string): void {
  window.localStorage.setItem(DEV_SUB_KEY, sub);
}

/**
 * SECURITY TRADE-OFF — the IdP JWT lives in localStorage, not an httpOnly cookie.
 *
 * Exposure: anything that can execute script in this origin can read the token
 * and replay it against the API until it expires. That means a successful XSS,
 * or a compromised/malicious third-party script loaded into the page. An
 * httpOnly cookie would keep the raw token out of reach of script — the injected
 * code could still make authenticated requests *as the page*, but it could not
 * exfiltrate a bearer token for offline reuse elsewhere, so the blast radius is
 * bounded by the session rather than by the token lifetime.
 *
 * Why we accept it here: the API is a separate origin, so cookie auth would need
 * cross-site cookies (SameSite=None; Secure) plus CSRF defence on every mutating
 * route, and Clerk would have to mint/refresh the session cookie server-side —
 * an API + IdP change, not a web-app change. The app itself is currently free of
 * injection sinks (no dangerouslySetInnerHTML / innerHTML / eval / srcDoc; all
 * hrefs are literal or numeric), which is what actually keeps this safe today.
 *
 * Real mitigation, in order of value:
 *   1. Keep the app XSS-clean — that invariant is doing the load-bearing work.
 *      Any future dangerouslySetInnerHTML re-opens this hole.
 *   2. Short token TTL + refresh via the Clerk bridge, so a stolen token dies fast.
 *   3. A strict CSP (no unsafe-inline/unsafe-eval) to blunt injection generally.
 *   4. Only then: move to httpOnly cookies + CSRF tokens (API + Clerk work).
 */
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

/** Clears the stored JWT without touching the Clerk session (bridge use). */
export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * The Clerk provider (when mounted) registers its `signOut` here so the single
 * `signOut()` below ends the IdP session too — otherwise the token bridge would
 * just mint a fresh token and re-sign the user in. Null in dev-bypass builds.
 */
let clerkSignOut: (() => void | Promise<void>) | null = null;
export function registerClerkSignOut(fn: (() => void | Promise<void>) | null): void {
  clerkSignOut = fn;
}

export function signOut(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DEV_SUB_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  if (clerkSignOut) void clerkSignOut();
}

export function isSignedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.localStorage.getItem(DEV_SUB_KEY) || window.localStorage.getItem(TOKEN_KEY));
}

/** Auth headers for an API request, or null when not signed in. */
export function authHeaders(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (token) return { authorization: `Bearer ${token}` };
  if (authDevBypass) {
    const sub = window.localStorage.getItem(DEV_SUB_KEY);
    if (sub) return { 'x-dev-user-sub': sub };
  }
  return null;
}
