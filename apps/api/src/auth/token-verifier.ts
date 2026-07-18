import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { OidcConfig } from '../config/env';

export interface VerifiedToken {
  sub: string;
  groups: string[];
  raw: JWTPayload;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/**
 * OIDC token verifier (ADR-015) — one of the two vendor-specific seams, kept on
 * the standards path so it's provider-agnostic. Verifies signature against the
 * issuer's JWKS, plus `iss` and (when configured) `aud`. Cognito, Entra, and any
 * generic OIDC IdP differ only in config (issuer/jwks/audience/groups claim),
 * resolved in env.ts. This is real crypto, not a stub.
 */
export class OidcTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly cfg: OidcConfig) {
    this.jwks = createRemoteJWKSet(new URL(cfg.jwksUri));
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
    });
    if (typeof payload.sub !== 'string') {
      throw new Error('token missing sub');
    }
    return { sub: payload.sub, groups: extractGroups(payload, this.cfg.groupsClaim), raw: payload };
  }
}

/** Reads group/role membership from the provider's configured claim. */
export function extractGroups(payload: JWTPayload, claim: string): string[] {
  const raw = (payload as Record<string, unknown>)[claim];
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === 'string');
  }
  return [];
}
