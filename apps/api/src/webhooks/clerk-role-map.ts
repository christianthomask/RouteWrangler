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

/**
 * The inverse of {@link mapOrgRoleToAppRole}, used when *we* drive Clerk rather
 * than react to it (ADR-024: inviting staff, changing an org member's role).
 *
 * Total on purpose — every app role maps to exactly one org role, so a role
 * pushed to Clerk always maps back to the role we intended. `org:member` is
 * deliberately not a target: it only exists as an inbound alias for `reader`.
 */
export function mapAppRoleToOrgRole(role: Role): string {
  switch (role) {
    case 'admin':
      return 'org:admin';
    case 'supervisor':
      return 'org:supervisor';
    case 'reader':
      return 'org:reader';
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
