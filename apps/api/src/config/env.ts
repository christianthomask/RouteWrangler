import { z } from 'zod';

/**
 * Env is validated once at boot — the API refuses to start with a malformed
 * environment (BUILD_SPEC §11, env-based config). Cognito values are optional
 * so the skeleton boots before the dev pool is provisioned (Sprint 0 runbook);
 * auth endpoints return 401 until they are set.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),

  AWS_REGION: z.string().default('us-west-2'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_JWKS_URI: z.string().url().optional(),

  /** Local-only auth shim (ADR-012). Never takes effect in production. */
  AUTH_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** S3 bucket for photo/export presigning (BUILD_SPEC §3). */
  S3_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & {
  /** Resolved issuer — explicit override or derived from region + pool id. */
  cognitoIssuer?: string;
  /** Resolved JWKS URI — explicit override or derived from the issuer. */
  cognitoJwksUri?: string;
  /** True only when enough Cognito config is present to verify tokens. */
  authConfigured: boolean;
  /** True when the local dev auth shim is active (never in production). */
  authDevBypass: boolean;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.parse(source);

  const derivedIssuer =
    parsed.COGNITO_ISSUER ??
    (parsed.COGNITO_USER_POOL_ID
      ? `https://cognito-idp.${parsed.AWS_REGION}.amazonaws.com/${parsed.COGNITO_USER_POOL_ID}`
      : undefined);

  const derivedJwks =
    parsed.COGNITO_JWKS_URI ?? (derivedIssuer ? `${derivedIssuer}/.well-known/jwks.json` : undefined);

  return {
    ...parsed,
    cognitoIssuer: derivedIssuer,
    cognitoJwksUri: derivedJwks,
    authConfigured: Boolean(derivedIssuer && derivedJwks),
    authDevBypass: parsed.AUTH_DEV_BYPASS && parsed.NODE_ENV !== 'production',
  };
}
