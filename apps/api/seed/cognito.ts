import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Env } from '../src/config/env';
import type { SeedUser } from './seed-data';

/**
 * Provisions the Cognito half of a seed user (BUILD_SPEC §6 — seeding creates
 * BOTH halves). Idempotent: an already-existing pool user is fetched instead of
 * recreated. Returns the Cognito `sub`, which becomes the local row's
 * `cognito_sub`. Groups map to roles.
 */
export async function ensurePoolUser(env: Env, user: SeedUser): Promise<string> {
  if (!env.COGNITO_USER_POOL_ID) {
    throw new Error('ensurePoolUser called without COGNITO_USER_POOL_ID');
  }
  const client = new CognitoIdentityProviderClient({ region: env.AWS_REGION });
  const poolId = env.COGNITO_USER_POOL_ID;

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: user.username,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: user.email },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    );
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) throw err;
  }

  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: poolId,
      Username: user.username,
      GroupName: user.role,
    }),
  );

  const got = await client.send(
    new AdminGetUserCommand({ UserPoolId: poolId, Username: user.username }),
  );
  const sub = got.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new Error(`could not resolve sub for ${user.username}`);
  return sub;
}
