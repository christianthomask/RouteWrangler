import { SetMetadata } from '@nestjs/common';
import type { Role } from '@routewrangler/contracts';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles; enforced by RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
