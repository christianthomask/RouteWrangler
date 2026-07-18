import type { Provider } from '@nestjs/common';
import { ENV } from '../config/env.module';
import type { Env } from '../config/env';
import { CognitoVerifier } from './cognito-verifier';

/** DI token for the (possibly null) Cognito verifier. */
export const VERIFIER = Symbol('VERIFIER');

/**
 * Builds a CognitoVerifier when the pool is configured, else null. Null is a
 * valid, labeled state (skeleton before provisioning) that the guard reports as
 * 503 rather than silently allowing requests through.
 */
export const verifierProvider: Provider = {
  provide: VERIFIER,
  inject: [ENV],
  useFactory: (env: Env): CognitoVerifier | null =>
    env.authConfigured ? new CognitoVerifier(env) : null,
};
