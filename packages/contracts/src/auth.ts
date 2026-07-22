import { z } from 'zod';
import { RoleSchema } from './roles';

/**
 * The authenticated "hello" the Sprint 0 demo displays: who am I, and what
 * role am I (BUILD_SPEC §6). Loaded server-side from the local `users` row
 * keyed by the verified JWT's `cognito_sub`.
 */
export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  cognitoSub: z.string().min(1),
  displayName: z.string().min(1),
  role: RoleSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * The sign-in choices offered by the local dev-auth shim (ADR-012). Served only
 * while the bypass is active — the endpoint 404s otherwise, so this can never
 * enumerate staff in a deployed environment.
 *
 * The login page reads this instead of a hardcoded list so that staff created
 * through admin actually become reachable, and so the list cannot drift out of
 * sync with the seed.
 */
export const DevUserSchema = z.object({
  sub: z.string().min(1),
  displayName: z.string().min(1),
  role: RoleSchema,
});
export type DevUser = z.infer<typeof DevUserSchema>;

export const DevUserListResponseSchema = z.object({ users: z.array(DevUserSchema) });
export type DevUserListResponse = z.infer<typeof DevUserListResponseSchema>;
