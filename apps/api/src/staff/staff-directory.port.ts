import type { PendingInvitation, Role } from '@routewrangler/contracts';

/**
 * Port 3 — the staff directory (ADR-024), alongside ADR-015's storage and auth
 * ports. It abstracts *the identity provider side* of staff administration only.
 * Writing the local `users` row is deliberately NOT part of this interface:
 * that row is the authorization record and stays owned by `StaffService`, so
 * both adapters produce identical database state.
 */

export interface CreateStaffInput {
  displayName: string;
  role: Role;
  email?: string;
  username?: string;
}

/**
 * Either the identity exists now and we know its subject (`local`, where the
 * dev shim has no state to create), or an invitation is outstanding and the
 * subject will not be known until the person accepts and the Clerk webhook
 * lands the row (`clerk`).
 */
export type CreateStaffOutcome =
  | { kind: 'provisioned'; cognitoSub: string }
  | { kind: 'invited'; invitation: PendingInvitation };

export interface StaffDirectoryPort {
  createStaff(input: CreateStaffInput): Promise<CreateStaffOutcome>;

  /** Push a role change to the identity provider. Keyed by the provider's own subject id. */
  setRole(cognitoSub: string, role: Role): Promise<void>;

  /**
   * Grant or revoke the provider-side membership. Revoking here is belt-and-braces:
   * the local row's `active: false` is what the auth guard actually enforces, and
   * it takes effect on the very next request.
   */
  setActive(cognitoSub: string, active: boolean): Promise<void>;

  /** Invitations sent but not yet accepted. Empty for providers that have none. */
  listPendingInvitations(): Promise<PendingInvitation[]>;
}

/** DI token for the resolved adapter. */
export const STAFF_DIRECTORY = Symbol('STAFF_DIRECTORY');
