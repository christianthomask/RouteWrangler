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
