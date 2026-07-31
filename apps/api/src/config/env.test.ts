import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};

describe('loadEnv — auth providers', () => {
  it('neon: derives issuer, jwks and audience from the one base URL', () => {
    const env = loadEnv({
      ...base,
      NEON_AUTH_BASE_URL: 'https://ep-cool-band-123.us-east-2.aws.neon.tech/neondb/auth',
    } as NodeJS.ProcessEnv);

    // Issuer and audience are the ORIGIN, not the full base URL — Neon Auth
    // mounts Better Auth under a path but signs tokens claiming the origin.
    // Verifying against the path would reject every valid token.
    expect(env.oidc?.issuer).toBe('https://ep-cool-band-123.us-east-2.aws.neon.tech');
    expect(env.oidc?.audience).toBe('https://ep-cool-band-123.us-east-2.aws.neon.tech');
    expect(env.oidc?.jwksUri).toBe(
      'https://ep-cool-band-123.us-east-2.aws.neon.tech/neondb/auth/.well-known/jwks.json',
    );
    expect(env.authConfigured).toBe(true);
  });

  it('neon: tolerates a trailing slash on the base URL', () => {
    const env = loadEnv({
      ...base,
      NEON_AUTH_BASE_URL: 'https://ep-x.neon.tech/neondb/auth/',
    } as NodeJS.ProcessEnv);
    expect(env.oidc?.jwksUri).toBe('https://ep-x.neon.tech/neondb/auth/.well-known/jwks.json');
  });

  it('neon: explicit OIDC_* values win, for an instance that breaks the pattern', () => {
    const env = loadEnv({
      ...base,
      NEON_AUTH_BASE_URL: 'https://ep-x.neon.tech/neondb/auth',
      OIDC_ISSUER: 'https://issuer.override',
      OIDC_AUDIENCE: 'my-api',
    } as NodeJS.ProcessEnv);
    expect(env.oidc?.issuer).toBe('https://issuer.override');
    expect(env.oidc?.audience).toBe('my-api');
  });

  it('generic oidc: derives jwks from the issuer when not given', () => {
    const env = loadEnv({
      ...base,
      AUTH_PROVIDER: 'oidc',
      OIDC_ISSUER: 'https://issuer.example.com/',
      OIDC_AUDIENCE: 'my-api',
    } as NodeJS.ProcessEnv);
    expect(env.oidc?.issuer).toBe('https://issuer.example.com/');
    expect(env.oidc?.jwksUri).toBe('https://issuer.example.com/.well-known/jwks.json');
    expect(env.authConfigured).toBe(true);
  });

  it('is unconfigured (but valid) with no provider config — the pre-provisioning state', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.authConfigured).toBe(false);
    expect(env.oidc).toBeUndefined();
  });

  it('a base URL set under the generic provider does not accidentally configure auth', () => {
    const env = loadEnv({
      ...base,
      AUTH_PROVIDER: 'oidc',
      NEON_AUTH_BASE_URL: 'https://ep-x.neon.tech/neondb/auth',
    } as NodeJS.ProcessEnv);
    expect(env.authConfigured).toBe(false);
  });

  it('throws on a missing database url', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('loadEnv — staff provider', () => {
  it('is `oidc` exactly when an IdP is configured', () => {
    const withIdp = loadEnv({
      ...base,
      NEON_AUTH_BASE_URL: 'https://ep-x.neon.tech/neondb/auth',
    } as NodeJS.ProcessEnv);
    expect(withIdp.staffProvider).toBe('oidc');
  });

  it('falls back to `local` with no IdP — nothing to invite anyone to', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).staffProvider).toBe('local');
  });
});

describe('loadEnv — dev bypass', () => {
  it('collapses in production regardless of the flag (ADR-012, H9)', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      AUTH_DEV_BYPASS: 'true',
    } as NodeJS.ProcessEnv);
    expect(env.authDevBypass).toBe(false);
  });
});

describe('loadEnv — storage', () => {
  it('is configured when a bucket is set', () => {
    const env = loadEnv({ ...base, S3_BUCKET: 'b' } as NodeJS.ProcessEnv);
    expect(env.storageConfigured).toBe(true);
  });

  it('storage unconfigured by default', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).storageConfigured).toBe(false);
  });

  it('defaults the signing region but lets R2 ask for `auto`', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).S3_REGION).toBe('us-west-2');
    expect(loadEnv({ ...base, S3_REGION: 'auto' } as NodeJS.ProcessEnv).S3_REGION).toBe('auto');
  });
});
