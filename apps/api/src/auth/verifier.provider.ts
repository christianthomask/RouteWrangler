import type { Provider } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { OidcTokenVerifier, type TokenVerifier } from './token-verifier';

/** DI token for the (possibly null) OIDC token verifier. */
export const VERIFIER = Symbol('VERIFIER');

/**
 * Builds an OIDC verifier for the configured provider (cognito | entra | oidc),
 * or null before anything is provisioned. Null is a valid, labeled state that
 * the guard reports as 503 rather than silently allowing requests through.
 */
export const verifierProvider: Provider = {
  provide: VERIFIER,
  inject: [ENV],
  useFactory: (env: Env): TokenVerifier | null =>
    env.oidc ? new OidcTokenVerifier(env.oidc) : null,
};
