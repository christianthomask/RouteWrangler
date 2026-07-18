import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@routewrangler/contracts';

/** The authenticated principal attached to the request by the JWT guard. */
export interface AuthUser {
  id: string;
  cognitoSub: string;
  displayName: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route without the JWT guard');
    }
    return request.user;
  },
);
