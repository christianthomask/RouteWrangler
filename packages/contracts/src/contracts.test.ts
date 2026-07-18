import { describe, it, expect } from 'vitest';
import { RoleSchema, MeResponseSchema, HealthResponseSchema } from './index';

describe('contracts', () => {
  it('accepts the three seeded roles and rejects others', () => {
    expect(RoleSchema.safeParse('reader').success).toBe(true);
    expect(RoleSchema.safeParse('supervisor').success).toBe(true);
    expect(RoleSchema.safeParse('admin').success).toBe(true);
    expect(RoleSchema.safeParse('owner').success).toBe(false);
  });

  it('validates a MeResponse', () => {
    const parsed = MeResponseSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-abc',
      displayName: 'Jeramehl',
      role: 'supervisor',
    });
    expect(parsed.success).toBe(true);
  });

  it('validates a HealthResponse', () => {
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', service: 'routewrangler-api', db: 'up' })
        .success,
    ).toBe(true);
  });
});
