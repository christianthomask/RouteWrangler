/**
 * Typed design tokens for JS/TSX consumers (status logic, future charts). These
 * mirror the CSS custom properties in tokens.css — the CSS file is the styling
 * source of truth; this is the programmatic accessor. Severity/sync values map to
 * a CVD-validated status palette and are ALWAYS rendered with an icon + label
 * (never color alone) — ADR-016.
 */
import type { Role } from '@routewrangler/contracts';

/** Severity codes as seeded in the taxonomy (ADR-003). */
export type SeverityCode = 'low' | 'medium' | 'high' | 'critical';

/** CSS variable name carrying each severity's foreground color. */
export const SEVERITY_VAR: Record<SeverityCode, string> = {
  low: 'var(--rw-sev-low)',
  medium: 'var(--rw-sev-medium)',
  high: 'var(--rw-sev-high)',
  critical: 'var(--rw-sev-critical)',
};

export const SEVERITY_BG_VAR: Record<SeverityCode, string> = {
  low: 'var(--rw-sev-low-bg)',
  medium: 'var(--rw-sev-medium-bg)',
  high: 'var(--rw-sev-high-bg)',
  critical: 'var(--rw-sev-critical-bg)',
};

/** Field sync states (offline store-and-forward — BUILD_SPEC §7.2). */
export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed';

export const SYNC_VAR: Record<SyncState, string> = {
  pending: 'var(--rw-sync-pending)',
  syncing: 'var(--rw-sync-syncing)',
  synced: 'var(--rw-sync-synced)',
  failed: 'var(--rw-sync-failed)',
};

/** Short glanceable labels (color is never the only signal). */
export const SEVERITY_LABEL: Record<SeverityCode, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SYNC_LABEL: Record<SyncState, string> = {
  pending: 'Queued',
  syncing: 'Syncing',
  synced: 'Synced',
  failed: 'Failed',
};

/** Landing route per role (used post-login). */
export const HOME_BY_ROLE: Record<Role, string> = {
  reader: '/field',
  supervisor: '/supervisor',
  admin: '/admin',
};

/**
 * Human-readable role names, for anywhere a role is *chosen* rather than just
 * displayed. The `rw-badge` treatment uppercases the raw value, which is fine
 * as a chip but reads poorly in a dropdown.
 */
export const ROLE_LABEL: Record<Role, string> = {
  reader: 'Field reader',
  supervisor: 'Supervisor',
  admin: 'Admin',
};
