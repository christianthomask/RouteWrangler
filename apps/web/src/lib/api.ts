'use client';

import { MeResponseSchema, type MeResponse } from '@routewrangler/contracts';
import { config } from './config';
import { getToken } from './cognito';

/** Fetches the authenticated hello (`GET /me`), validated against the contract. */
export async function fetchMe(): Promise<MeResponse> {
  const token = getToken();
  if (!token) throw new Error('not signed in');

  const res = await fetch(`${config.apiBaseUrl}/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`/me failed: ${res.status}`);
  }
  return MeResponseSchema.parse(await res.json());
}
