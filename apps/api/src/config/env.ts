import { z } from 'zod';

/**
 * Env is validated once at boot — the API refuses to start with a malformed
 * environment (BUILD_SPEC §11). Auth and storage are provider-selectable
 * (ADR-015): the app targets AWS, Azure, or any OIDC/S3-compatible stack by
 * config, not code. All provider values are optional so the app boots before
 * anything is provisioned (labeled 503 until then).
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),

  // ── auth (OIDC — Cognito, Entra, or generic) ──────────────────────────────
  AUTH_PROVIDER: z.enum(['cognito', 'entra', 'oidc']).default('cognito'),
  AWS_REGION: z.string().default('us-west-2'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  COGNITO_ISSUER: z.string().url().optional(),
  COGNITO_JWKS_URI: z.string().url().optional(),
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_GROUPS_CLAIM: z.string().optional(),
  /** Local-only auth shim (ADR-012). Never takes effect in production. */
  AUTH_DEV_BYPASS: bool,

  // ── object storage (S3-compatible or Azure Blob) ──────────────────────────
  STORAGE_PROVIDER: z.enum(['s3', 'azure_blob']).default('s3'),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(), // MinIO / R2 / any S3-compatible
  S3_FORCE_PATH_STYLE: bool,
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  AZURE_STORAGE_ACCOUNT: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().optional(),
  AZURE_STORAGE_ACCOUNT_KEY: z.string().optional(),
});

/** Resolved OIDC verification config, provider-agnostic. */
export interface OidcConfig {
  issuer: string;
  jwksUri: string;
  audience?: string;
  /** JWT claim carrying group/role membership (Cognito: cognito:groups). */
  groupsClaim: string;
}

export type Env = z.infer<typeof EnvSchema> & {
  /** Present only when the chosen auth provider is fully configured. */
  oidc?: OidcConfig;
  authConfigured: boolean;
  /** True when the local dev auth shim is active (never in production). */
  authDevBypass: boolean;
  /** True when the chosen storage provider is fully configured. */
  storageConfigured: boolean;
};

function resolveOidc(p: z.infer<typeof EnvSchema>): OidcConfig | undefined {
  if (p.AUTH_PROVIDER === 'cognito') {
    const issuer =
      p.COGNITO_ISSUER ??
      (p.COGNITO_USER_POOL_ID
        ? `https://cognito-idp.${p.AWS_REGION}.amazonaws.com/${p.COGNITO_USER_POOL_ID}`
        : undefined);
    if (!issuer) return undefined;
    return {
      issuer,
      jwksUri: p.COGNITO_JWKS_URI ?? `${issuer}/.well-known/jwks.json`,
      audience: p.COGNITO_CLIENT_ID,
      groupsClaim: 'cognito:groups',
    };
  }
  if (p.AUTH_PROVIDER === 'entra') {
    if (!p.AZURE_TENANT_ID) return undefined;
    const issuer = p.OIDC_ISSUER ?? `https://login.microsoftonline.com/${p.AZURE_TENANT_ID}/v2.0`;
    return {
      issuer,
      jwksUri:
        p.OIDC_JWKS_URI ??
        `https://login.microsoftonline.com/${p.AZURE_TENANT_ID}/discovery/v2.0/keys`,
      audience: p.OIDC_AUDIENCE ?? p.AZURE_CLIENT_ID,
      groupsClaim: p.OIDC_GROUPS_CLAIM ?? 'roles',
    };
  }
  // generic oidc
  if (!p.OIDC_ISSUER || !p.OIDC_JWKS_URI) return undefined;
  return {
    issuer: p.OIDC_ISSUER,
    jwksUri: p.OIDC_JWKS_URI,
    audience: p.OIDC_AUDIENCE,
    groupsClaim: p.OIDC_GROUPS_CLAIM ?? 'groups',
  };
}

function resolveStorageConfigured(p: z.infer<typeof EnvSchema>): boolean {
  if (p.STORAGE_PROVIDER === 's3') return Boolean(p.S3_BUCKET);
  return Boolean(p.AZURE_STORAGE_ACCOUNT && p.AZURE_STORAGE_CONTAINER && p.AZURE_STORAGE_ACCOUNT_KEY);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.parse(source);
  const oidc = resolveOidc(parsed);
  return {
    ...parsed,
    oidc,
    authConfigured: Boolean(oidc),
    authDevBypass: parsed.AUTH_DEV_BYPASS && parsed.NODE_ENV !== 'production',
    storageConfigured: resolveStorageConfigured(parsed),
  };
}
