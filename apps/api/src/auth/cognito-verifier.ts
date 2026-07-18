import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../config/env';

export interface VerifiedToken {
  sub: string;
  groups: string[];
  raw: JWTPayload;
}

/**
 * Verifies Cognito access/ID tokens against the pool's JWKS (BUILD_SPEC §6):
 * signature via the remote JWK set, `iss` against the pool issuer, and — when a
 * client id is configured — the audience/client claim. This is real crypto, not
 * a stub; it simply cannot run until the dev pool is provisioned (Sprint 0).
 */
export class CognitoVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly env: Env) {
    if (!env.authConfigured || !env.cognitoJwksUri || !env.cognitoIssuer) {
      throw new Error('CognitoVerifier requires COGNITO_* configuration');
    }
    this.jwks = createRemoteJWKSet(new URL(env.cognitoJwksUri));
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.env.cognitoIssuer,
    });

    // Cognito access tokens carry `client_id`; ID tokens carry `aud`.
    if (this.env.COGNITO_CLIENT_ID) {
      const clientClaim = payload.client_id ?? payload.aud;
      const audiences = Array.isArray(clientClaim) ? clientClaim : [clientClaim];
      if (!audiences.includes(this.env.COGNITO_CLIENT_ID)) {
        throw new Error('token client_id/aud does not match configured app client');
      }
    }

    if (typeof payload.sub !== 'string') {
      throw new Error('token missing sub');
    }

    const groups = extractGroups(payload);
    return { sub: payload.sub, groups, raw: payload };
  }
}

/** Cognito puts group membership in `cognito:groups`. */
export function extractGroups(payload: JWTPayload): string[] {
  const raw = (payload as Record<string, unknown>)['cognito:groups'];
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === 'string');
  }
  return [];
}
