import type { Role } from '@routewrangler/contracts';

/**
 * Port 3 — the staff directory (ADR-024), alongside ADR-015's storage and auth
 * ports. It abstracts *the identity provider side* of staff administration only.
 * Writing the local `users` row is deliberately NOT part of this interface:
 * that row is the authorization record and stays owned by `StaffService`, so
 * every adapter produces identical database state.
 */

export interface CreateStaffInput {
  displayName: string;
  role: Role;
  email?: string;
  username?: string;
}

/**
 * Either the identity exists now and we know its subject (`local`, where the dev
 * shim has no external state to create), or the account is an invitation and the
 * subject stays unknown until that person signs in for the first time (`oidc`,
 * ADR-027).
 */
export type CreateStaffOutcome =
  | { kind: 'provisioned'; authSub: string }
  | { kind: 'invited'; email: string };

export interface StaffDirectoryPort {
  createStaff(input: CreateStaffInput): Promise<CreateStaffOutcome>;

  /**
   * Push a role change to the identity provider, for providers that mirror roles
   * on their side. Keyed by the provider's own subject id — null for someone who
   * has not signed in yet, in which case there is nothing to push to.
   */
  setRole(authSub: string | null, role: Role): Promise<void>;

  /**
   * Grant or revoke the provider-side membership. Belt-and-braces everywhere:
   * the local row's `active: false` is what the auth guard actually enforces,
   * and it takes effect on the very next request.
   */
  setActive(authSub: string | null, active: boolean): Promise<void>;
}

/** DI token for the resolved adapter. */
export const STAFF_DIRECTORY = Symbol('STAFF_DIRECTORY');
