import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { PendingInvitation, Role } from '@routewrangler/contracts';
import { mapAppRoleToOrgRole, mapOrgRoleToAppRole } from '../webhooks/clerk-role-map';
import type { CreateStaffInput, CreateStaffOutcome, StaffDirectoryPort } from './staff-directory.port';

/**
 * Clerk adapter — Clerk owns identity, so this never writes a `users` row.
 * Creating staff sends an organization invitation; the row appears only when the
 * person accepts and Clerk posts `organizationMembership.created` to
 * `POST /webhooks/clerk`. That keeps exactly one writer for the authorization
 * record and avoids rows nobody can ever authenticate as.
 *
 * Role and membership changes go the other way — we push to Clerk, and the
 * resulting webhook confirms what we already wrote locally. Both paths are
 * idempotent, so the redundancy is harmless and the UI need not wait on a
 * round-trip through Clerk to show the new state.
 */
@Injectable()
export class ClerkStaffDirectory implements StaffDirectoryPort {
  private readonly log = new Logger(ClerkStaffDirectory.name);
  private readonly clerk: ClerkClient;

  constructor(
    secretKey: string,
    private readonly organizationId: string,
  ) {
    this.clerk = createClerkClient({ secretKey });
  }

  async createStaff(input: CreateStaffInput): Promise<CreateStaffOutcome> {
    if (!input.email) {
      throw new BadRequestException('an email address is required to invite staff');
    }
    const invitation = await this.call('invite staff', () =>
      this.clerk.organizations.createOrganizationInvitation({
        organizationId: this.organizationId,
        emailAddress: input.email as string,
        role: mapAppRoleToOrgRole(input.role),
      }),
    );
    return {
      kind: 'invited',
      invitation: {
        id: invitation.id,
        email: invitation.emailAddress,
        role: input.role,
        createdAt: new Date(invitation.createdAt).toISOString(),
      },
    };
  }

  async setRole(cognitoSub: string, role: Role): Promise<void> {
    // `cognitoSub` is the Clerk user id — the webhook stores it verbatim, so it
    // is the correct key for the membership API with no extra lookup.
    await this.call('change an org role', () =>
      this.clerk.organizations.updateOrganizationMembership({
        organizationId: this.organizationId,
        userId: cognitoSub,
        role: mapAppRoleToOrgRole(role),
      }),
    );
  }

  async setActive(cognitoSub: string, active: boolean): Promise<void> {
    if (active) {
      // Clerk has no "reactivate". Deactivation deletes the org membership, so
      // restoring access means inviting the person back — and re-activating the
      // local row alone would grant access to an identity that is no longer in
      // the organization. Make the admin go through the invite flow instead.
      throw new BadRequestException(
        'this staff member is managed by Clerk — invite them again to restore access',
      );
    }
    await this.call('revoke an org membership', () =>
      this.clerk.organizations.deleteOrganizationMembership({
        organizationId: this.organizationId,
        userId: cognitoSub,
      }),
    );
  }

  async listPendingInvitations(): Promise<PendingInvitation[]> {
    const res = await this.call('list invitations', () =>
      this.clerk.organizations.getOrganizationInvitationList({
        organizationId: this.organizationId,
        status: ['pending'],
      }),
    );
    return res.data.flatMap((inv) => {
      const role = mapOrgRoleToAppRole(inv.role);
      // An invitation carrying an org role we do not recognise would provision
      // no access if accepted (the webhook declines it), so it is noise here.
      if (!role) return [];
      return [
        {
          id: inv.id,
          email: inv.emailAddress,
          role,
          createdAt: new Date(inv.createdAt).toISOString(),
        },
      ];
    });
  }

  /**
   * Clerk failures are upstream failures, not client errors. Surface them as
   * 503 with the action that failed, rather than leaking a Clerk stack trace or
   * letting a network blip look like a validation problem — except for our own
   * 400s, which must pass through unchanged.
   */
  private async call<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.log.error(`clerk: failed to ${action}`, err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException(`identity provider rejected the request to ${action}`);
    }
  }
}
