import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  AWS_REGION: 'us-west-2',
};

describe('loadEnv — auth providers', () => {
  it('cognito: derives issuer + jwks from region and pool id', () => {
    const env = loadEnv({ ...base, COGNITO_USER_POOL_ID: 'us-west-2_ABC123' } as NodeJS.ProcessEnv);
    expect(env.oidc?.issuer).toBe('https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123');
    expect(env.oidc?.jwksUri).toBe(
      'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123/.well-known/jwks.json',
    );
    expect(env.oidc?.groupsClaim).toBe('cognito:groups');
    expect(env.authConfigured).toBe(true);
  });

  it('entra: derives issuer + jwks from tenant id, roles claim', () => {
    const env = loadEnv({
      ...base,
      AUTH_PROVIDER: 'entra',
      AZURE_TENANT_ID: 'tenant-123',
      AZURE_CLIENT_ID: 'client-abc',
    } as NodeJS.ProcessEnv);
    expect(env.oidc?.issuer).toBe('https://login.microsoftonline.com/tenant-123/v2.0');
    expect(env.oidc?.jwksUri).toBe(
      'https://login.microsoftonline.com/tenant-123/discovery/v2.0/keys',
    );
    expect(env.oidc?.audience).toBe('client-abc');
    expect(env.oidc?.groupsClaim).toBe('roles');
    expect(env.authConfigured).toBe(true);
  });

  it('generic oidc: uses explicit issuer/jwks', () => {
    const env = loadEnv({
      ...base,
      AUTH_PROVIDER: 'oidc',
      OIDC_ISSUER: 'https://issuer.example.com/',
      OIDC_JWKS_URI: 'https://issuer.example.com/jwks.json',
      OIDC_AUDIENCE: 'my-api',
    } as NodeJS.ProcessEnv);
    expect(env.oidc?.issuer).toBe('https://issuer.example.com/');
    expect(env.authConfigured).toBe(true);
  });

  it('is unconfigured (but valid) with no provider config — the pre-provisioning state', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.authConfigured).toBe(false);
    expect(env.oidc).toBeUndefined();
  });

  it('throws on a missing database url', () => {
    expect(() => loadEnv({ AWS_REGION: 'us-west-2' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('loadEnv — storage providers', () => {
  it('s3 is configured when a bucket is set', () => {
    const env = loadEnv({ ...base, STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' } as NodeJS.ProcessEnv);
    expect(env.storageConfigured).toBe(true);
  });

  it('azure_blob needs account + container + key', () => {
    const partial = loadEnv({
      ...base,
      STORAGE_PROVIDER: 'azure_blob',
      AZURE_STORAGE_ACCOUNT: 'acct',
    } as NodeJS.ProcessEnv);
    expect(partial.storageConfigured).toBe(false);

    const full = loadEnv({
      ...base,
      STORAGE_PROVIDER: 'azure_blob',
      AZURE_STORAGE_ACCOUNT: 'acct',
      AZURE_STORAGE_CONTAINER: 'photos',
      AZURE_STORAGE_ACCOUNT_KEY: 'key==',
    } as NodeJS.ProcessEnv);
    expect(full.storageConfigured).toBe(true);
  });

  it('storage unconfigured by default', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).storageConfigured).toBe(false);
  });
});
