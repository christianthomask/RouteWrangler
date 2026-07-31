import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { OidcConfig } from '../config/env';

export interface VerifiedToken {
  sub: string;
  /**
   * The `email` claim, lowercased — and present only when the IdP also asserts
   * that it verified the address. Undefined otherwise: an unverified address
   * must never link a pending invitation, or anyone able to sign up under a
   * chosen address could claim someone else's invited role (ADR-027).
   */
  email?: string;
  groups: string[];
  raw: JWTPayload;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/**
 * OIDC token verifier (ADR-015) — one of the two vendor-specific seams, kept on
 * the standards path so it stays provider-agnostic. Verifies the signature
 * against the issuer's JWKS, plus `iss` and (when configured) `aud`. Neon Auth
 * and any other OIDC IdP differ only in config (issuer/jwks/audience/groups
 * claim), resolved in env.ts. This is real crypto, not a stub.
 *
 * No algorithm allow-list is pinned deliberately: Neon Auth signs EdDSA
 * (Ed25519) while most OIDC providers sign RS256, and the JWKS itself is what
 * constrains which keys — and therefore which algorithms — can ever verify.
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
    return {
      sub: payload.sub,
      email: extractVerifiedEmail(payload),
      groups: extractGroups(payload, this.cfg.groupsClaim),
      raw: payload,
    };
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

/**
 * The email address the IdP is willing to vouch for, normalized for comparison.
 *
 * Both spellings of the verification flag are accepted — OIDC standardizes
 * `email_verified`, Better Auth (and therefore Neon Auth) emits `emailVerified`
 * — but *some* affirmative flag is required. A token carrying an email with no
 * verification claim at all is treated as unverified, which is the safe reading:
 * this value is about to be used to hand someone a pre-assigned role.
 */
export function extractVerifiedEmail(payload: JWTPayload): string | undefined {
  const p = payload as Record<string, unknown>;
  const email = p.email;
  if (typeof email !== 'string' || !email.includes('@')) return undefined;
  const flag = p.email_verified ?? p.emailVerified;
  const verified = flag === true || flag === 'true';
  return verified ? email.trim().toLowerCase() : undefined;
}
