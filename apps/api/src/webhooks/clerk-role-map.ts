import type { Role } from '@routewrangler/contracts';

/**
 * Maps a Clerk organization role key to an app role (ADR-007: staff roles are
 * reader/supervisor/admin; clients are data, not tenants). Clerk custom org
 * roles are keyed `org:<slug>`; the default non-admin role is `org:member`.
 *
 * Unknown roles return `null` — the webhook then declines to provision a row,
 * so an unrecognized membership yields *no access* rather than a guessed one
 * (least privilege by default).
 */
export function mapOrgRoleToAppRole(clerkRole: string): Role | null {
  switch (clerkRole) {
    case 'org:admin':
      return 'admin';
    case 'org:supervisor':
      return 'supervisor';
    case 'org:reader':
      return 'reader';
    // Clerk's built-in non-admin role — treat as the lowest app privilege.
    case 'org:member':
      return 'reader';
    default:
      return null;
  }
}

/** Builds a display name from Clerk's public user data, with sane fallbacks. */
export function displayNameFrom(data: {
  first_name?: string | null;
  last_name?: string | null;
  identifier?: string | null;
}): string {
  const full = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  return full || data.identifier || 'Unknown user';
}
