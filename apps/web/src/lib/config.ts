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
};

export const clerkConfigured = Boolean(config.clerkPublishableKey);

/** Dev-bypass active only when no real IdP is configured and not explicitly off. */
export const authDevBypass =
  !clerkConfigured && (process.env.NEXT_PUBLIC_AUTH_DEV_BYPASS ?? 'true') !== 'false';

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
