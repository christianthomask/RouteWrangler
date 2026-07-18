import { z } from 'zod';

/** Liveness/readiness payload for the App Runner health endpoint (BUILD_SPEC §11). */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('routewrangler-api'),
  db: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
