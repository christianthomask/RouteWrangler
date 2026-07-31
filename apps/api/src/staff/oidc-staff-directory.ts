import { BadRequestException, Injectable } from '@nestjs/common';
import type { CreateStaffInput, CreateStaffOutcome, StaffDirectoryPort } from './staff-directory.port';

/**
 * OIDC adapter — the shape of staff administration when a real identity provider
 * is in play (ADR-027). Neon Auth is the configured instance of it.
 *
 * It has no methods that call out anywhere, and that is the decision, not an
 * omission. Under Neon Auth, staff obtain their identity themselves by signing
 * in with Google; there is no organization to invite them into and no
 * provider-side role to keep in step. Everything that matters — who exists, what
 * they may do, whether they still work here — lives in the `users` row that
 * `StaffService` writes, which is also the only thing the auth guard reads.
 *
 * So "invite" here means: write the row now, leave the subject id empty, and let
 * the guard attach the identity on that person's first verified sign-in. That is
 * what replaced the Clerk membership webhook, and it is strictly less machinery
 * — an invitation cannot be lost in delivery when nothing is delivered.
 *
 * The port stays because the *seam* is real: an IdP with a management API (Entra,
 * or Neon Auth's admin plugin should we ever need org roles mirrored) drops in
 * here without touching `StaffService`.
 */
@Injectable()
export class OidcStaffDirectory implements StaffDirectoryPort {
  async createStaff(input: CreateStaffInput): Promise<CreateStaffOutcome> {
    if (!input.email) {
      // Without an address there is nothing to match the person to this row when
      // they eventually sign in, so the account could never become reachable.
      throw new BadRequestException('an email address is required to invite staff');
    }
    return { kind: 'invited', email: input.email.trim().toLowerCase() };
  }

  /** Roles are DB-authoritative (BUILD_SPEC §6) — there is nowhere else to push them. */
  setRole(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Deactivation takes effect on the staff member's very next request, because
   * the guard reads `active` from the row every time. Revoking the IdP session
   * as well would end it a few seconds sooner and cost a vendor dependency.
   */
  setActive(): Promise<void> {
    return Promise.resolve();
  }
}
