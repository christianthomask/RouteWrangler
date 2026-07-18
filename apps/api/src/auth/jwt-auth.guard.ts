import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../db/db.module';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { CognitoVerifier } from './cognito-verifier';
import { VERIFIER } from './verifier.provider';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './current-user';

/**
 * Global guard (BUILD_SPEC §6 — "role enforcement is server-side on every
 * endpoint"). Verifies the Bearer JWT against Cognito, then loads the local
 * `users` row by `cognito_sub`; the DB row's role is authoritative, not the
 * token's groups. Routes opt out only via @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(VERIFIER) private readonly verifier: CognitoVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!this.env.authConfigured || !this.verifier) {
      // Labeled stub state: the skeleton runs before the dev Cognito pool is
      // provisioned (docs/runbook.md). We fail loudly rather than fake a login.
      throw new ServiceUnavailableException(
        'auth not configured — provision the Cognito dev pool (see docs/runbook.md)',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    let sub: string;
    try {
      ({ sub } = await this.verifier.verify(token));
    } catch {
      throw new UnauthorizedException('invalid token');
    }

    const [row] = await this.db.select().from(users).where(eq(users.cognitoSub, sub)).limit(1);
    if (!row) {
      throw new UnauthorizedException('no local user for this identity');
    }

    const authUser: AuthUser = {
      id: row.id,
      cognitoSub: row.cognitoSub,
      displayName: row.displayName,
      role: row.role,
    };
    (request as Request & { user: AuthUser }).user = authUser;
    return true;
  }
}

export function extractBearer(header?: string): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
