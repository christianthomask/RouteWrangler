/**
 * Public runtime config, read from NEXT_PUBLIC_* env at build/runtime. Cognito
 * values arrive when the dev pool is provisioned (docs/runbook.md). Until then
 * `authConfigured` is false and the login page renders a labeled notice rather
 * than pretending to authenticate.
 */
export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  cognito: {
    userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
    clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
  },
};

export const authConfigured = Boolean(config.cognito.userPoolId && config.cognito.clientId);
