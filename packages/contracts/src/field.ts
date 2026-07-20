import { z } from 'zod';
import { ExceptionCodeSchema, SkipReasonCodeSchema } from './validation';

export const RereadTaskStatusSchema = z.enum(['issued', 'delivered', 'done']);
export type RereadTaskStatus = z.infer<typeof RereadTaskStatusSchema>;

/** A reader's reread task (BUILD_SPEC §7.2) — delivered on device sync. */
export const RereadTaskViewSchema = z.object({
  id: z.string().uuid(),
  exceptionId: z.string().uuid(),
  status: RereadTaskStatusSchema,
  meterId: z.string().uuid(),
  meterSerial: z.string(),
  serviceAddress: z.string(),
  typeCode: ExceptionCodeSchema,
  typeLabel: z.string(),
  /** The flagged value the reread should re-check against. */
  flaggedValue: z.number(),
  createdAt: z.string(),
});
export type RereadTaskView = z.infer<typeof RereadTaskViewSchema>;

export const RereadTasksResponseSchema = z.object({ tasks: z.array(RereadTaskViewSchema) });
export type RereadTasksResponse = z.infer<typeof RereadTasksResponseSchema>;

/** Skip a stop with a seeded reason (BUILD_SPEC §7.2, W5). */
export const SkipStopRequestSchema = z.object({ skipReasonCode: SkipReasonCodeSchema });
export type SkipStopRequest = z.infer<typeof SkipStopRequestSchema>;
