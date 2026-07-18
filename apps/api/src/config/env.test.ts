import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  AWS_REGION: 'us-west-2',
};

describe('loadEnv', () => {
  it('derives issuer + jwks from region and pool id', () => {
    const env = loadEnv({ ...base, COGNITO_USER_POOL_ID: 'us-west-2_ABC123' } as NodeJS.ProcessEnv);
    expect(env.cognitoIssuer).toBe(
      'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123',
    );
    expect(env.cognitoJwksUri).toBe(
      'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123/.well-known/jwks.json',
    );
    expect(env.authConfigured).toBe(true);
  });

  it('is unconfigured (but valid) with no pool id — the pre-provisioning state', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.authConfigured).toBe(false);
    expect(env.cognitoIssuer).toBeUndefined();
  });

  it('honours explicit issuer/jwks overrides', () => {
    const env = loadEnv({
      ...base,
      COGNITO_ISSUER: 'https://issuer.example.com/pool',
      COGNITO_JWKS_URI: 'https://issuer.example.com/pool/jwks.json',
    } as NodeJS.ProcessEnv);
    expect(env.authConfigured).toBe(true);
    expect(env.cognitoIssuer).toBe('https://issuer.example.com/pool');
  });

  it('throws on a missing database url', () => {
    expect(() => loadEnv({ AWS_REGION: 'us-west-2' } as NodeJS.ProcessEnv)).toThrow();
  });
});
