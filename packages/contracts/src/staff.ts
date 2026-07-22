import { z } from 'zod';
import { RoleSchema } from './roles';

/**
 * Staff administration (admin-only). Staff provisioning is a *port* with two
 * adapters (ADR-024), mirroring the storage and auth ports of ADR-015:
 *
 * - `local`  — writes the `users` row directly with a `local-only:` sub, so the
 *              new staff member is immediately usable through the dev-auth shim
 *              (ADR-012). Local development only.
 * - `clerk`  — creates a Clerk organization invitation; the person accepts, and
 *              the existing `organizationMembership.*` webhook is what actually
 *              writes the `users` row. Clerk stays the identity authority.
 *
 * The provider is reported to the client because it changes what the admin UI
 * can offer: only `clerk` has pending invitations, and only `local` can mint a
 * usable account without an email round-trip.
 */
export const StaffProviderSchema = z.enum(['local', 'clerk']);
export type StaffProvider = z.infer<typeof StaffProviderSchema>;

export const StaffMemberSchema = z.object({
  id: z.string().uuid(),
  cognitoSub: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  /** Soft-deactivation — a departed staff member with history is never deleted. */
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

/** An invitation sent but not yet accepted. Always empty for the `local` provider. */
export const PendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

export const StaffListResponseSchema = z.object({
  provider: StaffProviderSchema,
  staff: z.array(StaffMemberSchema),
  pendingInvitations: z.array(PendingInvitationSchema),
});
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;

// ── requests ────────────────────────────────────────────────────────────────

/**
 * Create a staff member. Which fields are required depends on the provider:
 * `clerk` needs `email` (that is where the invitation goes); `local` needs only
 * a display name and synthesizes a `local-only:` sub, optionally from `username`.
 * The server rejects the combination that its active provider cannot satisfy
 * rather than silently half-creating an account.
 */
export const CreateStaffRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  role: RoleSchema,
  email: z.string().email().optional(),
  /**
   * Local provider only — the suffix of the generated `local-only:<username>`
   * sub. Constrained to the shape the seed already uses so a hand-created user
   * and a seeded one are indistinguishable to the auth guard.
   */
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{1,62}$/, 'lowercase letters, digits, dot, dash or underscore')
    .optional(),
});
export type CreateStaffRequest = z.infer<typeof CreateStaffRequestSchema>;

export const UpdateStaffRoleRequestSchema = z.object({ role: RoleSchema });
export type UpdateStaffRoleRequest = z.infer<typeof UpdateStaffRoleRequestSchema>;

/** `false` revokes access on the staff member's very next request (the guard refuses inactive rows). */
export const UpdateStaffActiveRequestSchema = z.object({ active: z.boolean() });
export type UpdateStaffActiveRequest = z.infer<typeof UpdateStaffActiveRequestSchema>;

/**
 * Result of creating staff. `member` is present when the account exists now
 * (local provider); `invitation` is present when the account will exist once the
 * invite is accepted (clerk provider). Exactly one is set.
 */
export const CreateStaffResponseSchema = z.object({
  member: StaffMemberSchema.nullable(),
  invitation: PendingInvitationSchema.nullable(),
});
export type CreateStaffResponse = z.infer<typeof CreateStaffResponseSchema>;
