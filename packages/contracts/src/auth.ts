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
