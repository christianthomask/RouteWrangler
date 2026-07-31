import { z } from 'zod';
import { RoleSchema } from './roles';

/**
 * Staff administration (admin-only). Staff provisioning is a *port* with two
 * adapters (ADR-024), mirroring the storage and auth ports of ADR-015:
 *
 * - `local` — mints a `local-only:` sub the dev shim will accept, so the new
 *             staff member is usable immediately (ADR-012). Local development
 *             only; refused when the bypass is off.
 * - `oidc`  — a real IdP owns identity, so the account is *invited*: the row is
 *             written now with a role and an address but no subject id, and the
 *             auth guard attaches the identity on that person's first verified
 *             sign-in (ADR-027).
 *
 * The provider is reported to the client because it changes what the admin UI
 * can offer: only `oidc` produces pending invitations, and only `local` can mint
 * a usable account without an email round-trip.
 */
export const StaffProviderSchema = z.enum(['local', 'oidc']);
export type StaffProvider = z.infer<typeof StaffProviderSchema>;

export const StaffMemberSchema = z.object({
  id: z.string().uuid(),
  /** The IdP's subject id — null while this person has never signed in. */
  authSub: z.string().nullable(),
  email: z.string().nullable(),
  displayName: z.string(),
  role: RoleSchema,
  /** Soft-deactivation — a departed staff member with history is never deleted. */
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

/**
 * An invitation issued but not yet accepted — a `users` row carrying a role and
 * an email but no subject id. It is the same row that also appears in `staff`,
 * surfaced separately because "I invited Dana yesterday and she still hasn't
 * signed in" is the question an admin actually asks. Empty for `local`.
 */
export const PendingInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
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
 * `oidc` needs `email` — it is both where the person is told to sign in and the
 * only thing that can match them to this row afterwards; `local` needs only a
 * display name and synthesizes a `local-only:` sub, optionally from `username`.
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
 * Result of creating staff. `member` is present when the account is usable now
 * (local provider); `invitation` is present when it becomes usable on first
 * sign-in (oidc provider). Exactly one is set.
 */
export const CreateStaffResponseSchema = z.object({
  member: StaffMemberSchema.nullable(),
  invitation: PendingInvitationSchema.nullable(),
});
export type CreateStaffResponse = z.infer<typeof CreateStaffResponseSchema>;
