import { z } from 'zod';
import { ExceptionCodeSchema, SkipReasonCodeSchema } from './validation';
import { SourceTypeSchema } from './ingestion';

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

/** A prior read shown to the reader in the field, most-recent first. */
export const FieldReadSchema = z.object({
  id: z.string().uuid(),
  value: z.number(),
  consumption: z.number().nullable(),
  capturedAt: z.string(),
  sourceType: SourceTypeSchema,
  readerName: z.string(),
  note: z.string().nullable(),
});
export type FieldRead = z.infer<typeof FieldReadSchema>;

/** Meter context for the field stop screen: standing access notes + read history. */
export const FieldMeterReadsResponseSchema = z.object({
  accessNotes: z.string().nullable(),
  reads: z.array(FieldReadSchema),
});
export type FieldMeterReadsResponse = z.infer<typeof FieldMeterReadsResponseSchema>;
