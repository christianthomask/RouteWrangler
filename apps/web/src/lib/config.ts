import type { Role } from '@routewrangler/contracts';

/**
 * Public runtime config. Auth is provider-agnostic (ADR-015): Clerk in prod
 * (via OIDC), a labeled dev-bypass locally so the console runs against the API
 * without an IdP. The dev-bypass mirrors the API's AUTH_DEV_BYPASS (ADR-012) and
 * is never used once a real IdP is configured.
 */
export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
  /**
   * MapLibre style JSON for the field basemap (ADR-022). Self-hosted: the style
   * points at our PMTiles vector source on R2. Empty until the tile packs are
   * provisioned — the map degrades to the dependency-free SVG plot until then.
   */
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '',
};

export const clerkConfigured = Boolean(config.clerkPublishableKey);

/** Real basemap is available only once a style URL is configured (else SVG fallback). */
export const basemapConfigured = Boolean(config.mapStyleUrl);

/**
 * Dev-bypass is dev-only and fails closed (H9). It is active only outside a
 * production build, only when no real IdP is configured, and only when not
 * explicitly disabled. Defaulting to on in non-prod keeps `pnpm dev` working
 * without extra env; the `NODE_ENV === 'production'` guard means a prod build
 * NEVER renders the "Continue as …" buttons or sends x-dev-user-sub — a missing
 * Clerk key must fail closed, not fall back to an unauthenticated admin bypass.
 */
export const authDevBypass =
  process.env.NODE_ENV !== 'production' &&
  !clerkConfigured &&
  (process.env.NEXT_PUBLIC_AUTH_DEV_BYPASS ?? 'true') !== 'false';

/** Seeded users for local "Continue as" (matches the API seed subs). */
export interface DevUser {
  sub: string;
  displayName: string;
  role: Role;
}
export const DEV_USERS: DevUser[] = [
  { sub: 'local-only:jeramehl', displayName: 'Jeramehl', role: 'supervisor' },
  { sub: 'local-only:admin', displayName: 'System Admin', role: 'admin' },
  { sub: 'local-only:reader1', displayName: 'Field Reader One', role: 'reader' },
];
