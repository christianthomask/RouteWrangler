import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '@routewrangler/contracts';
import { ROLES_KEY } from './roles.decorator';
import type { AuthUser } from './current-user';

/**
 * Runs after the JWT guard. When a route declares @Roles(...), the
 * authenticated user's DB role must be among them. Staff visibility rules
 * (supervisor/admin see all clients) are a query concern, not a guard concern
 * (ADR-007).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const role = request.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}
