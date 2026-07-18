import { z } from 'zod';

/**
 * Roles map 1:1 to Cognito groups (see docs/decisions/ADR-004).
 * A Reader is a User with the `reader` role (BUILD_SPEC §5); staff
 * (supervisor/admin) see all clients — the client switcher is a view filter,
 * not a permission wall (ADR-007).
 */
export const RoleSchema = z.enum(['reader', 'supervisor', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const ROLES = RoleSchema.options;
