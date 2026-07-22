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
   * MapLibre style JSON for the field basemap (ADR-022). Self-hosted: the app
   * serves its own style at /map/style.json, backed by the PMTiles packs on R2
   * via the /tiles/{z}/{x}/{y} handler — so the basemap is on by default. Set
   * NEXT_PUBLIC_MAP_STYLE_URL to point at a different style, or to '' to force
   * the dependency-free SVG fallback plot.
   */
  mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? '/map/style.json',
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

// The "Continue as …" list used to be a hardcoded constant here. It drifted —
// it listed three of the four seeded users — and could never include staff
// created through Admin. The login page now reads GET /dev/users instead, which
// is served only while the API's own bypass is active. See `fetchDevUsers`.
