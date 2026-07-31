import { z } from 'zod';
import type { StaffProvider } from '@routewrangler/contracts';
import { isValidTimeZone } from './clock';

/**
 * Env is validated once at boot — the API refuses to start with a malformed
 * environment (BUILD_SPEC §11). Auth and storage are provider-selectable
 * (ADR-015): the app targets any OIDC IdP and any S3-compatible store by
 * config, not code. Neon Auth and R2 are the chosen instances of each
 * (ADR-027). All provider values are optional so the app boots before anything
 * is provisioned (labeled 503 until then).
 */
const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url(),
  /** Comma-separated CORS allowlist. Unset → reflect any origin (dev only, M6). */
  CORS_ORIGINS: z.string().optional(),
  /**
   * IANA zone defining the operational working day. Run dates and "today" are
   * calendar dates in the utility's own day, never UTC — see config/clock.ts.
   */
  APP_TIMEZONE: z
    .string()
    .default('America/Los_Angeles')
    .refine(isValidTimeZone, 'must be a valid IANA time zone, e.g. America/Los_Angeles'),

  // ── auth (OIDC — Neon Auth, or any generic OIDC IdP) ──────────────────────
  AUTH_PROVIDER: z.enum(['neon', 'oidc']).default('neon'),
  /**
   * The one setting Neon Auth needs (ADR-027). Neon hands you a per-branch Auth
   * URL — `https://<endpoint>.neon.tech/<database>/auth` — and everything the
   * API must verify is derivable from it: JWKS at `<base>/.well-known/jwks.json`,
   * and both `iss` and `aud` equal to the URL's *origin*, not the full path.
   * Getting that distinction wrong is the whole reason this is its own provider
   * rather than three generic OIDC_* variables an operator has to hand-derive.
   */
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  /** Generic OIDC escape hatch — any other IdP is config, not code (ADR-015). */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().optional(),
  OIDC_GROUPS_CLAIM: z.string().optional(),
  /** Local-only auth shim (ADR-012). Never takes effect in production. */
  AUTH_DEV_BYPASS: bool,

  // ── object storage (any S3-compatible: MinIO locally, R2 in production) ────
  STORAGE_PROVIDER: z.enum(['s3']).default('s3'),
  S3_BUCKET: z.string().optional(),
  /** SigV4 signing region. MinIO ignores it; R2 wants the literal `auto`. */
  S3_REGION: z.string().default('us-west-2'),
  S3_ENDPOINT: z.string().url().optional(), // MinIO / R2 / any S3-compatible
  S3_FORCE_PATH_STYLE: bool,
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

/** Resolved OIDC verification config, provider-agnostic. */
export interface OidcConfig {
  issuer: string;
  jwksUri: string;
  audience?: string;
  /**
   * JWT claim carrying group/role membership. Read for diagnostics only — roles
   * are DB-authoritative and the guard never consults this (BUILD_SPEC §6).
   */
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
  /** Parsed CORS allowlist, or null to reflect any origin (dev). */
  corsOrigins: string[] | null;
  /**
   * Which staff-directory adapter is active (ADR-024). `oidc` whenever a real
   * IdP is configured — new staff are invited and the identity arrives on their
   * first verified sign-in (ADR-027). Otherwise `local`, which mints a
   * `local-only:` subject and is usable only while the dev-auth shim is on.
   * Resolved here so the decision is made once, at boot, alongside the other
   * provider choices.
   */
  staffProvider: StaffProvider;
};

function resolveOidc(p: z.infer<typeof EnvSchema>): OidcConfig | undefined {
  if (p.AUTH_PROVIDER === 'neon') {
    if (!p.NEON_AUTH_BASE_URL) return undefined;
    // Neon Auth mounts Better Auth under a path on the branch endpoint, but the
    // tokens it signs claim the *origin* as both issuer and audience. Verifying
    // against the full base URL would reject every valid token.
    const base = p.NEON_AUTH_BASE_URL.replace(/\/+$/, '');
    const origin = new URL(base).origin;
    return {
      issuer: p.OIDC_ISSUER ?? origin,
      jwksUri: p.OIDC_JWKS_URI ?? `${base}/.well-known/jwks.json`,
      audience: p.OIDC_AUDIENCE ?? origin,
      groupsClaim: p.OIDC_GROUPS_CLAIM ?? 'groups',
    };
  }
  // generic oidc — issuer is enough; JWKS is derived from it when not given, so
  // .env.example's promise holds (H8). A clean prod deploy that sets only
  // OIDC_ISSUER no longer bricks the whole API with 503s.
  if (!p.OIDC_ISSUER) return undefined;
  return {
    issuer: p.OIDC_ISSUER,
    jwksUri: p.OIDC_JWKS_URI ?? `${p.OIDC_ISSUER.replace(/\/+$/, '')}/.well-known/jwks.json`,
    audience: p.OIDC_AUDIENCE,
    groupsClaim: p.OIDC_GROUPS_CLAIM ?? 'groups',
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  /*
   * An empty value means "not set". dotenv turns `OIDC_ISSUER=` into `''`, and
   * to zod an empty string is a present string that fails `.url()` — so copying
   * the checked-in `.env.example`, which lists every optional setting with an
   * empty value as documentation, refused to boot at all. Stripping them here
   * makes the template work as written, and makes `KEY=` mean the same thing as
   * omitting the line.
   */
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = EnvSchema.parse(present);
  const oidc = resolveOidc(parsed);
  return {
    ...parsed,
    oidc,
    authConfigured: Boolean(oidc),
    authDevBypass: parsed.AUTH_DEV_BYPASS && parsed.NODE_ENV !== 'production',
    storageConfigured: Boolean(parsed.S3_BUCKET),
    // A real IdP is the only thing that makes an invitation meaningful: the
    // person has somewhere to sign in, and the guard has a verified identity to
    // link the pending row to. With no IdP there is nothing to invite anyone to.
    staffProvider: oidc ? 'oidc' : 'local',
    corsOrigins: parsed.CORS_ORIGINS
      ? parsed.CORS_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
  };
}
