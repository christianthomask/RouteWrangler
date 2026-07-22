import { BadRequestException, Injectable } from '@nestjs/common';
import type { PendingInvitation } from '@routewrangler/contracts';
import type { CreateStaffInput, CreateStaffOutcome, StaffDirectoryPort } from './staff-directory.port';

/** The prefix the seed uses for rows that exist only in the local database (ADR-012). */
const LOCAL_SUB_PREFIX = 'local-only:';

/**
 * Derives a sub suffix from a display name: lowercase, non-alphanumerics folded
 * to a single dash, trimmed. Mirrors the shape `CreateStaffRequestSchema`
 * accepts for an explicit `username`, so generated and supplied subs look alike.
 */
export function usernameFromDisplayName(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

/**
 * Local adapter — there is no external identity provider, so "creating" a staff
 * member is just minting the subject the dev-auth shim will recognise. All real
 * state lives in the `users` row that `StaffService` writes.
 *
 * Never active in production: `staffProvider` only resolves to `local` when
 * Clerk credentials are absent, and `StaffService` additionally refuses to
 * create local accounts unless the dev bypass is on.
 */
@Injectable()
export class LocalStaffDirectory implements StaffDirectoryPort {
  // `async` so a bad input rejects rather than throwing synchronously — callers
  // await this through the port and would otherwise have to guard both ways.
  async createStaff(input: CreateStaffInput): Promise<CreateStaffOutcome> {
    const username = input.username ?? usernameFromDisplayName(input.displayName);
    if (!username) {
      throw new BadRequestException(
        'could not derive a username from that display name — supply one explicitly',
      );
    }
    return { kind: 'provisioned', cognitoSub: `${LOCAL_SUB_PREFIX}${username}` };
  }

  // Role and activation live entirely in the `users` row for this adapter.
  setRole(): Promise<void> {
    return Promise.resolve();
  }

  setActive(): Promise<void> {
    return Promise.resolve();
  }

  listPendingInvitations(): Promise<PendingInvitation[]> {
    return Promise.resolve([]);
  }
}
