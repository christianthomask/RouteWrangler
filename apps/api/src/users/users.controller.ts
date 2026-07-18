import { Controller, Get } from '@nestjs/common';
import { MeResponseSchema, type MeResponse } from '@routewrangler/contracts';
import { CurrentUser, type AuthUser } from '../auth/current-user';

@Controller()
export class UsersController {
  /**
   * The Sprint 0 demo payload: "authenticated hello with role displayed"
   * (SPRINT_PLAN Sprint 0). Response is validated against the shared contract so
   * the wire shape can never drift from `packages/contracts`.
   */
  @Get('me')
  me(@CurrentUser() user: AuthUser): MeResponse {
    return MeResponseSchema.parse({
      id: user.id,
      cognitoSub: user.cognitoSub,
      displayName: user.displayName,
      role: user.role,
    });
  }
}
