'use client';

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js';
import { config, authConfigured } from './config';

const TOKEN_KEY = 'rw.idToken';

/**
 * Custom-UI Cognito auth (BUILD_SPEC §6 — no hosted UI). Real SRP auth against
 * the pool; returns the ID token (a JWT the API verifies via JWKS). Throws a
 * labeled error before the pool is provisioned so nothing appears to work when
 * it does not.
 */
export async function signIn(username: string, password: string): Promise<string> {
  if (!authConfigured) {
    throw new Error('Auth is not configured yet — the Cognito dev pool is pending provisioning.');
  }

  const pool = new CognitoUserPool({
    UserPoolId: config.cognito.userPoolId,
    ClientId: config.cognito.clientId,
  });
  const user = new CognitoUser({ Username: username, Pool: pool });
  const details = new AuthenticationDetails({ Username: username, Password: password });

  const idToken = await new Promise<string>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(err),
      newPasswordRequired: () =>
        reject(new Error('A password reset is required for this account.')),
    });
  });

  window.localStorage.setItem(TOKEN_KEY, idToken);
  return idToken;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function signOut(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
}
